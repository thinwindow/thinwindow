# thinwindow

**Make coding agents read less.** Fewer tokens per task, same results, and a
benchmark you can re-run yourself.

<!-- RESULTS:START -->
<!-- RESULTS:END -->

Most of what a coding agent pays for is input, not output: whole-file reads,
install and test logs, broad greps. Everything it reads stays in context and
is re-sent on every later turn, so one early 2,000-line read is paid for again
on every turn after it. thinwindow cuts that at the source, and trims the
agent's writing and chatter on the way.

## Install

**Claude Code** (rules + hooks, the full version):

```
/plugin marketplace add imprvhub/thinwindow
/plugin install thinwindow@thinwindow
```

**Any agent with Agent Skills** (Codex, Cursor, Copilot, Gemini CLI,
OpenCode...), rules only:

```
npx skills add imprvhub/thinwindow
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
   refused call goes through too, so the agent can never get stuck.

No dependencies, no telemetry, Node 18+. Details and every option:
[docs/configuration.md](docs/configuration.md).

## Benchmark

<!-- BENCH:START -->
<!-- BENCH:END -->

### How it is measured

Each **run** is one agent solving one task from scratch:

1. Clone a real open-source repo ([click](https://github.com/pallets/click)
   or [commander.js](https://github.com/tj/commander.js)) at a pinned commit,
   into a fresh temp directory.
2. Install its dependencies before the agent starts, so install logs don't
   count for either side.
3. Run `claude -p "<task>"` with the chosen model, up to 40 turns. The
   *baseline* gets plain Claude Code; *thinwindow* gets the same plus this
   plugin. Nothing else differs: no MCP servers, no user settings.
4. Run the task's hidden check (a test or a script the agent never sees). Exit
   code 0 is a success.
5. Record tokens (input, cache writes, cache reads, output, subagents
   included), cost, turns and time from Claude Code's own JSON result.

The 8 tasks are the everyday mix: bug fixes with a failing test, a small
feature, a cross-file rename, a refactor, a config lookup, and "make the
footer copyright year update automatically". Task files are in
[`bench/tasks/`](bench/tasks).

Runs are sequential, one at a time, so they never compete for rate limits.
Cost is the API-equivalent price Claude Code reports; on a subscription you
pay in usage limits instead, but the ratio is the same.

**Be skeptical, and check:**

- Every run is one line in a JSONL file in
  [`bench/results/`](bench/results), with the model, the Claude Code version,
  the thinwindow commit and the raw token counts. The tables above are
  generated from those files by [`bench/report.mjs`](bench/report.mjs).
- The rules were tuned on these same 8 tasks. Your savings on other work may
  be smaller or larger.
- Samples are small. Agents are noisy: the same task can take 4 turns once
  and 15 the next, which is why each table shows medians and per-task spread.
- Re-run it yourself (uses your own Claude Code login and limits):

  ```
  node bench/run.mjs --condition baseline,thinwindow --reps 3 --model sonnet --dry-run
  node bench/run.mjs --condition baseline,thinwindow --reps 3 --model sonnet --max-cost 10
  node bench/report.mjs
  ```

  See [bench/README.md](bench/README.md) for every option.

## FAQ

**Does it make my agent dumber?** The success rate in every table above
counts that. A saving that fails the task doesn't count as a saving.

**Why not just tell the agent to be brief?** Output is the cheap part. A
long answer is paid once; a long read is re-paid on every turn that follows.
thinwindow does trim output too, but most of the saving is on the input side.

**Does it phone home?** No. Nothing leaves your machine.

## License

MIT
