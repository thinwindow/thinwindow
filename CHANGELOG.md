# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org).

## [Unreleased]

### Fixed

- The tagline names the quantity behind each percentage. Re-reads are 87–96%
  of tokens; together with the first cache write, context is 73–84% of the
  bill (Claude Code's cost estimate, baseline runs), which the old wording
  left to be read off the token share. The reduction is 13–19% fewer tokens,
  counted on runs that passed their hidden check: Haiku 4.5's −23.0% over all
  runs includes a task where no ThinWindow run passed. The READMEs, the
  manifests and the site carry it, with the scope (eight tasks, two
  repositories), and CI checks every figure against the raw runs.
- Cost shares price cache writes at the 1-hour rate, which is what Claude
  Code writes: every recorded run's `total_cost_usd` matches it to the cent.
  The dry-run estimate used the 5-minute rate.

## [0.2.1] - 2026-09-26

Fixes the one Sonnet 5 regression the traces explained, and brings the docs
in line with what 0.2.0 does.

### Fixed

- A `| head` cap on `cat` of several files is dropped when the files add up to
  more lines than the cap but at most `maxReadLines`: cutting a short
  concatenation can only drop whole files, which cost a turn to fetch again
  (#7). Sonnet 5's `commander-ci-config` went from +29.3% to +3.9% tokens, and
  Sonnet 5 overall from −11.6% to −13.2%; the superseded runs are archived.
- README and site: the FAQ's Haiku failure and the noise example now quote what
  the raw runs show, and the turns comparison no longer calls Opus 5.5's cost
  cut the largest (Haiku 4.5's is).
- Docs: the READMEs, the skill and the manual test describe what 0.2.0 does
  on retries, rewrites and `thinwindow-run`'s output, and the plugin and
  marketplace manifests carry the project slogan (#8).

### Changed

- `CONTRIBUTING.md` sets one voice for issue and PR titles (#9).

## [0.2.0] - 2026-09-25

The first measured version: 112 benchmark runs on Opus 5.5, Sonnet 5 and
Haiku 4.5.

### Changed

- The rules cover four ways to spend fewer tokens: read less, print less,
  write less code, and say less.
- A large whole-file Read returns the first 120 lines and an outline of the
  file instead of a denial; repeating the call returns the full file.
- A recursive search over the whole tree is limited to 100 lines, and a bare
  `git diff` runs as `git diff --stat`, instead of a soft block.
- `thinwindow-run` prints only the last 10 lines of a command that succeeded.
- `rewrite` is now on by default: noisy commands run through `thinwindow-run`
  instead of being denied, because each denial costs the agent a whole turn
  that re-sends the full context. `"rewrite": false` restores the soft block.
- The benchmark chart shows the per-task change as diverging bars instead of
  two absolute totals.
- The repository moved to `thinwindow/thinwindow`; install commands and links
  point there.

### Added

- Content searches with Claude Code's Grep tool get `head_limit: 100`.
- The benchmark records what thinwindow did in each run (`thinwindow`: denials
  and rewrites per tool) and, for failed runs, the agent's changes and final
  message (`agentStatus`, `agentDiff`, `agentFinal`).
- The benchmark installs each task's dependencies before the agent starts
  (`setup`) and records every run's tool-call trace.
- Benchmark results for Haiku 4.5, Sonnet 5 and Opus 5.5 in `bench/results/`,
  with charts and a report; earlier runs are archived in
  `bench/results/archive/`.
- README with the measured results, method, limitations and disclaimer, in
  English, Spanish and Portuguese.
- The ThinWindow logo and icon set in `assets/`.
- A documentation site in `website/` (not deployed yet).

### Fixed

- README: Sonnet 5 took 1.6% more turns with thinwindow, not fewer.

### Removed

- Rules that counted turns as the main cost, added and reverted within this
  release after they made Sonnet 5 worse (−11.6% → +1.9% tokens). Their runs
  are kept in `bench/results/archive/`.

## [0.1.0] - 2026-09-24

The first complete build: rules, Claude Code plugin, `thinwindow-run` and the
benchmark harness. No benchmark results were recorded at this version.

### Added

- `rules/thinwindow.md`: the reading rules, within a 2,000-character budget
  enforced in CI.
- Agent Skill `skills/thinwindow` with the rules and a bundled
  `thinwindow-run`, installable with `npx skills add thinwindow/thinwindow`.
- Claude Code plugin and marketplace (`/plugin marketplace add
  thinwindow/thinwindow`, `/plugin install thinwindow@thinwindow`).
- SessionStart hook that injects the rules and resets read tracking after
  compaction.
- PreToolUse `Read` guard: large-file guard, re-read guard, soft block.
- PreToolUse `Bash` guard: denies `cat` of big, lock, minified or binary
  files, `git log` without `-n`, `ls -R`, `tree` without `-L` and `find` from
  the repo root without `-maxdepth`; soft-blocks uncapped noisy commands, or
  rewrites them to `thinwindow-run` with `"rewrite": true`.
- PreToolUse `Bash` guard: soft-blocks a recursive `grep`/`egrep`/`fgrep`/
  `rg`/`ag` over the whole tree with no result cap and no exclude, and
  `git diff` with no `--stat` (or similar) and no path.
- `thinwindow-run`: runs a command, keeps the full log in the OS temp dir and
  prints the exit code, duration, last 40 lines, matching error lines and
  the log path.
- Configuration through `.thinwindow.json` / `~/.thinwindow.json`, the
  `THINWINDOW=off` switch and `THINWINDOW_DEBUG=1`.
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

### Fixed

- The `Bash` guard's `~` handling no longer treats a `~` inside a path
  (Windows short names like `RUNNER~1`) as the home directory; only a
  leading `~` is.

[Unreleased]: https://github.com/thinwindow/thinwindow/compare/v0.2.1...HEAD
[0.2.1]: https://github.com/thinwindow/thinwindow/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/thinwindow/thinwindow/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/thinwindow/thinwindow/releases/tag/v0.1.0
