# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- `rules/thinwindow.md`: the reading rules, within a 2,000-character budget
  enforced in CI.
- Agent Skill `skills/thinwindow` with the rules and a bundled
  `thinwindow-run`, installable with `npx skills add imprvhub/thinwindow`.
- Claude Code plugin and marketplace (`/plugin marketplace add
  imprvhub/thinwindow`, `/plugin install thinwindow@thinwindow`).
- SessionStart hook that injects the rules and resets read tracking after
  compaction.
- PreToolUse `Read` guard: large-file guard, re-read guard, soft block.
- PreToolUse `Bash` guard: denies `cat` of big, lock, minified or binary
  files, `git log` without `-n`, `ls -R`, `tree` without `-L` and `find` from
  the repo root without `-maxdepth`; soft-blocks uncapped noisy commands, or
  rewrites them to `thinwindow-run` with `"rewrite": true`.
- `thinwindow-run`: runs a command, keeps the full log in the OS temp dir and
  prints the exit code, duration, last 40 lines, matching error lines and
  the log path.
- Configuration through `.thinwindow.json` / `~/.thinwindow.json`, the
  `THINWINDOW=off` switch and `THINWINDOW_DEBUG=1`.
- `adapters/AGENTS.md` snippet for agents that read AGENTS.md.
- CI, issue and PR templates, contributing guide, security policy and code
  of conduct.
- Benchmark in `bench/`: 8 tasks on tj/commander.js and pallets/click
  pinned to commits, `bench/run.mjs` (fresh clone per run, sandboxed
  `claude -p`, verify, JSONL results, `--dry-run` with a cost estimate,
  `--max-cost`), `bench/report.mjs` (markdown table and SVG chart) and
  `bench/validate-tasks.mjs` (each task fails before and passes with its
  reference solution).
