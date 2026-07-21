'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { checkScope } = require('../src/scope');

function fileAt(path) {
  return { path, added: [], removed: [], isNew: false, isDeleted: false };
}

function ruleIds(findings) {
  return findings.map((f) => f.rule);
}

const NO_CONFIG = { scope: {}, protected: null, ignoreRules: [] };

test('allow list: files outside scope are violations', () => {
  const config = { scope: { allow: ['src/**', 'test/**'] }, protected: [], ignoreRules: [] };
  const findings = checkScope([fileAt('src/ok.js'), fileAt('scripts/sneaky.sh')], config);
  assert.strictEqual(findings.length, 1);
  assert.strictEqual(findings[0].file, 'scripts/sneaky.sh');
  assert.strictEqual(findings[0].rule, 'scope-violation');
});

test('empty allow list means everything is in scope', () => {
  const findings = checkScope([fileAt('anywhere/file.js')], { ...NO_CONFIG, protected: [] });
  assert.deepStrictEqual(findings, []);
});

test('deny list always wins', () => {
  const config = { scope: { allow: ['**'], deny: ['**/secrets/**'] }, protected: [], ignoreRules: [] };
  const findings = checkScope([fileAt('app/secrets/keys.json')], config);
  assert.ok(ruleIds(findings).includes('scope-violation'));
});

test('default protected paths warn: env files, migrations, workflows', () => {
  const findings = checkScope(
    [fileAt('.env.production'), fileAt('db/migrations/002.sql'), fileAt('.github/workflows/ci.yml')],
    NO_CONFIG
  );
  assert.strictEqual(findings.filter((f) => f.rule === 'protected-path').length, 3);
  assert.ok(findings.every((f) => f.severity === 'warn'));
});

test('lockfile drift: lockfile without manifest warns', () => {
  const alone = checkScope([fileAt('package-lock.json')], { ...NO_CONFIG, protected: [] });
  assert.ok(ruleIds(alone).includes('lockfile-drift'));

  const together = checkScope(
    [fileAt('package-lock.json'), fileAt('package.json')],
    { ...NO_CONFIG, protected: [] }
  );
  assert.ok(!ruleIds(together).includes('lockfile-drift'));
});

test('lockfile drift respects directories', () => {
  const findings = checkScope(
    [fileAt('packages/api/Cargo.lock'), fileAt('packages/api/Cargo.toml')],
    { ...NO_CONFIG, protected: [] }
  );
  assert.ok(!ruleIds(findings).includes('lockfile-drift'));
});
