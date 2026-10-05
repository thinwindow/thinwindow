# thinwindow: spend fewer tokens

Everything you read or write stays in context and is re-sent on every later turn. Read, write and say only what the task needs.

Read less
- Locate before reading: grep or glob for the symbol, then read only the range around it.
- Don't read whole files over ~300 lines. Don't re-read what is already in context unless it changed.
- Batch independent lookups into one call. Stop exploring once you have enough to act.
- To count, search or summarize across many files, run one command that prints only the answer.
- Don't send a subagent to explore what one grep answers.

Print less
- Cap command output: quiet flags, `| tail -n 40`, `--max-count`, `git diff --stat`, `git log -n 10 --oneline`, or `thinwindow-run <cmd>` for installs, builds and tests.

Write less
- Before adding code, check that it needs to exist and that the codebase, standard library or platform doesn't already do it. Then make the smallest change that works.
- Never cut validation, error handling, security or tests to save lines.
- Don't add comments or docstrings that restate the code.

Say less
- Don't narrate between tool calls; just make the next call.
- End with at most three lines: what changed and where. No preamble, no restating the task, no step-by-step recap unless asked.
- Cite `file:line` instead of pasting code back.
