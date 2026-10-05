# thinwindow — product spec

Source of truth for building thinwindow. Read it fully before writing code.

## One-liner

thinwindow makes coding agents read less: fewer tokens per task, same results,
proven by a public benchmark.

## Why

- Most of the tokens an agent burns are input, not output: whole-file reads,
  re-reads, install/build/test logs, broad greps and directory listings.
  Everything read stays in context and is re-sent on every later turn, so early
  bloat compounds for the rest of the session.
- Output-side tricks ("make the agent talk less") cut the cheap part. thinwindow
  targets the expensive part: what the agent reads.
- Origin story for the README: an agent burned a large share of a Pro plan's
  budget to change the copyright year in a website footer. The benchmark
  includes that exact task, so the README can quote a measured number instead
  of an anecdote.

## Principles

1. Every number in the docs comes from `bench/`. No invented figures.
2. Success rate must not drop. Savings that cost correctness do not count.
3. thinwindow's own footprint is budgeted: the always-loaded rules
   (`rules/thinwindow.md`) stay at or under 500 tokens (~2,000 characters).
   CI enforces it.
4. Zero runtime dependencies. Node >= 18, ESM. Works on macOS, Linux, Windows.
5. Fail open: any hook error allows the tool call. thinwindow must never block
   someone's work because of its own bug.
6. Easy off switch: `THINWINDOW=off`, or `"enabled": false` in config.
7. Never phones home. No telemetry of any kind.

## Components (v0.1)

### 1. Rules — `rules/thinwindow.md`

Single source of truth for the behaviour, injected into the agent's context.
Short imperative rules, final wording tuned with the benchmark. Starting set:

- Locate before reading: grep or glob for the symbol, then read only the range
  around the matches.
- Don't read a whole file over ~300 lines. Read ranges.
- Don't re-read what is already in context unless the file changed.
- Cap command output: quiet flags, `| tail -n 40`, `--max-count`, or run noisy
  commands through `thinwindow-run`.
- Summaries before detail: `git diff --stat`, `git log -n 10 --oneline`.
- Stop exploring once there is enough evidence to act.
- Batch independent lookups into one call.
- In answers, cite `file:line` instead of pasting large blocks.

### 2. Agent Skill — `skills/thinwindow/SKILL.md`

Agent Skills standard (`name` and `description` frontmatter). The body holds the
rules plus how to use `thinwindow-run`. Works with any agent that supports
skills (Claude Code, Codex, Cursor, Copilot, Gemini CLI, OpenCode...). The layout
must also work with `npx skills add thinwindow/thinwindow`.

### 3. Claude Code plugin (enforcement)

The repo is its own plugin marketplace: `.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json`. Install with
`/plugin marketplace add thinwindow/thinwindow`, then
`/plugin install thinwindow@thinwindow`.

Before coding, read the current Claude Code docs for hooks (input/output JSON,
`permissionDecision`, `additionalContext`, `updatedInput`), plugins and
marketplaces. They change often. Cite the doc URL in a comment wherever a schema
matters.

Hooks (`hooks/hooks.json`, Node scripts in `hooks/`):

- **SessionStart** (startup, resume, clear, compact): inject
  `rules/thinwindow.md` as additional context. On `compact`, reset the
  read-tracking state, because the content read before compaction is gone.
- **PreToolUse `Read`**
  - Large-file guard: the file has more than `maxReadLines` lines (default 400)
    and no offset/limit → return the first 120 lines plus a line-numbered
    outline of the file (`updatedInput` + `additionalContext`), so no turn is
    spent on a denial. With `"rewrite": false`, deny with the line count and a
    grep-plus-range suggestion.
  - Re-read guard: same file and range already read in this session and the
    file is unchanged (mtime + size) → deny with "already in context".
  - Soft block: an immediate retry of the same call is allowed, so the agent
    can never deadlock. Check how Claude Code's "read before edit" rule treats
    ranged reads. If a ranged read doesn't satisfy it, the soft block covers it.
- **PreToolUse `Bash`**
  - Deny clear anti-patterns and suggest a replacement: `cat` of big files,
    `git log` without `-n`, `ls -R` or `tree` without a depth, `find` without
    `-maxdepth` from the repo root, printing lockfiles or minified or binary
    files.
  - Noisy commands (install/build/test/lint, configurable list) that aren't
    already capped → wrapped with `thinwindow-run` through `updatedInput`
    (`"rewrite": true`, the default since the first Sonnet 5 runs: a denial
    costs the agent a whole turn, which re-sends the full context). With
    `"rewrite": false`, a soft block that suggests `thinwindow-run <cmd>`.
- **PreToolUse `Grep`**: a content search with no `head_limit` gets
  `head_limit: 100`.
- **Stop**: update the session brief (#33) from what the transcript gained
  since the last Stop, plus `git status` after a turn that could write files.
  Prints nothing. Claude Code runs Stop hooks synchronously; `async` applies
  to tool events only. Then the setup-cost notice (#35): when the session's
  first request (from the transcript's first 256 KB) is at least
  `setupNoticeMinTokens` (40k), a `systemMessage` with its size and three
  largest setup parts, at most once a week per project, only in attended
  sessions.
- **UserPromptSubmit**: the cold-resume notice (#34). When the session's last
  request (read from the transcript's last 256 KB) is over an hour old and its
  context is at least `coldResumeMinTokens` (100k), hold the prompt once with
  what continuing re-writes and what a fresh start re-writes. Sending again
  continues. Never hold a command, a prompt Claude Code writes itself, or a
  prompt in a session no person attends (`-p`, SDK, background).
- **`thinwindow-run`** (`skills/thinwindow/scripts/thinwindow-run.mjs`): the
  plugin ships no `bin/`, which Cowork and the Claude apps refuse, so the Bash
  hook runs it as `node '<path>'` and points a direct `thinwindow-run` call at
  the same path. It runs the command, saves the full stdout and stderr to
  a log in the OS temp dir (never inside the user's repo), prints the exit code,
  the duration, the last 10 lines on success (on failure, the last 40 lines and
  up to 40 deduplicated earlier lines that match error/fail/warn/panic/exception),
  and the log path. When nothing would be cut (at most 10 lines on success, 40 on
  failure), it prints the output unchanged, plus the exit code on failure.
  Preserves the exit code.
- State: one JSON file per session in the OS temp dir, keyed by `session_id`.
- Config: `.thinwindow.json` in the project root, or `~/.thinwindow.json`, for
  thresholds, noisy-command patterns, an allowlist, `rewrite` and `enabled`.
- Debug: `THINWINDOW_DEBUG=1` writes decisions to stderr.

### 4. Other agents (v0.1 = rules only)

- `adapters/AGENTS.md`: a snippet for agents that read AGENTS.md (Codex, Cursor,
  Copilot, Gemini CLI...).
- Enforcement for other agents' hook systems is left to the community (label
  `adapter`). Verify each agent's current docs before claiming support.

### 5. Benchmark — `bench/`

- Tasks: `bench/tasks/<id>.json` with `{ repo, commit, prompt, verify, timeout }`.
  `repo` is a public git URL pinned to a SHA. `verify` is a shell command whose
  exit code 0 means success.
- 8 to 10 tasks on 2 or 3 permissively licensed real repos (one TS/Node, one
  Python, optionally an Astro or Vue site). Mix: a bug fix with a failing test,
  a small feature plus a test, a cross-file rename, a config lookup that writes
  a verifiable answer file, a refactor, and "make the footer copyright year
  update automatically" (the origin story).
- Runner: `node bench/run.mjs --condition baseline|thinwindow --reps N --model <m> [--tasks ids]`
  - A fresh temp clone at the pinned commit for every run.
  - `claude -p "<prompt>" --output-format json --model <m> --max-turns 40`,
    plus the plugin (`--plugin-dir`) for the thinwindow condition. Permissions
    allow edits and shell inside the temp dir only.
  - Record from the JSON result: input, cache-creation, cache-read and output
    tokens, `total_cost_usd`, `num_turns`, `duration_ms` and `is_error`. Then run
    `verify` to get success or failure.
  - Append each run to `bench/results/<date>-<model>.jsonl`.
  - `--dry-run` prints the plan and a cost estimate. `--max-cost <usd>` stops
    when the cumulative cost passes it. Ivan's budget is limited: the launch
    numbers must fit in about 30 to 40 runs (for example 8 tasks × 2 conditions
    × 2 reps).
- Report: `node bench/report.mjs` produces a markdown table (per task and in
  total: median tokens, cost, turns, success rate, Δ%) and an SVG bar chart for
  the README. Commit the raw JSONL.
- Honesty: report medians and spread, include failures, and state the model,
  the Claude Code version and the date. Disclose that the rules were tuned on
  these tasks. Launch target: at least 25% fewer total tokens at an equal
  success rate. If the target isn't met, iterate. Don't lower the bar.
- The build environment may not have an authenticated `claude` CLI. The runner
  must work with `--dry-run` and unit tests. Full runs happen wherever Ivan
  chooses.

### 6. Repo hygiene (so it can run unattended)

- CI (GitHub Actions): `node --test`, JSON validation for the plugin,
  marketplace and task files, a SKILL.md frontmatter check, and the rules token
  budget check.
- `.github/`: issue templates (bug, rule proposal, agent adapter, benchmark
  task), a PR template, `CODEOWNERS` (@imprvhub), `FUNDING.yml` (copy from
  `cinemagoria/.github`), dependabot for actions, and a stale workflow (60 days).
- `CONTRIBUTING.md` (a new rule must come with a benchmark delta), `SECURITY.md`,
  `CODE_OF_CONDUCT.md` (Contributor Covenant), `CHANGELOG.md`, `LICENSE` (MIT).
- `README.md`, `README.es.md` and `README.pt-BR.md` are written last, from
  measured results: hook line, GIF, one-command install per agent, benchmark
  table and chart, how it works, config, FAQ ("does it make my agent dumber?"
  → success rates).

## Milestones

- **M1 Build:** rules, skill, plugin and hooks with tests, `thinwindow-run`,
  config, CI, repo hygiene. Include manual steps to check that the hooks fire
  in a real Claude Code session.
- **M2 Bench:** tasks, runner, report, a passing `--dry-run`.
- **M3 Measure and tune:** full runs, tune the rules and thresholds, freeze the
  numbers.
- **M4 Launch kit:** the three READMEs, a VHS tape for the GIF, and launch post
  drafts (Show HN, r/ClaudeAI, r/ClaudeCode, X, LinkedIn, dev.to, and Spanish
  and Portuguese communities) on a `launch` branch that is never merged. Ivan
  publishes everything.

Out of scope for v0.1: an npm package, anything hosted, telemetry.

## Direction (0.4.0)

0.4.0 widens thinwindow's scope from the single tool call to the whole
session. The analysis behind it and the work list are in
[#30](https://github.com/thinwindow/thinwindow/issues/30). Where this section
and the v0.1 sections above disagree, this section applies to 0.4.0 work.

### Cost model

A session's context is paid on every request, and once more, in full, when the
session resumes after its cache entry expired. For a session of n requests:

```
cost ≈ Σᵢ [ (P + Cᵢ)·r + Nᵢ·w + Oᵢ·o ]  +  Σ_cold (P + C)·w
```

- P: the fixed prefix (system prompt, tool schemas, skill and agent listings,
  MCP instructions, CLAUDE.md). Cᵢ: the conversation before request i.
- Nᵢ: content written to the cache at request i. Oᵢ: output, thinking included.
- r, w, o: cache-read, cache-write and output prices. Σ_cold: requests sent
  after the cache entry expired. Claude Code writes 1-hour entries.

Beyond single tool calls, work on three levers: P × n, the lifetime of C, and O.

### Four moments

Each feature belongs to one moment of a session. Every 0.3.0 mechanism stays.

1. **Start: show what every request carries.**
   - After the first response of a session, a Stop hook reads that request's
     usage and attachment records from `transcript_path`. If the prefix is
     over a threshold, show one line, at most once a week per project: the
     total and its largest contributors (skill listing, deferred tools, MCP
     instructions, CLAUDE.md), with a pointer to `/context`.
   - Only if measurement supports it (#35): an opt-in `thinwindow:minimal`
     agent. Its body is empty, so Claude Code keeps its default system prompt,
     and its `disallowedTools` come from measured tool usage. The user enables
     it; thinwindow never sets it and never edits configuration. G3 said go:
     `profiles/thinwindow-minimal.md`, copied in by the user (see G3).
2. **During: keep the window thin.**
   - Keep the PreToolUse guards, `thinwindow-run` and the SessionStart rules
     described above.
   - Rules v2 (#36): the same rules in fewer words. `bench/compliance.mjs`
     checked each one against the recorded runs, and none was dropped. A rule
     that changes nothing on the bench may still help agents that get the
     rules without Claude Code's own instructions or the hooks, and dropping
     one saves almost nothing. Output discipline: no narration between tool
     calls, short endings, `file:line` instead of pasted code. Edit over a
     full-file Write is left to Claude Code's Write tool, which already asks
     for it. Output costs the most per token, and every later request
     re-reads it.
3. **Between sessions: resume without paying twice.**
   - Brief (#33): a Stop hook keeps a brief of the session up to date, built
     from the transcript without calling a model: the goal (the first prompt,
     truncated), recent requests, files edited (from `git status`, because
     agents often edit through Bash), commands with their exit codes, the last
     message. Store it under `${CLAUDE_PLUGIN_DATA}`. An
     optional, user-invoked `/thinwindow:brief` asks the model, while the
     cache is still warm, for a richer brief: decisions and why, what did not
     work, the exact next step.
   - Cold-resume notice (#34): on UserPromptSubmit, when the session was idle
     longer than the cache lifetime and its context is over a threshold, show
     the estimated re-write (tokens, and list-price US$ for the model in use)
     and the choice: continue, or `/clear` and `/thinwindow:resume`. The
     default threshold is 100k tokens of context. Don't recommend `/compact`:
     in #32 it cost more than both other options. Never act on the user's
     behalf.
   - Fresh start: `/thinwindow:resume` injects a brief of at most 150 tokens.
     Mark it as historical reference to check against `git status`, limit it
     to the same project, expire it after 48 hours, and note the commits made
     since it was written.
4. **After: show where the sessions' context cost went.**
   - `/thinwindow:report` (#31), a user-invoked skill, runs a local script
     over the user's own transcripts and prints aggregate numbers: context
     re-sent per request, cache re-writes after idle gaps, prefix size and its
     largest contributors, the main sources of tool output, and what
     thinwindow did. An optional `--json` summary is for the user to share by
     choice. Nothing is sent anywhere.

User-invoked skills set `disable-model-invocation: true`, so they add nothing
to the skill listing paid on every request.

### Principles (0.4.0)

The principles above still apply. 0.4.0 adds:

- Fail open on prompts too: a thinwindow error never blocks a tool call or a
  prompt.
- Local only: no telemetry, no network calls from hooks.
- Nothing always-on unless it pays for itself on every request.
- No automatic configuration changes. thinwindow recommends; the user decides.
- Subtractive maintenance: when Claude Code does something natively, remove
  thinwindow's version and say so in the CHANGELOG.
- Write each new feature's go/kill criterion before building or measuring it.

### Measurement (0.4.0)

0.3.0's published results keep the method they were published with. 0.4.0
keeps a validation against no plugin and moves the weight elsewhere (#28,
#37):

- Replay of recorded sessions, at no model cost: how much is at stake, and
  what a mechanism would have changed. Run it on the benchmark's transcripts
  and, voluntarily, on users' own sessions.
- Per-event arithmetic: derive claims such as the cost of a cold resume
  against a fresh start from token counts and current prices, not from noisy
  aggregates. Only the effect on task success needs runs, measured once.
- A few targeted runs, with go/kill criteria written first, only where a
  decision depends on how the model reacts.
- Price resumed runs from token usage, never from `total_cost_usd`: for a
  resumed session, Claude Code's figure includes what the session had already
  cost (#32).
- One validation per release (#38), in a single environment, against no
  plugin: the existing tasks plus resume chains. Its intervals include
  run-to-run variation and state the smallest effect they can detect.

Compare conditions only within one environment (Claude Code version, model,
account). Replay any cache-related change on real sessions too: a result that
only holds on the bench doesn't ship.

### Risks

- **Users don't want to start fresh.** The most expensive cold resumes are
  often in sessions kept alive on purpose. The resume experiment (#32) ran
  before any build, and the lifecycle features get a kill check after two
  weeks of use. The notice offers a choice and never acts on its own.
- **Platform absorption.** Claude Code may add its own resume handling, or
  change the cache lifetime or pricing. Apply subtractive maintenance, and
  recompute per-event claims from current prices.
- **Undocumented transcript format.** `transcript_path` is a documented hook
  input; the file's content is not a stable API. Parse it within bounds, test
  it with fixtures, fail open, and check versions in the report.
- **Crowded space.** Native memory (CLAUDE.md, auto-memory), usage tools and
  other session plugins overlap. Keep the angle narrow: cheap continuity with
  no always-on injection, and cost measured per event.
- **Model-dependent effects fade.** A model that already writes concisely
  shrinks the rules' effect. The lifecycle features depend on cache economics,
  not on model behaviour. Re-check the rules per model with the replay.
- **Maintenance load.** One maintainer. Keep few files and zero dependencies,
  and remove a feature when the platform covers it.

### Decision gates

Don't build a gated feature before its gate decides.

- G1: the maintainer's own `/thinwindow:report` data, recorded as one user.
  thinwindow is a solo project; summaries shared in #43 are added if they
  arrive. The lifecycle features go, shrink to the notice only, or stop.
  Decided 2026-10-04: go.
- G2: the resume experiment (#32). Build the brief and the notice, recommend
  `/compact`, or stop. Decided 2026-10-04: no pre-written outcome matched, and
  the maintainer chose go with conditions (#30):
  - a notice that never acts, shown only above the threshold;
  - a brief that lists edited files from `git status`;
  - a kill check after two weeks of use.
- G3: the setup-cost probe (#35). Ship the opt-in minimal-tools agent, or only
  the one-line notice. Run 2026-10-05: go
  ([results](../bench/results/experiments/setup.md)).
  `profiles/thinwindow-minimal.md` ships as a file users copy in, not in the
  plugin's `agents/`: a plugin agent is listed, with its tool list, in every
  session that has the Agent tool. #38 validates it or it is dropped.
- G4: the validation (#38). It decides which claims the release makes, if any.

## Hard constraints for whoever builds this

- Don't make the repo public, publish packages, or post anywhere. Ivan does that.
- Commits: Conventional Commits in English. No Co-Authored-By trailer or any
  Claude attribution.
- No invented numbers, testimonials or star counts anywhere.
- Practice what we preach: grep before reading, read ranges, cap command output.
