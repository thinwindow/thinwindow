# thinwindow benchmark

Measures whether thinwindow makes Claude Code use fewer tokens on real tasks
without lowering the success rate. Every number thinwindow publishes comes
from the raw results in `bench/results/`.

## What a run does

For each task, condition and repetition, `bench/run.mjs`:

1. Makes a fresh clone of the task repo at its pinned commit, in the OS temp
   dir. It fetches only that commit and removes the remote, so the agent
   can't read the repo's later history.
2. Runs Claude Code headless in the clone:
   ```
   claude -p "<prompt>" --output-format json --model <m> --max-turns 40 \
     --permission-mode acceptEdits --settings '<bench settings>' \
     --setting-sources project,local --strict-mcp-config --no-session-persistence \
     [--plugin-dir <this repo>]          # thinwindow condition only
   ```
   Both conditions use the same settings. Edits are auto-approved only
   inside the clone. Bash runs in Claude Code's
   [sandbox](https://code.claude.com/docs/en/sandboxing), which can write
   only to the clone and the session temp dir, can reach only GitHub, npm
   and PyPI, and has no escape hatch; the run fails rather than go
   unsandboxed. Web search and fetch are off, and the agent can't read
   `bench/` (hidden tests and reference solutions). User settings are
   skipped so other plugins or hooks can't leak into either condition, and
   the baseline also runs with `THINWINDOW=off`.
3. Records input, cache-creation, cache-read and output tokens (from
   `modelUsage`, so subagents count), `total_cost_usd`, `num_turns`,
   `duration_ms` and `is_error` from the JSON result.
4. Runs the task's `verify` command in the clone. Exit code 0 is a success.
5. Appends one JSON line to `bench/results/<date>-<model>.jsonl` and deletes
   the clone.

Runs are interleaved (task by task, alternating which condition goes first
on each repetition) so neither condition always runs first.

## Tasks

Two permissively licensed repos: [tj/commander.js](https://github.com/tj/commander.js)
(MIT, Node) and [pallets/click](https://github.com/pallets/click)
(BSD-3-Clause, Python). The hidden tests adapted from upstream keep their
attribution in `bench/fixtures/`.

| Task | Kind | Repo @ commit | `verify` checks |
| --- | --- | --- | --- |
| `commander-negate-default-order` | bug fix | commander.js @ `2e96cd3` (parent of upstream fix `63eed4a`) | upstream regression tests + the full jest suite |
| `commander-command-clash` | small feature + tests | commander.js @ `b96af40` (parent of `1d3dd47`) | upstream tests + the full jest suite |
| `commander-rename-display-width` | cross-file rename | commander.js v15.0.0 @ `ba6d13d` | no `displayWidth` left, `visibleTextWidth` works, `npm test` (tests + typings) |
| `commander-extract-utils` | refactor | commander.js v15.0.0 @ `ba6d13d` | helpers moved to `lib/utils.js` with the same behavior, `node --test`, `npm run check:type:js` |
| `commander-ci-config` | config lookup, answer file | commander.js v15.0.0 @ `ba6d13d` | `answer.json` matches the CI matrix, engines and typings script |
| `click-choice-brackets` | bug fix | click @ `8929d39` (parent of `762c97e`) | upstream regression tests + two guards + the full pytest suite |
| `click-help-spec` | small feature + tests | click @ `be13b15` (parent of `271effb`) | upstream tests + the full pytest suite |
| `click-footer-year` | the origin story: "make the footer copyright year update automatically" | click @ `06b2a67` | the docs site footer (`copyright` in `docs/conf.py`) follows a clock frozen in 2031 and 2047 |

The footer task uses the Sphinx docs site of click: its footer shows the
`copyright` value from `docs/conf.py`, hard-coded at the pinned commit. The
spec's optional Astro or Vue site isn't included. The candidates checked
either computed the year already, lacked a license at the right commit, or no
longer build.

`node bench/validate-tasks.mjs` proves each task is fair without running an
agent: in a fresh clone `verify` must fail, and after applying the reference
solution in `bench/solutions/<id>.patch` it must pass. Run it after changing
a task. It needs the network and takes a few minutes, so CI doesn't run it.

## Requirements

- Claude Code 2.1.219 or newer, logged in (`claude --version`). With
  `--bare`, `ANTHROPIC_API_KEY` instead.
- The sandbox: built in on macOS; `bubblewrap` and `socat` on Linux and WSL2
  ([setup](https://code.claude.com/docs/en/sandboxing#set-up-linux-and-wsl2)).
- git, bash, Node.js 22.12 or newer (commander v15 requires it), npm, and
  Python 3.10+ with `venv`.
- Network access to GitHub, the npm registry and PyPI.

Windows isn't supported for runs (the verify commands are POSIX shell); use
WSL2.

## Running it

Start with a dry run. It clones nothing and prints the plan and a cost
estimate:

```sh
node bench/run.mjs --condition baseline,thinwindow --reps 2 --model sonnet --dry-run --max-cost 20
```

Until there are results for a model, the estimate uses a stated prior (a
guessed token profile times list prices). After that it uses the median
cost of earlier runs of the same task and condition.

The launch budget is 8 tasks × 2 conditions × 2 reps = 32 runs:

```sh
node bench/run.mjs --condition baseline,thinwindow --reps 2 --model sonnet --max-cost 20
node bench/report.mjs
```

`--condition baseline` and `--condition thinwindow` also work on their own.
Useful options: `--tasks a,b` (subset), `--keep` (keep the clones to inspect
them), `--claude <path>`, `--bare`, `--out <file>`. `--max-cost` stops
before the next run once the cumulative `total_cost_usd` of this invocation
reaches the limit; finished runs are already on disk.

`bench/report.mjs` reads every `bench/results/*.jsonl` (or the files you
pass, or `--model <m>`), prints a markdown table per model and writes
`bench/results/report.md` and `bench/results/chart-<model>.svg`. Per task it
reports median total tokens with the min–max spread, median cost and turns,
the success rate per condition and the Δ%. The total row sums the per-task
medians. Commit the raw JSONL together with the report.

## Publishing numbers

- Report medians and the spread, and keep failed runs in.
- State the model, the Claude Code version and the dates (the report
  header does).
- Say that the rules and thresholds were tuned on these tasks (the report
  footnote does).
- Launch target: at least 25% fewer total tokens at an equal success rate.
  If it isn't met, improve thinwindow. Don't lower the bar or drop tasks.
- `total_cost_usd` is Claude Code's client-side estimate, not a bill.

## Adding a task

1. Pick a public, permissively licensed repo and pin a full commit SHA.
2. Write `bench/tasks/<id>.json` with `repo`, `commit`, `prompt`, `verify`
   and `timeout` (seconds). `verify` runs in the clone with bash;
   `$THINWINDOW_BENCH_FIXTURES` points at `bench/fixtures/`. Name hidden
   JavaScript tests `*.hidden.js` so `node --test` in this repo doesn't pick
   them up, and pin test tools to the versions the repo locks.
3. Add a reference solution as `bench/solutions/<id>.patch`.
4. Run `node bench/validate-tasks.mjs --tasks <id>` and `node --test`.
