'use strict';

// Minimal glob matcher so we can stay dependency-free.
// Supports: ** (any depth), * (within a segment), ? (single char).
// A pattern without a slash matches against the basename as well as the
// full path, which is what people intuitively expect from ".env*".

function globToRegExp(pattern) {
  let re = '';
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i];
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        // "**/" collapses to "match zero or more whole segments";
        // a bare "**" matches anything including slashes.
        if (pattern[i + 2] === '/') {
          re += '(?:[^/]+/)*';
          i += 3;
        } else {
          re += '.*';
          i += 2;
        }
      } else {
        re += '[^/]*';
        i += 1;
      }
    } else if (ch === '?') {
      re += '[^/]';
      i += 1;
    } else {
      re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
      i += 1;
    }
  }
  return new RegExp('^' + re + '$');
}

function matchGlob(pattern, filePath) {
  const rx = globToRegExp(pattern);
  if (rx.test(filePath)) return true;
  // Slash-free patterns also match the basename anywhere in the tree.
  if (!pattern.includes('/')) {
    const base = filePath.split('/').pop();
    return rx.test(base);
  }
  return false;
}

function matchAny(patterns, filePath) {
  return patterns.some((p) => matchGlob(p, filePath));
}

module.exports = { globToRegExp, matchGlob, matchAny };
