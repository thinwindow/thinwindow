---
name: thinwindow
description: Spend fewer tokens by reading less. Use in any coding task that reads files or runs commands - locate with grep or glob before reading, read line ranges instead of whole files, skip re-reads, and cap command output with thinwindow-run.
license: MIT
---

<!-- rules:start (generated from rules/thinwindow.md by scripts/sync-rules.mjs; edit the source, not this block) -->
# thinwindow: spend fewer tokens

Everything you read stays in context and is re-sent on every later turn, so most of the cost is reading, and every extra turn re-sends all of it. Read only what the task needs, in as few turns as possible, then write and say only what it needs.

Read less
- Locate before reading: grep or glob for the symbol, then read only the range around it.
- Don't read whole files over ~300 lines. Don't re-read what is already in context unless it changed.
- Batch independent lookups into one call, and chain edit and check steps (`&&`) instead of one call each. Stop exploring once you have enough to act.
- To count, search or summarize across many files, run one command that prints only the answer.
- Don't send a subagent to explore what one grep answers.

Print less
- Cap command output when noisy: quiet flags, `| tail -n 40`, `--max-count`, or `thinwindow-run <cmd>` for installs, builds and tests.
- Never cut output you need: a short file read whole beats a second turn to fetch the rest.
- Summaries first: `git diff --stat`, `git log -n 10 --oneline`.

Write less
- Before adding code, check that it needs to exist, that the codebase doesn't have it already, and that the standard library or platform doesn't do it. Then make the smallest change that works.
- Never cut validation, error handling, security or tests to save lines.
- Don't add comments or docstrings that restate the code.

Say less
- Don't narrate between tool calls; just make the next call.
- End with at most three lines: what changed and where. No preamble, no restating the task, no step-by-step recap unless asked.
- Cite `file:line` instead of pasting code back.
<!-- rules:end -->

## Running noisy commands with thinwindow-run

`thinwindow-run <cmd> [args...]` runs a command, saves its full stdout and stderr
to a log file in the OS temp dir, and prints only:

- the exit code and the duration,
- the last 40 lines,
- up to 40 deduplicated lines matching error, fail, warn, panic or exception,
- the path of the full log.

It exits with the command's own exit code. Open the log only when the summary
is not enough, and then grep it or read a range.

```sh
thinwindow-run npm test
thinwindow-run pytest -x tests/test_api.py
thinwindow-run "npm ci && npm run build"   # a single quoted argument runs through the shell
```

With the thinwindow Claude Code plugin installed, `thinwindow-run` is on the
shell's `PATH`. Otherwise run the copy bundled with this skill:
`node <this skill's directory>/scripts/thinwindow-run.mjs <cmd>`. It needs
Node.js 18 or newer and nothing else.
