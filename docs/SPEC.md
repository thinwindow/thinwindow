# skinflint — product spec

Source of truth for building skinflint. Read it fully before writing code.

## One-liner

skinflint makes coding agents read less: fewer tokens per task, same results,
proven by a public benchmark.

## Why

- Most of the tokens an agent burns are input, not output: whole-file reads,
  re-reads, install/build/test logs, broad greps and directory listings.
  Everything read stays in context and is re-sent on every later turn, so early
  bloat compounds for the rest of the session.
- Output-side tricks ("make the agent talk less") cut the cheap part. skinflint
  targets the expensive part: what the agent reads.
- Origin story for the README: an agent burned a large share of a Pro plan's
  budget to change the copyright year in a website footer. The benchmark
  includes that exact task, so the README can quote a measured number instead
  of an anecdote.

## Principles

1. Every number in the docs comes from `bench/`. No invented figures.
2. Success rate must not drop. Savings that cost correctness do not count.
3. skinflint's own footprint is budgeted: the always-loaded rules
   (`rules/skinflint.md`) stay at or under 500 tokens (~2,000 characters).
   CI enforces it.
4. Zero runtime dependencies. Node >= 18, ESM. Works on macOS, Linux, Windows.
5. Fail open: any hook error allows the tool call. skinflint must never block
   someone's work because of its own bug.
6. Easy off switch: `SKINFLINT=off`, or `"enabled": false` in config.
7. Never phones home. No telemetry of any kind.

## Components (v0.1)

### 1. Rules — `rules/skinflint.md`

Single source of truth for the behaviour, injected into the agent's context.
Short imperative rules, final wording tuned with the benchmark. Starting set:

- Locate before reading: grep or glob for the symbol, then read only the range
  around the matches.
- Don't read a whole file over ~300 lines. Read ranges.
- Don't re-read what is already in context unless the file changed.
- Cap command output: quiet flags, `| tail -n 40`, `--max-count`, or run noisy
  commands through `skinflint-run`.
- Summaries before detail: `git diff --stat`, `git log -n 10 --oneline`.
- Stop exploring once there is enough evidence to act.
- Batch independent lookups into one call.
- In answers, cite `file:line` instead of pasting large blocks.

### 2. Agent Skill — `skills/skinflint/SKILL.md`

Agent Skills standard (`name` and `description` frontmatter). The body holds the
rules plus how to use `skinflint-run`. Works with any agent that supports
skills (Claude Code, Codex, Cursor, Copilot, Gemini CLI, OpenCode...). The layout
must also work with `npx skills add imprvhub/skinflint`.

### 3. Claude Code plugin (enforcement)

The repo is its own plugin marketplace: `.claude-plugin/plugin.json` and
`.claude-plugin/marketplace.json`. Install with
`/plugin marketplace add imprvhub/skinflint`, then
`/plugin install skinflint@skinflint`.

Before coding, read the current Claude Code docs for hooks (input/output JSON,
`permissionDecision`, `additionalContext`, `updatedInput`), plugins and
marketplaces. They change often. Cite the doc URL in a comment wherever a schema
matters.

Hooks (`hooks/hooks.json`, Node scripts in `hooks/`):

- **SessionStart** (startup, resume, clear, compact): inject
  `rules/skinflint.md` as additional context. On `compact`, reset the
  read-tracking state, because the content read before compaction is gone.
- **PreToolUse `Read`**
  - Large-file guard: the file has more than `maxReadLines` lines (default 400)
    and no offset/limit → deny with a reason that gives the line count and
    suggests grep plus a range.
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
    already capped → soft block that suggests `skinflint-run <cmd>`.
  - Optional `"rewrite": true` (off by default): wrap noisy commands with
    `skinflint-run` through `updatedInput` instead of denying.
- **`bin/skinflint-run`**: runs the command, saves the full stdout and stderr to
  a log in the OS temp dir (never inside the user's repo), prints the exit code,
  the duration, the last 40 lines, up to 40 deduplicated lines that match
  error/fail/warn/panic/exception, and the log path. Preserves the exit code.
- State: one JSON file per session in the OS temp dir, keyed by `session_id`.
- Config: `.skinflint.json` in the project root, or `~/.skinflint.json`, for
  thresholds, noisy-command patterns, an allowlist, `rewrite` and `enabled`.
- Debug: `SKINFLINT_DEBUG=1` writes decisions to stderr.

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
- Runner: `node bench/run.mjs --condition baseline|skinflint --reps N --model <m> [--tasks ids]`
  - A fresh temp clone at the pinned commit for every run.
  - `claude -p "<prompt>" --output-format json --model <m> --max-turns 40`,
    plus the plugin (`--plugin-dir`) for the skinflint condition. Permissions
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

- **M1 Build:** rules, skill, plugin and hooks with tests, `skinflint-run`,
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

## Hard constraints for whoever builds this

- Don't make the repo public, publish packages, or post anywhere. Ivan does that.
- Commits: Conventional Commits in English. No Co-Authored-By trailer or any
  Claude attribution.
- No invented numbers, testimonials or star counts anywhere.
- Practice what we preach: grep before reading, read ranges, cap command output.
