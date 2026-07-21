'use strict';

// Terminal and JSON reporting. Colors degrade gracefully: disabled when
// stdout is not a TTY, when NO_COLOR is set, or with --no-color.

const SEVERITY_ORDER = { error: 0, warn: 1, info: 2 };

function makePalette(useColor) {
  const wrap = (code) => (useColor ? (s) => `\x1b[${code}m${s}\x1b[0m` : (s) => s);
  return {
    red: wrap('31'),
    yellow: wrap('33'),
    cyan: wrap('36'),
    green: wrap('32'),
    bold: wrap('1'),
    dim: wrap('2'),
  };
}

function severityTag(sev, c) {
  if (sev === 'error') return c.red('✗ error');
  if (sev === 'warn') return c.yellow('⚠ warn ');
  return c.cyan('ℹ info ');
}

// Score starts at 100 and drops per finding. The letter grade is what
// people screenshot, so keep the thresholds simple and honest.
function scoreFindings(findings) {
  let score = 100;
  for (const f of findings) {
    if (f.severity === 'error') score -= 15;
    else if (f.severity === 'warn') score -= 5;
    else score -= 1;
  }
  score = Math.max(0, score);
  const grade =
    score >= 97 ? 'A+' : score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F';
  return { score, grade };
}

function render(findings, meta, opts = {}) {
  const c = makePalette(opts.color !== false);
  const lines = [];
  const { score, grade } = scoreFindings(findings);

  lines.push(c.bold(`agent-audit v${meta.version}`) + c.dim(` — auditing ${meta.source}`));
  lines.push('');

  if (!findings.length) {
    lines.push(c.green('✓ No slop detected. The agent might actually be telling the truth.'));
    lines.push('');
    lines.push(`${c.bold('Slop score:')} ${c.green(`${score}/100 (${grade})`)}`);
    return { text: lines.join('\n'), score, grade };
  }

  // Group by file, worst severity first within each file.
  const byFile = new Map();
  for (const f of findings) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push(f);
  }
  for (const [file, list] of byFile) {
    list.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.line - b.line);
    lines.push(c.bold(file));
    for (const f of list) {
      const loc = f.line ? c.dim(`:${f.line}`) : '';
      lines.push(`  ${severityTag(f.severity, c)}  ${f.message} ${c.dim(`[${f.rule}]`)}${loc}`);
      if (f.snippet) lines.push(c.dim(`           ${f.snippet}`));
    }
    lines.push('');
  }

  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const parts = [];
  if (counts.error) parts.push(c.red(`${counts.error} error${counts.error > 1 ? 's' : ''}`));
  if (counts.warn) parts.push(c.yellow(`${counts.warn} warning${counts.warn > 1 ? 's' : ''}`));
  if (counts.info) parts.push(c.cyan(`${counts.info} note${counts.info > 1 ? 's' : ''}`));
  lines.push(`${parts.join(', ')}  ${c.dim('|')}  ${c.bold('Slop score:')} ${gradeColor(score, grade, c)}`);
  return { text: lines.join('\n'), score, grade, counts };
}

function gradeColor(score, grade, c) {
  const s = `${score}/100 (${grade})`;
  if (score >= 90) return c.green(s);
  if (score >= 65) return c.yellow(s);
  return c.red(s);
}

function renderJson(findings, meta) {
  const { score, grade } = scoreFindings(findings);
  return JSON.stringify({ version: meta.version, source: meta.source, score, grade, findings }, null, 2);
}

module.exports = { render, renderJson, scoreFindings };
