# Changelog

All notable changes to this project are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project uses [Semantic Versioning](https://semver.org).

## [Unreleased]

0.3.0 was measured, packaged and tagged at three different commits:

- measured: `6546385`, the commit every 0.3.0 benchmark run used;
- packaged: `f6d074a`, from which `scripts/build-directory.mjs` built the
  `directory` branch at `a7cb8ce`, the commit the plugin directory installs;
- tagged: `v0.3.0`, at `b874cf1`.

The hooks, the skill and the rules are the same at all three; only the
manifest's description differs.

### Added

- `/thinwindow:report`: where your sessions' context cost went, from your own
  transcripts, as aggregate numbers. `--json` prints a summary you can choose
  to share. The skill is user-invoked only, so it adds nothing to the skill
  listing.
- `/thinwindow:resume`: after `/clear`, start from a brief of at most ~150
  tokens of your last session in this project instead of re-paying its whole
  context. A Stop hook keeps the brief at every turn without calling a model;
  it is stored in the plugin's data folder, deleted after 7 days, and turned
  off with `"briefs": false`.
- `/thinwindow:brief`: Claude writes a handoff of the session while the cache
  is still warm, kept in the brief.

## [0.3.0] - 2026-10-02

### Measured

- 128 runs at `6546385` with Claude Code 2.1.287: Opus 5.5 and Sonnet 5.5
  with three runs per task and condition, Haiku 4.5 with two. Against the runs
  without ThinWindow: 7–11% lower cost and 3–6% fewer tokens on runs that
  passed their hidden check, with the same success rate on all three models.
  Opus 5.5: −10.5% cost (95% CI −16.5% to −3.0%), −2.9% tokens. Sonnet 5.5:
  −6.5% cost, −2.6% tokens. Haiku 4.5: −7.7% cost, −3.3% tokens (−5.8% on
  runs that passed). Only the Opus cost interval excludes zero.
- 0.2.2 measured 13–19% fewer tokens with Claude Code 2.1.282; its runs are in
  `bench/results/archive/`. The 0.3.0 runs came from two accounts whose
  Claude Code sessions start with different built-in tools; both conditions of
  each task share the same mix.

### Added

- The benchmark measures Sonnet 5.5, which the `sonnet` alias now resolves to
  (#21). Each run is filed under the model its `modelUsage` shows did the
  work, not under what the alias maps to, and records its effort level as
  Claude Code reports it, or `default`. Sonnet 5's runs move to
  `bench/results/archive/`.
- The trace keeps the last 200 characters of each tool result
  (`traceTails`), so a repeated attempt can be read from the result files
  (#7).
- `scripts/build-directory.mjs` builds the `directory` branch the plugin
  directory tracks: only the plugin's files, with the README's links and
  images pinned to the commit it packages.
- The manifest names a support page (the issues) and a privacy page (what
  ThinWindow reads, writes and sends).
- The READMEs show how to install from the plugin directory and link a video
  of the install from the Claude desktop app.
- A README section on what changed between the 0.2.2 and 0.3.0 measurements
  (Claude Code, the Sonnet model, the account environment) and what it did to
  the numbers.

### Changed

- The plugin ships no `bin/`. Cowork and the Claude apps refuse a plugin with
  a top-level `bin/`, and the directory holds its versions for a reviewer
  (#13). The Bash hook now runs `thinwindow-run` as
  `node '<plugin dir>/skills/thinwindow/scripts/thinwindow-run.mjs'` and points
  a direct `thinwindow-run` call at the same path, so the rules and the output
  the agent sees are unchanged.
- **Breaking:** permission rules: `Bash(thinwindow-run *)` no longer matches. Allow
  `Bash(node '*/skills/thinwindow/scripts/thinwindow-run.mjs' *)` instead.
- The hooks read three environment variables by name (`THINWINDOW`,
  `THINWINDOW_DEBUG`, `CLAUDE_PROJECT_DIR`) instead of passing the whole
  environment around. Behaviour is unchanged.
- The README's tagline links to the page that backs it (#20).
- The tagline leads with what 0.3.0 measured: 7–11% lower cost and 3–6% fewer
  tokens on Opus 5.5, Sonnet 5.5 and Haiku 4.5, with the same success rate.
  `scripts/check.mjs` holds the cost range to the runs, as it does the token
  range. The READMEs and the site add "Listed in the official Claude Code
  plugin directory."
- The results, the site and `report.json` say every run was measured in
  Claude Code, not in Cowork or the Claude apps.
- The tagline names Claude Code, Cowork and the Claude apps, the surfaces the
  plugin directory lists ThinWindow for, and says the benchmark ran in Claude
  Code. The Spanish README is written in the third person.
- CI actions updated (#22–#26).

### Fixed

- `thinwindow-run` prints a short output as it is: when nothing would be cut
  (at most 10 lines on success, 40 on failure) there is no command echo, line
  count or log path, only the exit code if the command failed. It used to wrap
  every output in a summary, and the hook added a note, which made short
  output longer (#18).
- `git diff <file>` keeps its diff. The guard counted a path only after `--`,
  so a diff the agent asked for by name came back as `--stat` (#18).

## [0.2.2] - 2026-09-27

States each result with its uncertainty and names the quantity behind each
percentage. The plugin behaves as in 0.2.1.

### Added

- `bench/input-size.mjs` replays every Read and Bash call of the baseline
  runs without a model, in fresh clones, and measures the characters of tool
  output with and without the hooks; `bench/results/input-size.json` keeps the
  result. The README reports it in its own section, apart from the cost
  figures, and says why a smaller tool output is not a smaller bill.
- `docs/WHERE-THE-TOKENS-GO.md`: each kind of token's share of tokens and of
  cost per model, the prices and their reconciliation with `total_cost_usd`,
  the pay-twice cost model, the tool calls per model, what the hooks did in
  each run, and how the totals move when stopped or failed runs are left out.
  Every table is generated from the raw runs.

### Changed

- Results show their uncertainty. Each total carries a 95% bootstrap interval
  over the tasks, and each task in the charts a whisker over every pairing of
  a ThinWindow run with a baseline run. Where the interval includes zero, the
  chart says the change can't be told apart from none.
- Haiku 4.5 is reported over all runs and over passing runs only, with the
  runs the turn cap stopped in each condition, and the README states that its
  ThinWindow runs failed the hidden check more often than its baseline runs.
- The cache table shows each kind of token's share of the cost next to its
  share of tokens.

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
- The FAQ and the site said output is about 1% of the bill. That is its share
  of tokens; priced, it is 16–27% of the cost of the baseline runs.

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

[Unreleased]: https://github.com/thinwindow/thinwindow/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/thinwindow/thinwindow/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/thinwindow/thinwindow/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/thinwindow/thinwindow/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/thinwindow/thinwindow/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/thinwindow/thinwindow/releases/tag/v0.1.0
