'use strict';

// Detection rules. Each one targets a documented failure mode of AI coding
// agents: claiming work is complete while leaving stubs, weakening tests so
// they pass, or leaving debugging artifacts behind. Rules run against the
// *diff* (what changed), not the whole file, so they only flag what the
// agent just did.
//
// Severity meanings:
//   error - almost certainly a lie or a broken promise; blocks the commit
//   warn  - suspicious enough that a human should look
//   info  - not wrong by itself, but worth knowing about

// Heuristic for "is this a test file". Covers the common layouts for
// JS/TS (jest, vitest, mocha), Python (pytest, unittest), Go, and Ruby.
const TEST_FILE_RE =
  /(^|\/)(tests?|__tests__|spec)\/|\.(test|spec)\.[cm]?[jt]sx?$|_test\.(go|py|rb)$|(^|\/)test_[^/]+\.py$|_spec\.rb$/i;

// Lines that count as an assertion when we compare removed vs added.
const ASSERTION_RE =
  /\bexpect\s*\(|\bassert\s|\bassert\w*\s*\(|\.should[.(]|\bEXPECT_\w+\(|\bASSERT_\w+\(|\brequire\.(Equal|NoError|True|False)\(/;

function isTestFile(path) {
  return TEST_FILE_RE.test(path);
}

// Rules that match individual added lines.
// context: 'test' = only in test files, 'prod' = only outside test files,
// 'any' = everywhere.
const LINE_RULES = [
  {
    id: 'stub-left-behind',
    severity: 'error',
    context: 'any',
    pattern:
      /\b(add|insert|put|write)\s+(your|the)\s+(own\s+)?(\w+\s+)?(logic|code|implementation)\b|\byour\s+(code|logic|implementation)\s+(goes\s+)?here\b|implementation\s+goes\s+here|rest\s+of\s+(the\s+)?(code|file|function|logic)|remaining\s+code\s+(is\s+)?(unchanged|omitted)|\.\.\.\s*existing\s+code\s*\.\.\./i,
    message: 'Placeholder comment where real code should be',
  },
  {
    id: 'not-implemented',
    severity: 'error',
    context: 'any',
    pattern:
      /throw\s+new\s+Error\(\s*['"`](not\s+(yet\s+)?implemented|unimplemented)/i,
    altPatterns: [
      /\braise\s+NotImplementedError\b/,
      /\btodo!\s*\(/,
      /\bunimplemented!\s*\(/,
      /panic\(\s*["']not implemented/i,
    ],
    message: 'Function body raises "not implemented"',
  },
  {
    id: 'skipped-test',
    severity: 'error',
    context: 'test',
    pattern:
      /\b(it|test|describe|context)\.(skip|todo)\s*\(|\bx(it|describe|test)\s*\(/,
    altPatterns: [
      /@pytest\.mark\.(skip|skipif|xfail)/,
      /@unittest\.skip/,
      /\bt\.Skip\(/,
    ],
    message: 'Test was disabled instead of fixed',
  },
  {
    id: 'trivial-assertion',
    severity: 'error',
    context: 'test',
    pattern:
      /expect\(\s*true\s*\)\.toBe\(\s*true\s*\)|expect\(\s*1\s*\)\.toBe\(\s*1\s*\)|assertTrue\(\s*true\s*\)|assertEquals\(\s*(\d+)\s*,\s*\1\s*\)/,
    altPatterns: [/^\s*assert\s+True\s*(#.*)?$/],
    message: 'Assertion that can never fail (test is gamed)',
  },
  {
    id: 'todo-added',
    severity: 'warn',
    context: 'any',
    pattern: /(\/\/|#|\/\*|<!--)\s*(TODO|FIXME|HACK|XXX)\b/,
    message: 'New TODO/FIXME introduced',
  },
  {
    id: 'debug-leftover',
    severity: 'info',
    context: 'prod',
    pattern: /\bconsole\.(log|debug)\(|^\s*debugger;?\s*$|\bdbg!\(/,
    message: 'Debug statement left in non-test code',
  },
  {
    id: 'mock-in-prod',
    severity: 'warn',
    context: 'prod',
    pattern: /\bjest\.mock\(|\bsinon\.(stub|mock|fake)\b|\bMagicMock\(|\bmonkeypatch\./,
    message: 'Mocking utility used outside of tests',
  },
  {
    id: 'conflict-marker',
    severity: 'error',
    context: 'any',
    pattern: /^(<{7}|={7}|>{7})(\s|$)/,
    message: 'Unresolved merge conflict marker',
  },
];

// Patterns that need to see consecutive lines together (e.g. an empty catch
// block split across lines). We join each file's added lines and search the
// joined text, then map matches back to line numbers.
const BLOCK_RULES = [
  {
    id: 'swallowed-error',
    severity: 'warn',
    pattern:
      /catch\s*(\([^)]*\))?\s*\{\s*\}|\.catch\(\s*(\(\s*\w*\s*\)|\w+)\s*=>\s*\{\s*\}\s*\)|except[^:\n]*:\s*\n?\s*(pass|\.\.\.)\s*(\n|$)/,
    message: 'Error caught and silently discarded',
  },
];

// ---------------------------------------------------------------------------
// Inline suppression.
//
// A rule can fire on something the author did on purpose (deliberately deleting
// a dead assertion, a stub that is genuinely a placeholder for a tracked task).
// `ignoreRules` silences a rule across the whole repo and `--no-verify` skips an
// entire commit; neither lets you wave through one specific line while keeping
// the rule active everywhere else. These directives do, mirroring the eslint
// convention developers already know:
//
//   expect(true).toBe(true); // hallucinot-disable-line
//   // hallucinot-disable-next-line trivial-assertion
//   expect(true).toBe(true);
//
// With no rule ids listed, every finding on the target line is suppressed. With
// ids, only those rules are; an unknown id simply matches nothing. As in eslint,
// anything after `--` is a human description and is ignored. Because everything
// is diff-scoped, the directive itself must be part of the added lines to apply.
const DISABLE_RE = /hallucinot-disable-(next-line|line)(?![\w-])(.*)/i;

function parseDisableDirective(text) {
  const m = DISABLE_RE.exec(text);
  if (!m) return null;
  const next = m[1].toLowerCase() === 'next-line';
  let rest = m[2];
  const dash = rest.indexOf('--'); // everything past `--` is a description
  if (dash !== -1) rest = rest.slice(0, dash);
  const rules = (rest.match(/[a-z][a-z-]+/gi) || []).map((s) => s.toLowerCase());
  return { next, rules }; // rules: [] means suppress every rule on the line
}

// Map each targeted line to the rules suppressed there. Value '*' = all rules.
function collectSuppressions(files) {
  const map = new Map();
  for (const file of files) {
    for (const { line, text } of file.added) {
      const d = parseDisableDirective(text);
      if (!d) continue;
      const key = `${file.path}\n${d.next ? line + 1 : line}`;
      if (!d.rules.length) {
        map.set(key, '*');
        continue;
      }
      const existing = map.get(key);
      if (existing === '*') continue;
      const set = existing || new Set();
      for (const r of d.rules) set.add(r);
      map.set(key, set);
    }
  }
  return map;
}

function isSuppressed(map, file, line, rule) {
  const s = map.get(`${file}\n${line}`);
  return s === '*' || (s instanceof Set && s.has(rule));
}

function matchesRule(rule, text) {
  if (rule.pattern.test(text)) return true;
  if (rule.altPatterns) return rule.altPatterns.some((p) => p.test(text));
  return false;
}

function ruleApplies(rule, path) {
  if (rule.context === 'test') return isTestFile(path);
  if (rule.context === 'prod') return !isTestFile(path);
  return true;
}

/**
 * Run all rules against parsed diff files.
 * @param {Array} files  output of parseDiff()
 * @param {Object} opts  { ignoreRules: string[] }
 * @returns {Array} findings [{rule, severity, file, line, message, snippet}]
 */
function runRules(files, opts = {}) {
  const ignore = new Set(opts.ignoreRules || []);
  const suppress = collectSuppressions(files);
  const findings = [];
  const add = (f) => {
    if (ignore.has(f.rule)) return;
    if (isSuppressed(suppress, f.file, f.line, f.rule)) return;
    findings.push(f);
  };

  for (const file of files) {
    // A deleted test file is the bluntest way to make a failing suite pass.
    if (file.isDeleted && isTestFile(file.path)) {
      add({
        rule: 'deleted-test-file',
        severity: 'error',
        file: file.path,
        line: 0,
        message: 'Entire test file was deleted',
        snippet: '',
      });
      continue;
    }

    for (const { line, text } of file.added) {
      let stubHitLine = false;
      for (const rule of LINE_RULES) {
        // A stub comment usually contains the word TODO as well; reporting
        // both rules for one line is noise, so the stronger rule wins.
        if (rule.id === 'todo-added' && stubHitLine) continue;
        if (ruleApplies(rule, file.path) && matchesRule(rule, text)) {
          if (rule.id === 'stub-left-behind') stubHitLine = true;
          add({
            rule: rule.id,
            severity: rule.severity,
            file: file.path,
            line,
            message: rule.message,
            snippet: text.trim().slice(0, 120),
          });
        }
      }
    }

    // Block rules over the joined added text.
    if (file.added.length) {
      const joined = file.added.map((a) => a.text).join('\n');
      for (const rule of BLOCK_RULES) {
        const m = rule.pattern.exec(joined);
        if (m) {
          const lineIdx = joined.slice(0, m.index).split('\n').length - 1;
          add({
            rule: rule.id,
            severity: rule.severity,
            file: file.path,
            line: file.added[lineIdx] ? file.added[lineIdx].line : 0,
            message: rule.message,
            snippet: m[0].replace(/\s+/g, ' ').trim().slice(0, 120),
          });
        }
      }
    }

    // Assertion accounting: if a modified test file lost more assertions
    // than it gained, the suite got weaker. Whole-file linters cannot see
    // this because the deleted lines no longer exist.
    if (isTestFile(file.path) && !file.isNew && !file.isDeleted) {
      const removed = file.removed.filter((r) => ASSERTION_RE.test(r.text)).length;
      const added = file.added.filter((a) => ASSERTION_RE.test(a.text)).length;
      if (removed > added) {
        add({
          rule: 'weakened-assertions',
          severity: 'error',
          file: file.path,
          line: 0,
          message: `Net loss of assertions: ${removed} removed, ${added} added`,
          snippet: '',
        });
      }
    }

    // Very large single-file additions deserve a closer read regardless.
    if (file.added.length >= 400) {
      add({
        rule: 'large-change',
        severity: 'info',
        file: file.path,
        line: 0,
        message: `${file.added.length} lines added in one file; review carefully`,
        snippet: '',
      });
    }
  }
  return findings;
}

function listRules() {
  const rows = [];
  for (const r of LINE_RULES) rows.push({ id: r.id, severity: r.severity, message: r.message });
  for (const r of BLOCK_RULES) rows.push({ id: r.id, severity: r.severity, message: r.message });
  rows.push(
    { id: 'deleted-test-file', severity: 'error', message: 'Entire test file was deleted' },
    { id: 'weakened-assertions', severity: 'error', message: 'Test file lost more assertions than it gained' },
    { id: 'large-change', severity: 'info', message: 'Unusually large single-file addition' },
    { id: 'scope-violation', severity: 'error', message: 'File changed outside the allowed scope' },
    { id: 'protected-path', severity: 'warn', message: 'Sensitive path was modified' },
    { id: 'lockfile-drift', severity: 'warn', message: 'Lockfile changed without its manifest' },
  );
  return rows;
}

module.exports = { runRules, listRules, isTestFile, ASSERTION_RE };
