'use strict';

const fs = require('fs');
const path = require('path');
const { getDiffText, parseDiff, git } = require('./diff');
const { runRules, listRules } = require('./rules');
const { loadConfig, checkScope, CONFIG_FILENAME } = require('./scope');
const { render, renderJson } = require('./report');
const pkg = require('../package.json');

const HELP = `hallucinot: audit AI-agent diffs for slop and scope violations

Usage:
  hallucinot [check] [options]     audit staged changes (or working tree)
  hallucinot init                  create a ${CONFIG_FILENAME} config
  hallucinot install-hook          install as a git pre-commit hook
  hallucinot rules                 list all detection rules

Options:
  --range <a..b>   audit a commit range instead (e.g. main..HEAD)
  --json           machine-readable output
  --strict         warnings also fail the audit (exit 1)
  --warn-only      never fail; report and exit 0
  --no-color       disable colored output
  -v, --version    print version
  -h, --help       show this help

Exit codes: 0 clean (or warn-only), 1 findings at failing severity, 2 error.`;

function parseArgs(argv) {
  const opts = { command: 'check', range: null, json: false, strict: false, warnOnly: false, color: true };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--range') {
      const v = argv[++i];
      if (!v || v.startsWith('-')) throw new Error('--range needs a value, e.g. --range main..HEAD');
      opts.range = v;
    }
    else if (a === '--json') opts.json = true;
    else if (a === '--strict') opts.strict = true;
    else if (a === '--warn-only') opts.warnOnly = true;
    else if (a === '--no-color') opts.color = false;
    else if (a === '-v' || a === '--version') opts.command = 'version';
    else if (a === '-h' || a === '--help') opts.command = 'help';
    else if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
    else positional.push(a);
  }
  if (positional.length) {
    const cmd = positional[0];
    if (['check', 'init', 'install-hook', 'rules'].includes(cmd)) opts.command = cmd;
    else if (cmd.includes('..')) opts.range = cmd; // allow "hallucinot main..HEAD"
    else throw new Error(`Unknown command: ${cmd}`);
  }
  return opts;
}

function cmdCheck(opts) {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const { text, source } = getDiffText({ range: opts.range, cwd });
  const files = parseDiff(text);
  const ignore = new Set(config.ignoreRules);
  const findings = [
    ...runRules(files, { ignoreRules: config.ignoreRules }),
    ...checkScope(files, config).filter((f) => !ignore.has(f.rule)),
  ];
  const meta = { version: pkg.version, source };

  if (opts.json) {
    process.stdout.write(renderJson(findings, meta) + '\n');
  } else {
    const useColor = opts.color && process.stdout.isTTY && !process.env.NO_COLOR;
    const { text: out } = render(findings, meta, { color: useColor });
    process.stdout.write(out + '\n');
  }

  if (opts.warnOnly) return 0;
  const hasError = findings.some((f) => f.severity === 'error');
  const hasWarn = findings.some((f) => f.severity === 'warn');
  return hasError || (opts.strict && hasWarn) ? 1 : 0;
}

function cmdInit() {
  const file = path.join(process.cwd(), CONFIG_FILENAME);
  if (fs.existsSync(file)) {
    process.stderr.write(`${CONFIG_FILENAME} already exists, leaving it alone.\n`);
    return 1;
  }
  const example = {
    scope: {
      allow: [],
      deny: [],
    },
    protected: null,
    ignoreRules: [],
  };
  fs.writeFileSync(file, JSON.stringify(example, null, 2) + '\n');
  process.stdout.write(
    `Created ${CONFIG_FILENAME}.\n` +
      `  scope.allow  - globs the agent may touch (empty = everything)\n` +
      `  scope.deny   - globs that always fail the audit\n` +
      `  protected    - globs that warn when touched (null = built-in defaults)\n` +
      `  ignoreRules  - rule ids to silence, e.g. ["debug-leftover"]\n`
  );
  return 0;
}

function cmdInstallHook() {
  // Resolve the real hooks dir so this works with worktrees and submodules.
  const hooksDir = git(['rev-parse', '--git-path', 'hooks']).trim();
  const hookFile = path.resolve(hooksDir, 'pre-commit');
  const script = '#!/bin/sh\n# Installed by hallucinot. Audits staged changes before every commit.\nnpx --no-install hallucinot check || npx hallucinot check\n';
  if (fs.existsSync(hookFile)) {
    const existing = fs.readFileSync(hookFile, 'utf8');
    if (existing.includes('hallucinot')) {
      process.stdout.write('Pre-commit hook already installed.\n');
      return 0;
    }
    process.stderr.write(
      `A pre-commit hook already exists at ${hookFile}.\n` +
        'Add this line to it manually:\n  npx hallucinot check\n'
    );
    return 1;
  }
  fs.mkdirSync(path.dirname(hookFile), { recursive: true });
  fs.writeFileSync(hookFile, script, { mode: 0o755 });
  process.stdout.write(`Installed pre-commit hook at ${hookFile}\n`);
  return 0;
}

function cmdRules() {
  for (const r of listRules()) {
    process.stdout.write(`${r.severity.padEnd(5)}  ${r.id.padEnd(22)}  ${r.message}\n`);
  }
  return 0;
}

function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    process.stderr.write(err.message + '\n\n' + HELP + '\n');
    process.exit(2);
  }
  try {
    let code = 0;
    if (opts.command === 'help') process.stdout.write(HELP + '\n');
    else if (opts.command === 'version') process.stdout.write(pkg.version + '\n');
    else if (opts.command === 'init') code = cmdInit();
    else if (opts.command === 'install-hook') code = cmdInstallHook();
    else if (opts.command === 'rules') code = cmdRules();
    else code = cmdCheck(opts);
    process.exit(code);
  } catch (err) {
    process.stderr.write(`hallucinot: ${err.message}\n`);
    process.exit(2);
  }
}

module.exports = { main, parseArgs };
