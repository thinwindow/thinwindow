# thinwindow: spend fewer tokens

Everything you read stays in context and is re-sent on every later turn, so most of the cost is reading. Read only what the task needs, then write and say only what it needs.

Read less
- Locate before reading: grep or glob for the symbol, then read only the range around it.
- Don't read whole files over ~300 lines. Don't re-read what is already in context unless it changed.
- Batch independent lookups into one call. Stop exploring once you have enough to act.
- To count, search or summarize across many files, run one command that prints only the answer.
- Don't send a subagent to explore what one grep answers.

Print less
- Cap command output: quiet flags, `| tail -n 40`, `--max-count`, or `thinwindow-run <cmd>` for installs, builds and tests.
- Summaries first: `git diff --stat`, `git log -n 10 --oneline`.

Write less
- Before adding code, check that it needs to exist, that the codebase doesn't have it already, and that the standard library or platform doesn't do it. Then make the smallest change that works.
- Never cut validation, error handling, security or tests to save lines.

Say less
- Lead with the result. No preamble, no restating the task, no recap of what you did unless asked.
- Cite `file:line` instead of pasting code back.
