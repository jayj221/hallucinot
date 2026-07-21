'use strict';
const { execFileSync } = require('child_process');

/**
 * Run git and return stdout. Throws with a friendly message on failure.
 */
function git(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd: cwd || process.cwd(),
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    const msg = (err.stderr || err.message || '').toString().trim();
    throw new Error(`git ${args.join(' ')} failed: ${msg}`);
  }
}

/**
 * Decide what to diff:
 *  - explicit range (e.g. "main..HEAD") wins
 *  - staged changes if any
 *  - otherwise working tree vs HEAD
 */
function getDiffText({ range, cwd } = {}) {
  const base = ['diff', '--no-color', '--no-ext-diff', '--unified=0'];
  if (range) return { text: git([...base, range], cwd), source: range };

  const staged = git(['diff', '--cached', '--name-only'], cwd).trim();
  if (staged) {
    return { text: git([...base, '--cached'], cwd), source: 'staged changes' };
  }
  return { text: git([...base, 'HEAD'], cwd), source: 'working tree vs HEAD' };
}

/**
 * Parse unified diff text into per-file structures:
 * { path, oldPath, isNew, isDeleted, isRename, added: [{line, text}], removed: [{text}] }
 */
function parseDiff(text) {
  const files = [];
  let cur = null;
  let newLineNo = 0;

  for (const raw of text.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      cur = {
        path: null,
        oldPath: null,
        isNew: false,
        isDeleted: false,
        isRename: false,
        isBinary: false,
        added: [],
        removed: [],
      };
      files.push(cur);
      continue;
    }
    if (!cur) continue;

    if (raw.startsWith('new file mode')) cur.isNew = true;
    else if (raw.startsWith('deleted file mode')) cur.isDeleted = true;
    else if (raw.startsWith('rename from')) cur.isRename = true;
    else if (raw.startsWith('Binary files')) cur.isBinary = true;
    else if (raw.startsWith('--- ')) {
      const p = raw.slice(4).trim();
      cur.oldPath = p === '/dev/null' ? null : p.replace(/^a\//, '');
    } else if (raw.startsWith('+++ ')) {
      const p = raw.slice(4).trim();
      cur.path = p === '/dev/null' ? null : p.replace(/^b\//, '');
    } else if (raw.startsWith('@@')) {
      const m = /@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
      newLineNo = m ? parseInt(m[1], 10) : 0;
    } else if (raw.startsWith('+')) {
      cur.added.push({ line: newLineNo, text: raw.slice(1) });
      newLineNo++;
    } else if (raw.startsWith('-')) {
      cur.removed.push({ text: raw.slice(1) });
    } else if (!raw.startsWith('\\')) {
      newLineNo++;
    }
  }

  // Normalize: path falls back to oldPath for deletions
  for (const f of files) {
    if (!f.path) f.path = f.oldPath;
  }
  return files.filter((f) => f.path && !f.isBinary);
}

module.exports = { git, getDiffText, parseDiff };
