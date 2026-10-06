# thinwindow benchmark

Measures whether thinwindow makes Claude Code use fewer tokens on real tasks
without lowering the success rate. Every number thinwindow publishes comes
from the raw results in `bench/results/`.

## Four instruments (#28)

From 0.4.0, the benchmark is one of four instruments, cheapest first. Each
answers one question.

| Instrument | Question | Cost | When |
| --- | --- | --- | --- |
| Unit tests (`node --test`) | Does the mechanism do what it says? | $0 | Every commit |
| Replay of recorded sessions: the bench's kept transcripts, and volunteers' own sessions run locally with aggregate output (`/thinwindow:report`) | How much money is at stake, and what would a mechanism have changed? | $0 | Before building; every PR that touches a mechanism |
| A few targeted runs (`bench/experiments/`) | Does the model still finish the task after the mechanism acts? | ≤ US$3–4 per question | Only when the answer changes a decision, with go/kill criteria written first |
| One validation per release (`bench/run.mjs`, below) | What can the release claim? | Tens of runs | Once per release, in one environment, against no plugin |

**The cache TTL trap.** A result can hold on the bench and reverse on real
sessions. Bench runs have no idle gaps, so a 5-minute prompt-cache lifetime
looks cheaper there: about −20% cost. Replayed on the maintainer's own
sessions, where a reply often comes 5–60 minutes later and every such gap
re-writes the whole context, the same change costs about +14% (#37). Any
change that touches caching is replayed on real sessions too, not only run on
the bench.

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
   `duration_ms` and `is_error` from the JSON result. The model the run is
   grouped under (`modelResolved`) is the one `modelUsage` shows did most of
   the work, not what an alias like `sonnet` maps to. Effort isn't pinned:
   each run records it as Claude Code reports it, or `default` (Claude
   Code's default for the model) when it doesn't. `trace` lists the tool
   calls, one line each, and `traceTails` the last 200 characters of each
   call's result, so a repeated attempt can be read from the file.
4. Runs the task's `verify` command in the clone. Exit code 0 is a success.
5. Appends one JSON line to `bench/results/<version>/<date>-<model>.jsonl`
   (0.3.0's runs are in `bench/results/*.jsonl`) and deletes the clone.

Runs are interleaved task by task, so neither condition always runs first.
0.3.0 alternated which condition went first on each repetition; from 0.4.0
the order of each pair is random, from a seed recorded on every row.

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

## The 0.4.0 harness (#37)

0.4.0's validation (#38) runs with `bench/run.mjs` and the flags below. The
same flags apply to both conditions; only `--plugin-dir` differs.

```sh
CLAUDE_CONFIG_DIR=~/.claude-bench-flow node bench/run.mjs --condition baseline,thinwindow \
  --reps 3 --model claude-sonnet-5-5 --account <label> --keep-transcripts --max-cost 6
CLAUDE_CONFIG_DIR=~/.claude-bench-flow node bench/run.mjs --chains 1,2,3 --condition baseline,thinwindow \
  --reps 3 --model claude-sonnet-5-5 --account <label> --keep-transcripts --max-cost 6
node bench/report.mjs bench/results/0.4.0/*.jsonl --out bench/results/0.4.0
```

- **Where rows live.** `bench/results/<version>/`, so `bench/results/0.4.0/`
  for 0.4.0 and its prereleases. `bench/report.mjs` and `bench/docs.mjs` read
  only `bench/results/*.jsonl` unless given files, so 0.3.0's published
  blocks can't change.
- **One environment.** `--tools` and `--disallowed-tools` pass a fixed tool
  list to both conditions; `--agent` runs both under one agent. User agents
  in `$CLAUDE_CONFIG_DIR/agents/` don't work: the bench's `--setting-sources
  project,local` doesn't load them, so the run refuses one (#38). To run a
  profile such as `profiles/thinwindow-minimal.md`, pass its
  `disallowedTools` list with `--disallowed-tools`.
  `--disable-slash-commands` isn't used: with `Skill` disallowed it removes
  nothing more (#35), and chains need a typed `/thinwindow:resume`, which
  still runs without the Skill tool.
- **Fingerprint on every row:** Claude Code version, model, effort, profile
  name, account (the `--account` label, hashed), OS, the tool list flags,
  tool, skill and agent counts from the stream's init event (names hashed),
  ThinWindow's own skills counted apart, the first request's tokens and
  whether it started on a cold prompt cache (no cache reads). Effort is what
  the init event reports, or `default`: Claude Code 2.1.289's init event and
  transcripts don't carry it, and the default is fixed by version and model,
  which the fingerprint already holds.
- **Refusal.** For rows of 0.4.0 and later, `bench/report.mjs` refuses to
  aggregate rows whose fingerprints differ, and rows from before and after
  0.4.0. ThinWindow's own skills, the first request's size and the cache
  state differ by condition or by run, so they are reported, not matched.
- **Order.** `--seed <n>` fixes the random order of each pair; without it, a
  seed is drawn and recorded.
- **Kept transcripts.** `--keep-transcripts` keeps each run's session and
  writes it, scrubbed, to `transcripts/<session id>.jsonl` next to the
  results, for tasks on a public GitHub repo only. The scrub
  (`bench/lib/transcripts.mjs`) is an allowlist: user, assistant and
  attachment records, with listed fields only; attachments other than hook
  output, the turn-cap notice and the token and budget reminders keep only
  their type and size (that drops the copy of the system prompt, the skill,
  tool and agent listings, the environment and the account's organization);
  then the clone, temp dir, config dir, `$HOME` and the user name are
  replaced. Every row also keeps the agent's final message (`finalMessage`),
  for the manual review of answers.
- **Intervals.** For rows of 0.4.0 and later, the report uses a seeded
  hierarchical bootstrap (`bench/lib/stats.mjs`): resample tasks, then runs
  within each task and condition. Next to every interval it prints the
  smallest effect the suite can detect: 2.8 × the bootstrap standard error,
  a 5% two-sided test with 80% power. The primary metric is the cost per
  completed task: everything a condition's runs cost, failures included,
  over the runs that passed. 0.3.0's tables keep the method they were
  published with.
- **Chains.** `--chains` runs #32's chains (task A, then task B in the same
  clone) with both conditions. The baseline continues A's session
  (`--resume <A> --fork-session`). ThinWindow plays the user who accepts the
  fresh start: no notice fires in `-p`, so the bench starts a new session
  with `/thinwindow:resume <task B>`. Each job writes an A row and a B row
  (`bench/experiments/resume.mjs` runs them); the report joins them into one
  chain run, complete when A passes, B passes and A still passes after B. Its
  cost is priced from token usage, never `total_cost_usd` (a resumed
  session's figure includes what it had already cost), with B's first
  request re-written at the 1-hour cache-write price, as after an expired
  cache. In `-p`, the Stop hook doesn't fire on `error_max_turns`, so A's
  brief can be a turn behind or missing: the B row records `briefFound`.
- A report that reads more than one file counts a run found twice once (by
  session id).

## Publishing numbers

After a benchmark run, `npm run bench:report` regenerates everything derived
from `bench/results/*.jsonl`:

- `report.md` and one SVG chart per model (`bench/report.mjs`);
- `report.json` and the `RESULTS`, `CACHE` and `BENCH` blocks of the three
  READMEs (`bench/docs.mjs`).

No benchmark number is written by hand, and `npm run check` fails if any of
them drifts from the raw runs. `report.json` is a stable, public summary:
[ivanluna.dev](https://ivanluna.dev) reads it straight from this repository,
so change its shape deliberately and bump its `schema` field when you do.

- Report medians and the spread, and keep failed runs in.
- State the model, the Claude Code version and the dates (the report
  header does).
- Say that the rules and thresholds were tuned on these tasks (the report
  footnote does).
- Launch target: at least 25% fewer total tokens at an equal success rate.
  If it isn't met, improve thinwindow. Don't lower the bar or drop tasks.
- `total_cost_usd` is Claude Code's client-side estimate, not a bill.

## Rule compliance

`node bench/compliance.mjs` prints how often the recorded runs followed each
rule, by model, release and condition: reads that asked for a line range,
installs, builds and tests run capped, tool calls per turn, output tokens
and more. It needs no new runs. It reads `bench/results/*.jsonl` and
`archive/` (not `experiments/`), counts a run found in two files once, and
groups runs by the commit each one records, not by file name. The thinwindow
condition is the rules and the hooks together, so the table can't tell them
apart.

## Adding a task

1. Pick a public, permissively licensed repo and pin a full commit SHA.
2. Write `bench/tasks/<id>.json` with `repo`, `commit`, `prompt`, `verify`
   and `timeout` (seconds). `verify` runs in the clone with bash;
   `$THINWINDOW_BENCH_FIXTURES` points at `bench/fixtures/`. Name hidden
   JavaScript tests `*.hidden.js` so `node --test` in this repo doesn't pick
   them up, and pin test tools to the versions the repo locks.
3. Add a reference solution as `bench/solutions/<id>.patch`.
4. Run `node bench/validate-tasks.mjs --tasks <id>` and `node --test`.
