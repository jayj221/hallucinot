# agent-audit

**Your AI agent says it's done. `agent-audit` checks if it's lying.**

[![CI](https://github.com/jayj221/agent-audit/actions/workflows/ci.yml/badge.svg)](https://github.com/jayj221/agent-audit/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/agent-audit.svg)](https://www.npmjs.com/package/agent-audit)
[![node >= 18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)
[![zero dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

AI coding agents have a well-documented habit: they claim a task is complete when it isn't. They leave `// TODO: implement` stubs, disable failing tests instead of fixing them, quietly delete assertions until the suite goes green, and wander into files nobody asked them to touch.

Linters can't catch most of this, because linters read files as they exist *now*. The worst agent tricks live in what was **removed** — and only the diff knows that.

`agent-audit` reads the diff.

```
$ npx agent-audit

agent-audit v0.1.0 — auditing staged changes

src/auth.js
  ✗ error  Placeholder comment where real code should be [stub-left-behind]:2
           // TODO: add your validation logic here
  ⚠ warn   Error caught and silently discarded [swallowed-error]:5
           catch (e) { }

test/auth.test.js
  ✗ error  Net loss of assertions: 2 removed, 1 added [weakened-assertions]
  ✗ error  Test was disabled instead of fixed [skipped-test]:1
           it.skip('rejects bad passwords', () => {
  ✗ error  Assertion that can never fail (test is gamed) [trivial-assertion]:2
           expect(true).toBe(true);

.env.production
  ⚠ warn   Sensitive path was modified; confirm this was intended [protected-path]

3 errors, 3 warnings  |  Slop score: 34/100 (F)
```

## Quick start

```sh
npx agent-audit            # audit staged changes (or working tree)
```

That's it. No install, no config, no API keys, no LLM calls. Pure diff analysis, deterministic, runs in milliseconds.

```sh
npx agent-audit --range main..HEAD    # audit a branch before merging
npx agent-audit --json                # machine-readable output
npx agent-audit install-hook          # block slop at commit time
npx agent-audit rules                 # list every detection rule
```

## Why a linter isn't enough

Suppose your agent "fixes" a failing test suite like this:

```diff
 it('rejects bad passwords', () => {
-  expect(login('a', 'wrong')).toBe(false);
-  expect(login('a', 'right')).toBe(true);
+  expect(true).toBe(true);
 });
```

Run any file-based linter on the result and it sees a perfectly clean test file. The evidence — two deleted assertions — no longer exists in the file. It only exists in the diff. That's the gap `agent-audit` covers:

| | File-based linters | agent-audit |
|---|---|---|
| Stub / placeholder code | ✅ | ✅ |
| Disabled tests (`it.skip`) | some | ✅ |
| **Deleted assertions** | ❌ invisible | ✅ |
| **Deleted test files** | ❌ invisible | ✅ |
| **Out-of-scope file edits** | ❌ | ✅ |
| **Lockfile changed without manifest** | ❌ | ✅ |

Use both. A linter judges your code. `agent-audit` judges your agent.

## What it detects

Run `npx agent-audit rules` for the live list.

| Rule | Severity | Catches |
|---|---|---|
| `weakened-assertions` | error | Test file lost more assertions than it gained |
| `deleted-test-file` | error | Entire test file removed |
| `skipped-test` | error | `it.skip`, `xdescribe`, `@pytest.mark.skip`, `t.Skip()` added |
| `trivial-assertion` | error | `expect(true).toBe(true)` and friends |
| `not-implemented` | error | `throw new Error("not implemented")`, `raise NotImplementedError`, `todo!()` |
| `stub-left-behind` | error | "add your logic here", "... existing code ...", "rest of the code" |
| `conflict-marker` | error | Unresolved `<<<<<<<` markers committed |
| `scope-violation` | error | File changed outside your configured allow list |
| `swallowed-error` | warn | `catch (e) {}`, `except: pass` |
| `mock-in-prod` | warn | `jest.mock` / `MagicMock` outside test files |
| `protected-path` | warn | Env files, migrations, CI workflows modified |
| `lockfile-drift` | warn | Lockfile changed, manifest didn't |
| `todo-added` | warn | New TODO/FIXME introduced |
| `debug-leftover` | info | `console.log`, `debugger`, `dbg!()` in non-test code |
| `large-change` | info | 400+ lines added to a single file |

Assertion and test detection covers JavaScript/TypeScript (jest, vitest, mocha), Python (pytest, unittest), Go, and Ruby test conventions.

## Scope enforcement

Tell the agent where it's allowed to work, then hold it to that. Create `.agent-audit.json` in your repo root (or run `npx agent-audit init`):

```json
{
  "scope": {
    "allow": ["src/billing/**", "test/billing/**"],
    "deny": ["**/secrets/**"]
  },
  "protected": null,
  "ignoreRules": ["debug-leftover"]
}
```

- `scope.allow` — if non-empty, any changed file outside these globs is an **error**. Set it per task: working on billing? Allow `src/billing/**` and nothing else.
- `scope.deny` — always an error, even inside the allow list.
- `protected` — globs that **warn** when touched. `null` uses the built-in defaults: `.env*`, `**/migrations/**`, `.github/workflows/**`, private keys.
- `ignoreRules` — silence rules that don't fit your project.

No config file? Slop detection and the default protections still run. Config is only needed for per-task scoping.

## As a pre-commit hook

```sh
npx agent-audit install-hook
```

Every commit is audited automatically; commits with error-level findings are blocked. Bypass intentionally with `git commit --no-verify` — the point is making slop a conscious choice instead of a silent default.

## In CI

```yaml
# .github/workflows/agent-audit.yml
name: agent-audit
on: pull_request
jobs:
  audit:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npx agent-audit --range origin/${{ github.base_ref }}..HEAD
```

Exit codes: `0` clean, `1` findings at failing severity, `2` git/usage error. Add `--strict` to fail on warnings too, or `--warn-only` to report without failing.

## Design principles

- **Deterministic.** Same diff in, same findings out. No LLM calls, no network, no flakiness. You can't fight nondeterministic agents with a nondeterministic reviewer.
- **Zero dependencies.** The entire tool is a few small files on top of `git diff`. Nothing to audit in *our* supply chain.
- **Diff-first.** Everything is scoped to what just changed. Adopting `agent-audit` on a 10-year-old codebase produces zero findings until an agent does something sloppy.
- **Fast enough to never skip.** Milliseconds on typical diffs. A check you skip is a check you don't have.

## Honest limitations

This is pattern-based analysis, and patterns have edge cases. A legitimately removed assertion (deleting a dead test on purpose) will flag — that's by design, the tool asks you to *confirm* deletions, not forbid them. Silence any rule via `ignoreRules`, skip one commit with `--no-verify`, or use `--warn-only` in reporting mode. If you hit a false positive that seems wrong rather than cautious, [open an issue](https://github.com/jayj221/agent-audit/issues) with the diff snippet.

## Contributing

Rules live in [`src/rules.js`](src/rules.js) — each is a small object with an id, severity, pattern, and message, so adding a detection is usually a few lines plus a test. `npm test` runs the suite (Node's built-in test runner, no dev dependencies either).

## License

[MIT](LICENSE)
