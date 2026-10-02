<div align="center">

![ThinWindow logo](assets/icon.iconset/icon_128x128.png)

</div>

<h1 align="center">ThinWindow</h1>

<p align="center">
  <strong>Less in the window. Less on the bill.</strong><br>
  ThinWindow makes Claude Code use less context — without changing the outcome. A Claude Code plugin and Agent Skill, benchmarked on Opus 5.5, Sonnet 5.5, and Haiku 4.5: 7–11% lower cost, 3–6% fewer tokens, with the same success rate.<br>
  Listed in the official Claude Code plugin directory.
</p>

<p align="center">
  <a href="docs/WHERE-THE-TOKENS-GO.md"><b>Where the tokens go</b></a> · <a href="#benchmark">Benchmark and raw data</a> · <a href="#install">Install</a> · <a href="https://www.youtube.com/watch?v=ks1_B5Uq5Gc">Install video</a>
</p>

<p align="center">
  <b>English</b> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a>
</p>

<!-- RESULTS:START -->
| Model | Tokens (95% CI) | Tokens, passing runs | Cost (95% CI) | Success baseline → ThinWindow | Stopped by the turn cap | Runs |
| --- | ---: | ---: | ---: | :---: | :---: | ---: |
| Opus 5.5 | −2.9% (−13.3% to +9.3%) | −2.9% | −10.5% (−16.5% to −3.0%) | 24/24 → 24/24 | 0/24 → 0/24 | 48 |
| Sonnet 5.5 | −2.6% (−23.1% to +17.5%) | −2.6% | −6.5% (−20.0% to +7.6%) | 24/24 → 24/24 | 0/24 → 0/24 | 48 |
| Haiku 4.5 | −3.3% (−19.1% to +12.2%) | −5.8% | −7.7% (−21.8% to +3.5%) | 12/16 → 12/16 | 5/16 → 5/16 | 32 |

Same 8 tasks, 128 runs, one agent per run, no cherry-picking:
every run recorded is in the table, except runs superseded by a later version
of the code on the same task, which are kept in
[`bench/results/archive/`](bench/results/archive). Per-task figures, the
spread and the raw data are in [Benchmark](#benchmark) below.
Every run was measured in Claude Code, not in Cowork or the Claude apps; versions after 0.3.0 will add those measurements. Haiku 4.5 has two runs per task and condition; Opus 5.5 and Sonnet 5.5, three. The runs came from two accounts whose Claude Code sessions start with different built-in tools; both conditions of each task share the same mix.

The 3–6% at the top counts only runs that passed their hidden check. On Haiku 4.5 that is −5.8% over the 6 tasks where both conditions have a passing run, against −3.3% over all 8. Opus 5.5 and Sonnet 5.5 passed every run. 95% CI: bootstrap over the tasks. Where it includes zero, the change can't be told apart from none on this task set. A run stopped by the turn cap ended at the limit before the agent finished; its tokens aren't comparable with a finished run's.
<!-- RESULTS:END -->

## Why context is the bill

A coding agent does not pay mostly for what it writes. It pays for what it
carries. Every file it opens, every install log it prints and every wide grep it
runs is appended to the conversation, and the whole conversation is re-sent on
every subsequent turn. The cost of a session is therefore closer to

```
tokens ≈ context size × turns
```

than to the length of the answer. In the baseline runs measured here, **90% to 95%
of all tokens billed were cache reads** — context being re-sent, turn after turn —
against 0.8% to 1.4% for the agent's own output:

<!-- CACHE:START -->
| Model | Share of | Cache reads | Cache writes | Output |
| --- | --- | ---: | ---: | ---: |
| Opus 5.5 | tokens | 91.7% | 6.9% | 1.4% |
|  | cost | 18.1% | 54.6% | 27.2% |
| Sonnet 5.5 | tokens | 89.7% | 8.9% | 1.4% |
|  | cost | 26.7% | 52.9% | 20.4% |
| Haiku 4.5 | tokens | 95.5% | 3.7% | 0.8% |
|  | cost | 45.7% | 35.5% | 18.7% |
<!-- CACHE:END -->

Priced, the same runs look different (the cost rows): a cache read costs a
tenth of an input token or less, a cache write twice one, and output five times
one. Telling an agent to be brief touches the output column, which is small in
tokens but not in cost. Stopping it from pulling a 2,000-line file into context
on turn 3 touches both cache columns, on every turn that follows.

ThinWindow attacks both factors: it shrinks what enters the context, and it
avoids the extra turns spent recovering from output the agent never needed.
How the bill splits by kind of token, what the agent calls, and what happens
to runs that don't finish: [Where the tokens go](docs/WHERE-THE-TOKENS-GO.md).

## Install

**From the plugin directory** (Claude Code, Cowork and the Claude apps): in
the Claude desktop app, Customize → Plugins → Discover → ThinWindow; in Claude
Code, `/plugin` → Discover → ThinWindow, or:

```
claude plugin install thinwindow@anthropic-plugin-directory
```

[Watch it installed from the Claude desktop app](https://www.youtube.com/watch?v=ks1_B5Uq5Gc). In the Claude apps
plugins don't run hooks, so ThinWindow works there as an Agent Skill only; the
benchmark was measured in Claude Code.

**Claude Code** (rules + hooks, the full version):

```
/plugin marketplace add thinwindow/thinwindow
/plugin install thinwindow@thinwindow
```

**Any agent with Agent Skills** (Codex, Cursor, Copilot, Gemini CLI,
OpenCode...), rules only:

```
npx skills add thinwindow/thinwindow
```

**Agents that read `AGENTS.md`**: paste [`adapters/AGENTS.md`](adapters/AGENTS.md)
into your project's `AGENTS.md`.

Turn it off at any time with `THINWINDOW=off`, or `"enabled": false` in
`.thinwindow.json`.

## How it works

1. **Rules** ([`rules/thinwindow.md`](rules/thinwindow.md), under 500 tokens)
   loaded at session start: locate before reading, read ranges, cap command
   output, write the smallest change, end with three lines at most.
2. **Hooks** (Claude Code only) that enforce the expensive part, without
   costing the agent a turn:
   - A whole-file `Read` of a file over 400 lines returns the first 120 lines
     plus a line-numbered outline, so the next read can target a range.
   - Re-reading an unchanged file that is already in context is refused.
   - Installs, builds, tests and lints run through `thinwindow-run`: the full
     log goes to a temp file, the agent sees the exit code, the tail and the
     error lines. When nothing would be cut (10 lines or fewer on success, 40
     on failure), the output comes back as it is, with the exit code if the
     command failed.
   - `cat` of huge files, lockfiles or minified files, `git log` without `-n`,
     `ls -R`, `tree` without `-L` and unbounded `find` get a cheaper
     replacement. Content `Grep` gets `head_limit: 100`.
3. **Fails open.** Any hook error lets the tool call through. Repeating a
   refused read or noisy command lets it through too, and the few commands
   that are always refused come with a replacement that works, so the agent
   can never get stuck.

The rules are enforced by hooks rather than trusted to the model, because a rule
the agent can forget under pressure is not a rule. The hooks run on the tool
call, before the result reaches the context, so enforcing them costs no turn.

No dependencies, no telemetry, Node 18+. Details and every option:
[docs/configuration.md](docs/configuration.md).

### What it reads, writes and sends

- **Reads:** the tool call Claude Code passes to the hooks (a file path, a
  command or a search pattern); the line count and an outline of files the
  agent is about to read or print; its settings from `.thinwindow.json` in the
  project and in your home directory; and the environment variables
  `THINWINDOW`, `THINWINDOW_DEBUG` and `CLAUDE_PROJECT_DIR`. It reads no
  credentials.
- **Writes:** only to your operating system's temp directory: one small JSON
  file per session (which files and ranges were read, recent refusals, and
  counts of what the hooks did) and the full log of each command run through
  `thinwindow-run`. Both are deleted after 7 days.
- **Sends:** nothing. There is no network code.

## Benchmark

<!-- BENCH:START -->
Three models, 8 tasks, 128 runs. Charts and tables are generated by
[`bench/report.mjs`](bench/report.mjs) from the raw run files.

### Opus 5.5

`claude-opus-5-5` · Claude Code 2.1.287 · ThinWindow 0.3.0 (6546385) · 48 runs, up to 3 per task and condition · 2026-10-02

![Change in total tokens per task, Opus 5.5: bars left of zero mean fewer tokens with ThinWindow; whiskers span every pair of runs](bench/results/chart-claude-opus-5-5.svg)

<details><summary>Per-task table</summary>

| Task | Tokens baseline (min–max) | Tokens ThinWindow (min–max) | Δ tokens | Cost baseline | Cost ThinWindow | Δ cost | Turns baseline | Turns ThinWindow | Success baseline | Success ThinWindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | 304k (282k–307k) | 370k (343k–395k) | +21.7% | $0.27 | $0.28 | +3.7% | 11 | 14 | 3/3 | 3/3 |
| click-footer-year | 123k (91k–186k) | 123k (73k–185k) | +0.1% | $0.13 | $0.13 | −3.7% | 5 | 4 | 3/3 | 3/3 |
| click-help-spec | 412k (356k–451k) | 384k (275k–456k) | −7.0% | $0.33 | $0.29 | −11.7% | 15 | 14 | 3/3 | 3/3 |
| commander-ci-config | 93k (56k–124k) | 94k (56k–126k) | +0.6% | $0.12 | $0.12 | −2.2% | 3 | 3 | 3/3 | 3/3 |
| commander-command-clash | 330k (289k–382k) | 239k (239k–291k) | −27.4% | $0.36 | $0.30 | −16.2% | 13 | 9 | 3/3 | 3/3 |
| commander-extract-utils | 241k (234k–299k) | 267k (262k–307k) | +10.9% | $0.25 | $0.23 | −6.0% | 10 | 13 | 3/3 | 3/3 |
| commander-negate-default-order | 457k (380k–490k) | 423k (269k–501k) | −7.5% | $0.45 | $0.35 | −22.3% | 14 | 15 | 3/3 | 3/3 |
| commander-rename-display-width | 124k (74k–124k) | 125k (76k–125k) | +0.5% | $0.14 | $0.13 | −5.5% | 4 | 4 | 3/3 | 3/3 |
| **Total** | **2.08M** | **2.02M** | **−2.9%** | **$2.05** | **$1.84** | **−10.5%** | 75 | 76 | **24/24** | **24/24** |

</details>

Raw runs: [`bench/results/opus-5-5-6546385.jsonl`](bench/results/opus-5-5-6546385.jsonl)

### Sonnet 5.5

`claude-sonnet-5-5` · Claude Code 2.1.287 · ThinWindow 0.3.0 (6546385) · 48 runs, up to 3 per task and condition · 2026-10-02

![Change in total tokens per task, Sonnet 5.5: bars left of zero mean fewer tokens with ThinWindow; whiskers span every pair of runs](bench/results/chart-claude-sonnet-5-5.svg)

<details><summary>Per-task table</summary>

| Task | Tokens baseline (min–max) | Tokens ThinWindow (min–max) | Δ tokens | Cost baseline | Cost ThinWindow | Δ cost | Turns baseline | Turns ThinWindow | Success baseline | Success ThinWindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | 189k (102k–268k) | 127k (97k–226k) | −33.1% | $0.14 | $0.09 | −37.3% | 6 | 6 | 3/3 | 3/3 |
| click-footer-year | 120k (90k–149k) | 153k (74k–215k) | +28.0% | $0.07 | $0.08 | +16.7% | 5 | 6 | 3/3 | 3/3 |
| click-help-spec | 241k (150k–283k) | 129k (83k–268k) | −46.4% | $0.14 | $0.10 | −28.0% | 12 | 5 | 3/3 | 3/3 |
| commander-ci-config | 124k (75k–156k) | 126k (77k–127k) | +2.1% | $0.08 | $0.08 | +2.2% | 4 | 4 | 3/3 | 3/3 |
| commander-command-clash | 208k (125k–239k) | 242k (174k–271k) | +16.7% | $0.16 | $0.16 | −2.4% | 9 | 11 | 3/3 | 3/3 |
| commander-extract-utils | 156k (96k–156k) | 193k (163k–298k) | +24.1% | $0.09 | $0.11 | +17.5% | 6 | 8 | 3/3 | 3/3 |
| commander-negate-default-order | 204k (199k–299k) | 235k (171k–273k) | +15.1% | $0.14 | $0.15 | +4.6% | 11 | 10 | 3/3 | 3/3 |
| commander-rename-display-width | 91k (55k–92k) | 93k (55k–125k) | +1.8% | $0.07 | $0.07 | +2.0% | 3 | 3 | 3/3 | 3/3 |
| **Total** | **1.33M** | **1.30M** | **−2.6%** | **$0.88** | **$0.83** | **−6.5%** | 56 | 53 | **24/24** | **24/24** |

</details>

Raw runs: [`bench/results/sonnet-5-5-6546385.jsonl`](bench/results/sonnet-5-5-6546385.jsonl)

### Haiku 4.5

`claude-haiku-4-5` (requested as `haiku`) · Claude Code 2.1.287 · ThinWindow 0.3.0 (6546385) · 32 runs, up to 2 per task and condition · 2026-10-02

![Change in total tokens per task, Haiku 4.5: bars left of zero mean fewer tokens with ThinWindow; whiskers span every pair of runs](bench/results/chart-claude-haiku-4-5.svg)

<details><summary>Per-task table</summary>

| Task | Tokens baseline (min–max) | Tokens ThinWindow (min–max) | Δ tokens | Cost baseline | Cost ThinWindow | Δ cost | Turns baseline | Turns ThinWindow | Success baseline | Success ThinWindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | 1.49M (1.39M–1.58M) | 1.35M (1.35M–1.35M) | −9.3% | $0.27 | $0.25 | −9.1% | 41 | 40.5 | 2/2 | 2/2 |
| click-footer-year | 155k (141k–169k) | 210k (119k–300k) | +35.0% | $0.05 | $0.06 | +23.8% | 6.5 | 8.5 | 2/2 | 2/2 |
| click-help-spec | 1.32M (1.21M–1.44M) | 1.44M (1.40M–1.48M) | +9.0% | $0.26 | $0.27 | +3.3% | 34 | 39.5 | 2/2 | 2/2 |
| commander-ci-config | 96k (96k–96k) | 97k (97k–98k) | +1.3% | $0.04 | $0.04 | +1.6% | 5 | 5 | 2/2 | 2/2 |
| commander-command-clash | 1.69M (1.62M–1.75M) | 1.40M (1.28M–1.52M) | −17.0% | $0.33 | $0.28 | −14.8% | 41 | 38.5 | 0/2 | 0/2 |
| commander-extract-utils | 827k (677k–976k) | 416k (413k–419k) | −49.7% | $0.21 | $0.11 | −49.0% | 14.5 | 14.5 | 2/2 | 2/2 |
| commander-negate-default-order | 1.50M (1.34M–1.67M) | 1.56M (1.50M–1.62M) | +4.0% | $0.31 | $0.32 | +4.4% | 36.5 | 38 | 2/2 | 2/2 |
| commander-rename-display-width | 1.13M (941k–1.33M) | 1.46M (1.35M–1.58M) | +29.1% | $0.25 | $0.26 | +4.2% | 34 | 41 | 0/2 | 0/2 |
| **Total** | **8.21M** | **7.94M** | **−3.3%** | **$1.71** | **$1.58** | **−7.7%** | 212.5 | 225.5 | **12/16** | **12/16** |

</details>

Raw runs: [`bench/results/haiku-6546385.jsonl`](bench/results/haiku-6546385.jsonl)

Tokens are input + cache-creation + cache-read + output, summed over every model the run used. Per task: medians over all runs, failures included; min–max in parentheses. Total: sum of the per-task medians over the 8 tasks that have both conditions; success counts every run. Δ = (ThinWindow − baseline) / baseline. Cost is Claude Code's own estimate (`total_cost_usd`), not a bill. Turns is Claude Code's `num_turns`: the top-level agent loop only. A run that delegates to a subagent (the Agent tool) can show few top-level turns while doing much more work inside it; Tokens and Cost already include that subagent work (via `modelUsage`), so they stay the fair comparison — Turns does not. 95% CI: percentile bootstrap over the tasks (100,000 resamples) of the sum of the per-task medians. The chart's whiskers span every pairing of a ThinWindow run with a baseline run of the same task; where one crosses zero, the two conditions' ranges overlap. The ThinWindow rules and thresholds were tuned on these same tasks.
<!-- BENCH:END -->

### How it is measured

Each **run** is one agent solving one task from scratch:

1. Clone a real open-source repository ([click](https://github.com/pallets/click)
   or [commander.js](https://github.com/tj/commander.js)) at a pinned commit,
   into a fresh temporary directory.
2. Install its dependencies before the agent starts, so install logs are not
   billed to either side.
3. Run `claude -p "<task>"` with the chosen model, capped at 40 turns. The
   *baseline* gets plain Claude Code; *ThinWindow* gets the same plus this
   plugin. Nothing else differs: no MCP servers, no user settings, no memory
   carried between runs.
4. Run the task's hidden check — a test or script the agent never sees. Exit
   code 0 is a success.
5. Record tokens (input, cache writes, cache reads, output, subagents included),
   cost, turns and wall time from Claude Code's own JSON result, plus the full
   tool-call trace.

The 8 tasks are an everyday mix: bug fixes with a failing test, a small feature,
a cross-file rename, a refactor, a config lookup, and "make the footer copyright
year update automatically". Task definitions are in
[`bench/tasks/`](bench/tasks).

Runs are sequential, one at a time, so they never compete for rate limits. Cost
is the API-equivalent price Claude Code reports; on a subscription you pay in
usage limits instead, but the ratio is the same.

### Verify it rather than trust it

- Every run is one line of JSONL in [`bench/results/`](bench/results), carrying
  the model, the Claude Code version, the ThinWindow commit, the raw token
  counts and the tool-call trace. The tables above are generated from those
  files by [`bench/report.mjs`](bench/report.mjs); no number in this README is
  typed by hand.
- The rules were tuned on these same 8 tasks, on two CLI-argument-parsing
  libraries, in JavaScript and Python. That is a narrow slice of software. Your
  savings on other work will differ.
- Samples are small. Agents are noisy: the same task took 7 turns in one run and
  13 in the next (click-help-spec on Sonnet 5.5, without ThinWindow), which
  is why the tables report medians and per-task spread rather than a single
  headline average.
- Re-run it against your own account and your own limits:

  ```
  node bench/run.mjs --condition baseline,thinwindow --reps 3 --model sonnet --dry-run
  node bench/run.mjs --condition baseline,thinwindow --reps 3 --model sonnet --max-cost 10
  node bench/report.mjs
  ```

  Every option is documented in [bench/README.md](bench/README.md).

### Where the remaining headroom is

These numbers are a current measurement, not a ceiling. They will move as the
rules, the models and Claude Code itself change, and the intent is to keep
improving them and to re-publish the raw files each time.

Two things are visible in the data above:

- **Not every task improves.** On Sonnet 5.5, six of the eight tasks use more
  tokens with ThinWindow than without; on Opus 5.5 and Haiku 4.5, five.
  Neutralising just those regressions — without saving a single extra token
  anywhere else — would take Sonnet 5.5 from −2.6% to about −13.1%, Opus 5.5
  from −2.9% to about −7.4% and Haiku 4.5 from −3.3% to about −10.2%. Most of the
  near-term headroom is in not making short tasks worse, not in squeezing the
  long ones further. What the traces show for each of them is in
  [#7](https://github.com/thinwindow/thinwindow/issues/7).
- **Turns are the untapped factor.** Since cost is roughly context × turns, a
  turn saved is worth as much as a large read avoided. Sonnet 5.5 took 5.4%
  fewer turns here and cut cost by 6.5%; Haiku 4.5 took 6.1% more turns and
  cut cost by 7.7%; Opus 5.5 took 1.3% more turns and cut cost by 10.5%. An earlier attempt at explicit "use fewer
  turns" rules made Sonnet 5 measurably worse and was reverted rather than kept
  and quietly excluded — that reverted experiment is still in the history.

## What ThinWindow does to tool output

These figures measure the size of tool output, not cost. They come from a
replay without a model: every Read and Bash call in the baseline runs is run
again, in a fresh clone of its task's repository, once as the agent sent it and
once as ThinWindow's hooks rewrite or refuse it, and the characters the agent
would get back are compared. Calls that look at the agent's own edits (`git
diff`, the tests) see the unmodified repository in the replay, so their sizes
are not the ones the agent saw. The replay is deterministic apart from timings
and temporary paths in the output, which move the totals by a few characters
between replays. It needs no API key; it needs network for the clones and the
dependency installs, and takes 15 to 25 minutes on a laptop, mostly re-running
test suites: `node bench/input-size.mjs`, which writes
[`bench/results/input-size.json`](bench/results/input-size.json).

A reduction in tool output is not a reduction in the bill. Tool output is one
part of what enters the context; the context is one part of the tokens; and
tokens are one part of the cost, each kind at its own price. The effect dilutes
at every step. [Where the tokens go](docs/WHERE-THE-TOKENS-GO.md) shows how the
bill splits.

<!-- TIER1:START -->
| Model | Calls in the baseline traces | Replayed | Changed by the hooks | Tool output of the replayed calls (characters) | Change |
| --- | ---: | ---: | ---: | ---: | ---: |
| Opus 5.5 | 106 | 52 | 2 | 83,849 → 83,856 | +0.0% |
| Sonnet 5.5 | 0 | 0 | 0 | 0 → 0 | – |
| Haiku 4.5 | 366 | 250 | 37 | 861,927 → 515,933 | −40.1% |

| What the hook did | Calls | Before | After | Calls that grew |
| --- | ---: | ---: | ---: | ---: |
| Large Read: first lines and an outline | 10 | 374,240 | 55,614 | 0 |
| Command run through thinwindow-run | 27 | 45,258 | 20,374 | 11 |
| Recursive search capped | 1 | 4,481 | 2,011 | 0 |

Not replayed: 183 calls the trace cut short (it keeps 140 characters of each), 33 that write files, run a script or change the repository, and 22 whose file could not be matched.

The change in the bill is a different quantity, measured in [Benchmark](#benchmark), and not the same size:
- Opus 5.5: the hooks change 2 of 106 calls and add 0.0% to the replayed tool output; in the benchmark they acted in 1 of 24 ThinWindow runs, and the measured change in cost is −10.5% (95% CI −16.5% to −3.0%).
- Sonnet 5.5: the hooks change 0 of 0 calls and add 0.0% to the replayed tool output; in the benchmark they acted in 3 of 24 ThinWindow runs, and the measured change in cost is −6.5% (95% CI −20.0% to +7.6%).
- Haiku 4.5: the hooks change 37 of 366 calls and cut the replayed tool output by 40.1%; in the benchmark they acted in 10 of 16 ThinWindow runs, and the measured change in cost is −7.7% (95% CI −21.8% to +3.5%).

Where the hooks barely act, the measured change comes from the rules, which change what the agent does, or from run-to-run noise, not from trimming tool output.
<!-- TIER1:END -->

## Contributing

This is exactly the kind of project that gets better from other people's
workloads, because the limits above are limits of *one person's* sample.

The most useful contributions, roughly in order:

1. **Benchmark results from your own stack.** A new task in
   [`bench/tasks/`](bench/tasks) — another language, a monorepo, a framework
   with heavy generated code — is worth more than an opinion about the rules.
2. **A reproducible regression.** A case where ThinWindow costs more than the
   baseline, with the JSONL to prove it, is a gift: the regressions above are
   the clearest path to better numbers.
3. **Rule and hook proposals**, submitted with the measurement that justifies
   them. Rules are tested against the benchmark, not accepted on plausibility;
   the `rules/` file also has a hard token budget that CI enforces.

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow.

## Scope, limitations and disclaimer

This started as a personal tool. I built it to make my own workflow cheaper, and
I published it because the measurements might be useful to someone else — not
because it is a finished product with a support contract behind it.

Please read the numbers with that in mind:

- **The benchmark is narrow and self-selected.** Eight tasks, two repositories,
  three models, a handful of repetitions each, all chosen by me, with rules
  tuned against those same tasks. That is enough to show a direction; it is not
  enough to promise you a percentage. It is published in full, raw files and
  all, precisely so you can judge how little or how much it generalises instead
  of taking a headline number on faith.
- **Token accounting is volatile by nature.** What lands in a context window
  depends on the model version, the agent harness and its system prompt, cache
  hit rates, which tools are enabled, MCP servers, repository size, and how the
  task happens to unfold on the day. Any of these can move the result by more
  than the effect measured here. Two identical runs of the same task can differ
  substantially; the medians and ranges in the tables exist to make that
  visible rather than to hide it.
- **The results will age.** They were measured with a specific Claude Code
  version and specific model snapshots, both of which change frequently, and
  will be re-measured rather than quietly left standing.
- **No warranty.** This software is provided "as is" under the
  [MIT License](LICENSE), without warranty of any kind. You are responsible for
  what runs in your environment and for what you spend. The hooks are designed
  to fail open and never to block a tool call, and the test suite covers that
  behaviour, but no amount of testing makes a guarantee: review the code, run
  the tests, and try it on a branch before you trust it with real work.
- **It is not a substitute for a good prompt.** It removes waste; it does not
  make an agent smarter.

## FAQ

**Does it make my agent worse at the task?** That is what the success column in
every table measures. A saving that fails the task is not a saving. Across the
three models, success was identical to the baseline except on one Haiku task,
commander-rename-display-width: 1/2 without ThinWindow, 0/2 with it. Haiku
struggles there either way: three of its four runs failed, and every run took 35
turns or more.

**Why not just tell the agent to be brief?** It helps, and the rules ask for
it: output is only 0.8% to 1.4% of tokens, but at five times the input price it
is 19–27% of the cost (see [Why context is the bill](#why-context-is-the-bill)).
The rest is context: a long answer is paid once, while a long read is written
to the cache once and read again on every turn that follows it.

**Does it send my code or telemetry anywhere?** No. There is no network code in
this project: no analytics, no crash reports, no "anonymous usage statistics",
no license or update check. The hooks are local Node scripts that read the tool
call and return a decision; truncated command logs go to a temporary file on
your own disk. The only thing that leaves your machine is what your agent was
already sending to your model provider — and the point of this tool is to make
that smaller.

**Does it work outside Claude Code?** The rules do, through Agent Skills or
`AGENTS.md`. The hooks — which do the heavier lifting — are Claude Code only,
because they depend on its tool-call hook API.

## License

MIT
