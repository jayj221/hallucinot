'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { runRules } = require('../src/rules');

// Helper to build a parsed-diff file object without running git.
function fileWith(path, addedLines, removedLines = [], flags = {}) {
  return {
    path,
    oldPath: path,
    isNew: false,
    isDeleted: false,
    isRename: false,
    isBinary: false,
    added: addedLines.map((text, i) => ({ line: i + 1, text })),
    removed: removedLines.map((text) => ({ text })),
    ...flags,
  };
}

function ruleIds(findings) {
  return findings.map((f) => f.rule);
}

test('flags placeholder stubs', () => {
  const findings = runRules([fileWith('src/a.js', ['  // add your logic here'])]);
  assert.ok(ruleIds(findings).includes('stub-left-behind'));
});

test('flags not-implemented bodies across languages', () => {
  const js = runRules([fileWith('src/a.js', ['throw new Error("Not implemented")'])]);
  const py = runRules([fileWith('src/a.py', ['    raise NotImplementedError'])]);
  const rs = runRules([fileWith('src/a.rs', ['    todo!()'])]);
  assert.ok(ruleIds(js).includes('not-implemented'));
  assert.ok(ruleIds(py).includes('not-implemented'));
  assert.ok(ruleIds(rs).includes('not-implemented'));
});

test('flags disabled tests only in test files', () => {
  const inTest = runRules([fileWith('src/a.test.js', ['it.skip("x", () => {})'])]);
  const inProd = runRules([fileWith('src/a.js', ['it.skip("x", () => {})'])]);
  assert.ok(ruleIds(inTest).includes('skipped-test'));
  assert.ok(!ruleIds(inProd).includes('skipped-test'));
});

test('flags assertions that cannot fail', () => {
  const findings = runRules([fileWith('test/a.spec.ts', ['expect(true).toBe(true);'])]);
  assert.ok(ruleIds(findings).includes('trivial-assertion'));
});

test('flags net loss of assertions in a modified test file', () => {
  const f = fileWith(
    'test/math.test.js',
    ['const r = add(1, 2);'],
    ['expect(add(1, 2)).toBe(3);', 'expect(add(0, 0)).toBe(0);']
  );
  const findings = runRules([f]);
  const hit = findings.find((x) => x.rule === 'weakened-assertions');
  assert.ok(hit);
  assert.match(hit.message, /2 removed, 0 added/);
});

test('does not flag assertion loss on brand-new test files', () => {
  const f = fileWith('test/new.test.js', ['expect(1 + 1).toBe(2);'], [], { isNew: true });
  assert.ok(!ruleIds(runRules([f])).includes('weakened-assertions'));
});

test('flags deleted test files', () => {
  const f = fileWith('test/gone.test.js', [], ['it("x", () => {});'], { isDeleted: true });
  assert.ok(ruleIds(runRules([f])).includes('deleted-test-file'));
});

test('flags swallowed errors across a line break', () => {
  const f = fileWith('src/a.js', ['try { risky(); } catch (e) {', '}']);
  assert.ok(ruleIds(runRules([f])).includes('swallowed-error'));
});

test('flags python except-pass', () => {
  const f = fileWith('src/a.py', ['except Exception:', '    pass']);
  assert.ok(ruleIds(runRules([f])).includes('swallowed-error'));
});

test('debug statements are info-level and prod-only', () => {
  const prod = runRules([fileWith('src/a.js', ['console.log("here");'])]);
  const tests = runRules([fileWith('src/a.test.js', ['console.log("here");'])]);
  const hit = prod.find((f) => f.rule === 'debug-leftover');
  assert.ok(hit);
  assert.strictEqual(hit.severity, 'info');
  assert.ok(!ruleIds(tests).includes('debug-leftover'));
});

test('flags unresolved conflict markers', () => {
  const f = fileWith('src/a.js', ['<<<<<<< HEAD']);
  assert.ok(ruleIds(runRules([f])).includes('conflict-marker'));
});

test('ignoreRules silences a rule', () => {
  const f = fileWith('src/a.js', ['console.log("x");']);
  const findings = runRules([f], { ignoreRules: ['debug-leftover'] });
  assert.ok(!ruleIds(findings).includes('debug-leftover'));
});

test('clean diff produces no findings', () => {
  const f = fileWith('src/a.js', ['const sum = (a, b) => a + b;', 'module.exports = { sum };']);
  assert.deepStrictEqual(runRules([f]), []);
});
