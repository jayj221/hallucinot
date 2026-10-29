'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { matchGlob } = require('../src/glob');

test('single star stays within a path segment', () => {
  assert.ok(matchGlob('src/*.js', 'src/index.js'));
  assert.ok(!matchGlob('src/*.js', 'src/lib/index.js'));
});

test('double star crosses segments', () => {
  assert.ok(matchGlob('src/**/*.js', 'src/a/b/c.js'));
  assert.ok(matchGlob('src/**', 'src/anything/here.txt'));
});

test('**/ matches zero segments too', () => {
  assert.ok(matchGlob('**/migrations/**', 'db/migrations/001.sql'));
  assert.ok(matchGlob('**/migrations/**', 'migrations/001.sql'));
});

test('slash-free patterns match basenames anywhere', () => {
  assert.ok(matchGlob('.env.*', 'config/.env.production'));
  assert.ok(matchGlob('*.pem', 'certs/server.pem'));
  assert.ok(!matchGlob('*.pem', 'src/pemparser.js'));
});

test('question mark matches exactly one character', () => {
  assert.ok(matchGlob('file?.txt', 'file1.txt'));
  assert.ok(!matchGlob('file?.txt', 'file12.txt'));
});

test('regex metacharacters in paths are treated literally', () => {
  assert.ok(matchGlob('a+b/*.js', 'a+b/x.js'));
  assert.ok(!matchGlob('a+b/*.js', 'aab/x.js'));
});

test('trailing slash matches everything under that directory', () => {
  assert.ok(matchGlob('dist/', 'dist/a.js'));
  assert.ok(matchGlob('dist/', 'dist/nested/b.js'));
  assert.ok(!matchGlob('dist/', 'distro/a.js'));
});
