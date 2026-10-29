'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseArgs } = require('../src/cli');

test('--range takes the next argument', () => {
  assert.strictEqual(parseArgs(['--range', 'main..HEAD']).range, 'main..HEAD');
});

test('--range without a value is an error, not a silent working-tree audit', () => {
  assert.throws(() => parseArgs(['--range']), /needs a value/);
  assert.throws(() => parseArgs(['--range', '--json']), /needs a value/);
});

test('a bare range is accepted as the positional argument', () => {
  assert.strictEqual(parseArgs(['main..HEAD']).range, 'main..HEAD');
});
