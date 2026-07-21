'use strict';

// Scope enforcement: the part of the audit that asks "was the agent even
// allowed to touch this file?". Configured via .hallucinot.json in the
// repo root. Sensible defaults apply even with no config file, because
// some paths (CI workflows, env files, database migrations) should never
// change silently.

const fs = require('fs');
const path = require('path');
const { matchAny } = require('./glob');

const CONFIG_FILENAME = '.hallucinot.json';

// Paths flagged by default. Users can extend or replace via config.
const DEFAULT_PROTECTED = [
  '.env',
  '.env.*',
  '**/migrations/**',
  '.github/workflows/**',
  '**/*.pem',
  '**/id_rsa*',
];

// Lockfiles and the manifest that justifies changing them. A lockfile that
// moves on its own is a classic sign of an agent running installs it was
// never asked to run.
const LOCKFILE_MANIFESTS = {
  'package-lock.json': 'package.json',
  'yarn.lock': 'package.json',
  'pnpm-lock.yaml': 'package.json',
  'poetry.lock': 'pyproject.toml',
  'uv.lock': 'pyproject.toml',
  'Cargo.lock': 'Cargo.toml',
  'Gemfile.lock': 'Gemfile',
  'composer.lock': 'composer.json',
};

function loadConfig(cwd) {
  const file = path.join(cwd || process.cwd(), CONFIG_FILENAME);
  if (!fs.existsSync(file)) return { scope: {}, protected: null, ignoreRules: [] };
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Could not parse ${CONFIG_FILENAME}: ${err.message}`);
  }
  return {
    scope: parsed.scope || {},
    protected: Array.isArray(parsed.protected) ? parsed.protected : null,
    ignoreRules: Array.isArray(parsed.ignoreRules) ? parsed.ignoreRules : [],
  };
}

/**
 * Check every changed file against scope config.
 * - allow: if non-empty, any change outside these globs is an error
 * - deny: changes matching these globs are always an error
 * - protected: matches produce a warning (defaults used when not set)
 * - lockfile drift: lockfile changed but its manifest did not
 */
function checkScope(files, config) {
  const findings = [];
  const allow = config.scope.allow || [];
  const deny = config.scope.deny || [];
  const protectedGlobs = config.protected !== null && config.protected !== undefined
    ? config.protected
    : DEFAULT_PROTECTED;
  const changedPaths = new Set(files.map((f) => f.path));

  for (const file of files) {
    const p = file.path;
    if (deny.length && matchAny(deny, p)) {
      findings.push({
        rule: 'scope-violation',
        severity: 'error',
        file: p,
        line: 0,
        message: 'File matches a denied path',
        snippet: '',
      });
      continue;
    }
    if (allow.length && !matchAny(allow, p)) {
      findings.push({
        rule: 'scope-violation',
        severity: 'error',
        file: p,
        line: 0,
        message: 'File is outside the allowed scope',
        snippet: '',
      });
      continue;
    }
    if (protectedGlobs.length && matchAny(protectedGlobs, p)) {
      findings.push({
        rule: 'protected-path',
        severity: 'warn',
        file: p,
        line: 0,
        message: 'Sensitive path was modified; confirm this was intended',
        snippet: '',
      });
    }
    const base = p.split('/').pop();
    if (LOCKFILE_MANIFESTS[base]) {
      const dir = p.slice(0, p.length - base.length);
      const manifest = dir + LOCKFILE_MANIFESTS[base];
      if (!changedPaths.has(manifest)) {
        findings.push({
          rule: 'lockfile-drift',
          severity: 'warn',
          file: p,
          line: 0,
          message: `Lockfile changed but ${LOCKFILE_MANIFESTS[base]} did not`,
          snippet: '',
        });
      }
    }
  }
  return findings;
}

module.exports = { loadConfig, checkScope, CONFIG_FILENAME, DEFAULT_PROTECTED };
