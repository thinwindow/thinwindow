# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org).

## [Unreleased]

### Added

- `rules/skinflint.md`: the reading rules, within a 2,000-character budget
  enforced in CI.
- Agent Skill `skills/skinflint` with the rules and a bundled
  `skinflint-run`, installable with `npx skills add imprvhub/skinflint`.
- Claude Code plugin and marketplace (`/plugin marketplace add
  imprvhub/skinflint`, `/plugin install skinflint@skinflint`).
- SessionStart hook that injects the rules and resets read tracking after
  compaction.
- PreToolUse `Read` guard: large-file guard, re-read guard, soft block.
- PreToolUse `Bash` guard: denies `cat` of big, lock, minified or binary
  files, `git log` without `-n`, `ls -R`, `tree` without `-L` and `find` from
  the repo root without `-maxdepth`; soft-blocks uncapped noisy commands, or
  rewrites them to `skinflint-run` with `"rewrite": true`.
- `skinflint-run`: runs a command, keeps the full log in the OS temp dir and
  prints the exit code, duration, last 40 lines, matching error lines and
  the log path.
- Configuration through `.skinflint.json` / `~/.skinflint.json`, the
  `SKINFLINT=off` switch and `SKINFLINT_DEBUG=1`.
- `adapters/AGENTS.md` snippet for agents that read AGENTS.md.
- CI, issue and PR templates, contributing guide, security policy and code
  of conduct.
- Funding links (`.github/FUNDING.yml`) and labels as code
  (`.github/labels.json`, synced by the Labels workflow).
- Benchmark in `bench/`: 8 tasks on tj/commander.js and pallets/click
  pinned to commits, `bench/run.mjs` (fresh clone per run, sandboxed
  `claude -p`, verify, JSONL results, `--dry-run` with a cost estimate,
  `--max-cost`), `bench/report.mjs` (markdown table and SVG chart) and
  `bench/validate-tasks.mjs` (each task fails before and passes with its
  reference solution).
- PreToolUse `Bash` guard: soft-blocks a recursive `grep`/`egrep`/`fgrep`/
  `rg`/`ag` over the whole tree with no result cap and no exclude, and
  `git diff` with no `--stat` (or similar) and no path.

### Fixed

- The `Bash` guard's `~` handling no longer treats a `~` inside a path
  (Windows short names like `RUNNER~1`) as the home directory; only a
  leading `~` is.
