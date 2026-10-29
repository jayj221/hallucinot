# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Inline suppression directives, `// hallucinot-disable-line` and
  `// hallucinot-disable-next-line [rule ...]`, for waving through a single
  intentional finding without silencing a rule repo-wide (`ignoreRules`) or
  bypassing the whole commit (`--no-verify`). Optional rule ids scope the
  suppression; text after `--` is treated as a description and ignored.
- Directory globs with a trailing slash (`dist/`) now match everything under
  that directory, the way `.gitignore` reads them.

### Fixed
- `--range` with no value now exits with an error instead of silently
  auditing the working tree.

## [0.1.0]

### Added
- Initial release: deterministic, zero-dependency diff auditor for AI-agent
  slop and scope violations.
- Detection rules for stubs, gamed and weakened tests, skipped/deleted tests,
  swallowed errors, conflict markers, debug leftovers, and more.
- Scope enforcement via `.hallucinot.json` (allow/deny globs, protected paths).
- `--json` output, pre-commit hook installer, and CI integration.

[Unreleased]: https://github.com/jayj221/hallucinot/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/jayj221/hallucinot/releases/tag/v0.1.0
