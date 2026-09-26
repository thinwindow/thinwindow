<div align="center">

![ThinWindow logo](assets/icon.iconset/icon_128x128.png)

</div>

<h1 align="center">ThinWindow</h1>

<p align="center">
  <strong>Less in the window. Less on the bill.</strong><br>
  Most of your agent's tokens are re-reads: 87–96% is context re-sent every turn. ThinWindow is both a Claude Code plugin and an Agent Skill, and it shrinks that context: 13–23% fewer tokens, measured in Claude Code on three models.
</p>

<p align="center">
  <b>English</b> · <a href="README.es.md">Español</a> · <a href="README.pt-BR.md">Português</a>
</p>

<!-- RESULTS:START -->
| Model | Tokens | Cost | Success baseline → ThinWindow | Runs |
| --- | ---: | ---: | :---: | ---: |
| Opus 5.5 | **−15.8%** | **−19.4%** | **16/16** → **16/16** | 32 |
| Sonnet 5 | **−13.2%** | **−7.9%** | **24/24** → **24/24** | 48 |
| Haiku 4.5 | **−23.0%** | **−20.2%** | **14/16** → **13/16** | 32 |

Same 8 tasks, 112 runs, one agent per run, no cherry-picking:
every run recorded is in the table, except runs superseded by a later version
of the code on the same task, which are kept in
[`bench/results/archive/`](bench/results/archive). Per-task figures, the
spread and the raw data are in [Benchmark](#benchmark) below.
<!-- RESULTS:END -->

## Why context is the bill

A coding agent does not pay mostly for what it writes. It pays for what it
carries. Every file it opens, every install log it prints and every wide grep it
runs is appended to the conversation, and the whole conversation is re-sent on
every subsequent turn. The cost of a session is therefore closer to

```
tokens ≈ context size × turns
```

than to the length of the answer. In the baseline runs measured here, **87% to 96%
of all tokens billed were cache reads** — context being re-sent, turn after turn —
against 0.6% to 1.9% for the agent's own output:

<!-- CACHE:START -->
| Model | Cache reads | Cache writes | Output |
| --- | ---: | ---: | ---: |
| Opus 5.5 | 92.0% | 6.6% | 1.3% |
| Sonnet 5 | 87.1% | 11.0% | 1.9% |
| Haiku 4.5 | 96.4% | 2.9% | 0.6% |
<!-- CACHE:END -->

That is the whole thesis. Telling an agent to be brief touches the ~1% column.
Stopping it from pulling a 2,000-line file into context on turn 3 touches the
~90% one, on every turn that follows.

ThinWindow attacks both factors: it shrinks what enters the context, and it
avoids the extra turns spent recovering from output the agent never needed.

## Install

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
     error lines.
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
Three models, 8 tasks, 112 runs. Charts and tables are generated by
[`bench/report.mjs`](bench/report.mjs) from the raw run files.

### Opus 5.5

`claude-opus-5-5` (requested as `opus`) · Claude Code 2.1.282 · ThinWindow 0.1.0 (a6ebe93) · 32 runs, up to 2 per task and condition · 2026-09-25

![Change in total tokens per task, Opus 5.5: bars left of zero are tokens saved with ThinWindow](bench/results/chart-claude-opus-5-5.svg)

<details><summary>Per-task table</summary>

| Task | Tokens baseline (min–max) | Tokens ThinWindow (min–max) | Δ tokens | Cost baseline | Cost ThinWindow | Δ cost | Turns baseline | Turns ThinWindow | Success baseline | Success ThinWindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | 320k (301k–339k) | 278k (261k–294k) | −13.2% | $0.36 | $0.24 | −33.6% | 12.5 | 11.5 | 2/2 | 2/2 |
| click-footer-year | 119k (119k–119k) | 136k (121k–151k) | +14.1% | $0.13 | $0.13 | +3.9% | 4.5 | 5.5 | 2/2 | 2/2 |
| click-help-spec | 444k (412k–475k) | 266k (230k–302k) | −40.1% | $0.34 | $0.25 | −27.2% | 16 | 13 | 2/2 | 2/2 |
| commander-ci-config | 92k (92k–92k) | 107k (91k–123k) | +17.0% | $0.13 | $0.12 | −0.9% | 3 | 3.5 | 2/2 | 2/2 |
| commander-command-clash | 284k (281k–286k) | 275k (273k–278k) | −3.0% | $0.32 | $0.28 | −10.2% | 13 | 10.5 | 2/2 | 2/2 |
| commander-extract-utils | 385k (331k–439k) | 258k (223k–292k) | −33.1% | $0.28 | $0.20 | −27.6% | 13.5 | 8 | 2/2 | 2/2 |
| commander-negate-default-order | 334k (314k–354k) | 340k (301k–379k) | +1.8% | $0.38 | $0.30 | −19.7% | 11 | 12 | 2/2 | 2/2 |
| commander-rename-display-width | 122k (122k–122k) | 107k (92k–123k) | −11.9% | $0.14 | $0.13 | −6.0% | 4 | 3.5 | 2/2 | 2/2 |
| **Total** | **2.10M** | **1.77M** | **−15.8%** | **$2.06** | **$1.66** | **−19.4%** | 77.5 | 67.5 | **16/16** | **16/16** |

</details>

Raw runs: [`bench/results/opus-528598a.jsonl`](bench/results/opus-528598a.jsonl)

### Sonnet 5

`claude-sonnet-5` (requested as `sonnet`) · Claude Code 2.1.282 · ThinWindow 0.2.0 (30e9c6b), 0.1.0 (528598a) · 48 runs, up to 3 per task and condition · 2026-09-25 to 2026-09-26

![Change in total tokens per task, Sonnet 5: bars left of zero are tokens saved with ThinWindow](bench/results/chart-claude-sonnet-5.svg)

<details><summary>Per-task table</summary>

| Task | Tokens baseline (min–max) | Tokens ThinWindow (min–max) | Δ tokens | Cost baseline | Cost ThinWindow | Δ cost | Turns baseline | Turns ThinWindow | Success baseline | Success ThinWindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | 203k (149k–265k) | 194k (142k–233k) | −4.7% | $0.15 | $0.13 | −13.0% | 10 | 12 | 3/3 | 3/3 |
| click-footer-year | 73k (72k–73k) | 73k (72k–74k) | +0.4% | $0.06 | $0.06 | −1.6% | 4 | 4 | 3/3 | 3/3 |
| click-help-spec | 186k (163k–232k) | 83k (80k–107k) | −55.3% | $0.14 | $0.09 | −35.5% | 8 | 5 | 3/3 | 3/3 |
| commander-ci-config | 75k (75k–75k) | 78k (77k–78k) | +3.9% | $0.06 | $0.07 | +4.5% | 4 | 4 | 3/3 | 3/3 |
| commander-command-clash | 180k (159k–220k) | 137k (130k–204k) | −23.8% | $0.16 | $0.15 | −4.0% | 10 | 9 | 3/3 | 3/3 |
| commander-extract-utils | 141k (80k–167k) | 189k (164k–266k) | +33.9% | $0.10 | $0.12 | +15.3% | 9 | 12 | 3/3 | 3/3 |
| commander-negate-default-order | 258k (203k–327k) | 205k (151k–278k) | −20.3% | $0.17 | $0.15 | −8.5% | 13 | 12 | 3/3 | 3/3 |
| commander-rename-display-width | 74k (55k–75k) | 74k (55k–76k) | −0.3% | $0.06 | $0.06 | −1.0% | 4 | 4 | 3/3 | 3/3 |
| **Total** | **1.19M** | **1.03M** | **−13.2%** | **$0.91** | **$0.83** | **−7.9%** | 62 | 62 | **24/24** | **24/24** |

</details>

Raw runs: [`bench/results/sonnet-30e9c6b.jsonl`](bench/results/sonnet-30e9c6b.jsonl), [`bench/results/sonnet-528598a.jsonl`](bench/results/sonnet-528598a.jsonl)

### Haiku 4.5

`claude-haiku-4-5` (requested as `haiku`) · Claude Code 2.1.282 · ThinWindow 0.1.0 (05cc89d), 0.1.0 (a6ebe93) · 32 runs, up to 2 per task and condition · 2026-09-25

![Change in total tokens per task, Haiku 4.5: bars left of zero are tokens saved with ThinWindow](bench/results/chart-claude-haiku-4-5.svg)

<details><summary>Per-task table</summary>

| Task | Tokens baseline (min–max) | Tokens ThinWindow (min–max) | Δ tokens | Cost baseline | Cost ThinWindow | Δ cost | Turns baseline | Turns ThinWindow | Success baseline | Success ThinWindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | 1.51M (1.41M–1.62M) | 1.15M (1.05M–1.26M) | −23.7% | $0.28 | $0.21 | −26.6% | 37 | 32.5 | 2/2 | 2/2 |
| click-footer-year | 259k (187k–331k) | 209k (197k–221k) | −19.5% | $0.06 | $0.06 | −8.3% | 9 | 7.5 | 2/2 | 2/2 |
| click-help-spec | 1.84M (1.67M–2.00M) | 1.63M (1.23M–2.02M) | −11.4% | $0.32 | $0.29 | −8.3% | 41 | 38 | 2/2 | 2/2 |
| commander-ci-config | 129k (96k–162k) | 142k (120k–165k) | +10.3% | $0.04 | $0.05 | +6.2% | 5 | 5 | 2/2 | 2/2 |
| commander-command-clash | 1.80M (1.49M–2.11M) | 1.65M (1.48M–1.82M) | −8.3% | $0.33 | $0.30 | −10.2% | 41 | 41 | 1/2 | 1/2 |
| commander-extract-utils | 1.29M (1.09M–1.48M) | 662k (581k–743k) | −48.6% | $0.27 | $0.15 | −45.0% | 20 | 18 | 2/2 | 2/2 |
| commander-negate-default-order | 1.96M (1.82M–2.10M) | 1.78M (1.45M–2.10M) | −9.3% | $0.37 | $0.34 | −9.8% | 39.5 | 37.5 | 2/2 | 2/2 |
| commander-rename-display-width | 2.31M (2.26M–2.37M) | 1.32M (724k–1.92M) | −42.9% | $0.39 | $0.27 | −31.2% | 38 | 41 | 1/2 | 0/2 |
| **Total** | **11.10M** | **8.54M** | **−23.0%** | **$2.06** | **$1.65** | **−20.2%** | 230.5 | 220.5 | **14/16** | **13/16** |

</details>

Raw runs: [`bench/results/haiku-528598a.jsonl`](bench/results/haiku-528598a.jsonl)

Tokens are input + cache-creation + cache-read + output, summed over every model the run used. Per task: medians over all runs, failures included; min–max in parentheses. Total: sum of the per-task medians over the 8 tasks that have both conditions; success counts every run. Δ = (ThinWindow − baseline) / baseline. Cost is Claude Code's own estimate (`total_cost_usd`), not a bill. Turns is Claude Code's `num_turns`: the top-level agent loop only. A run that delegates to a subagent (the Agent tool) can show few top-level turns while doing much more work inside it; Tokens and Cost already include that subagent work (via `modelUsage`), so they stay the fair comparison — Turns does not. The ThinWindow rules and thresholds were tuned on these same tasks.
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
- One task was re-measured after a fix. On Sonnet 5, every ThinWindow run of
  commander-ci-config capped `cat .github/workflows/*.yml` at 60 lines and cut
  the file the task asks about; the hook now keeps short concatenations whole
  ([#7](https://github.com/thinwindow/thinwindow/issues/7)). That task's three
  ThinWindow runs were re-run at 30e9c6b (+29.3% → +3.9%), and the three they
  replace are in [`bench/results/archive/`](bench/results/archive). No other
  recorded run makes that call, so no other task was re-run.
- The rules were tuned on these same 8 tasks, on two CLI-argument-parsing
  libraries, in JavaScript and Python. That is a narrow slice of software. Your
  savings on other work will differ.
- Samples are small. Agents are noisy: the same task took 4 turns in one run and
  9 in the next (commander-extract-utils on Sonnet 5, without ThinWindow), which
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

- **Not every task improves.** On Sonnet 5, three of the eight tasks still cost
  more with ThinWindow than without. Neutralising just those regressions —
  without saving a single extra token anywhere else — would take Sonnet from
  −13.2% to about −17.5%, and Opus from −15.8% to about −17.7%. Most of the
  near-term headroom is in not making short tasks worse, not in squeezing the
  long ones further. What the traces show for each of them is in
  [#7](https://github.com/thinwindow/thinwindow/issues/7).
- **Turns are the untapped factor.** Since cost is roughly context × turns, a
  turn saved is worth as much as a large read avoided. Opus took 12.9% fewer
  turns here and cut cost by 19.4%; Sonnet took as many turns as without
  ThinWindow and cut cost by 7.9%. An earlier attempt at explicit "use fewer
  turns" rules made Sonnet measurably worse and was reverted rather than kept
  and quietly excluded — that reverted experiment is still in the history.

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

**Why not just tell the agent to be brief?** Because output is roughly 1% of the
bill, as the table at the top of this README shows. A long answer is paid once;
a long read is re-paid on every turn that follows it. ThinWindow trims output
too, but that is the small half of the problem.

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
