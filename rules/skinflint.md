# skinflint: read less

Everything you read stays in context and is re-sent on every later turn. Read only what the task needs.

- Locate before reading: grep or glob for the symbol, then read only the range around the matches.
- Don't read a whole file over ~300 lines. Read ranges.
- Don't re-read what is already in context unless the file changed.
- Cap command output: quiet flags, `| tail -n 40`, `--max-count`, or run noisy commands (install, build, test, lint) through `skinflint-run <cmd>`.
- Summaries before detail: `git diff --stat`, `git log -n 10 --oneline`.
- Stop exploring once there is enough evidence to act.
- Batch independent lookups into one call.
- In answers, cite `file:line` instead of pasting large blocks.
