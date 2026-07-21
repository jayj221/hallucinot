'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { parseDiff } = require('../src/diff');

const FIXTURE = `diff --git a/src/app.js b/src/app.js
index 1111111..2222222 100644
--- a/src/app.js
+++ b/src/app.js
@@ -10,0 +11,2 @@ function handler() {
+  const x = 1;
+  console.log(x);
@@ -30,1 +32,0 @@ function other() {
-  return validate(input);
diff --git a/test/app.test.js b/test/app.test.js
deleted file mode 100644
index 3333333..0000000
--- a/test/app.test.js
+++ /dev/null
@@ -1,3 +0,0 @@
-it('works', () => {
-  expect(app()).toBe(42);
-});
diff --git a/docs/new.md b/docs/new.md
new file mode 100644
index 0000000..4444444
--- /dev/null
+++ b/docs/new.md
@@ -0,0 +1,1 @@
+# Hello
`;

test('parses files, additions, and removals with line numbers', () => {
  const files = parseDiff(FIXTURE);
  assert.strictEqual(files.length, 3);

  const app = files[0];
  assert.strictEqual(app.path, 'src/app.js');
  assert.strictEqual(app.added.length, 2);
  assert.strictEqual(app.added[0].line, 11);
  assert.strictEqual(app.added[1].line, 12);
  assert.strictEqual(app.removed.length, 1);
  assert.match(app.removed[0].text, /validate/);
});

test('detects deleted and new files', () => {
  const files = parseDiff(FIXTURE);
  assert.strictEqual(files[1].isDeleted, true);
  assert.strictEqual(files[1].path, 'test/app.test.js');
  assert.strictEqual(files[2].isNew, true);
});

test('empty diff produces no files', () => {
  assert.deepStrictEqual(parseDiff(''), []);
});
