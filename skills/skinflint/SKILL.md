---
name: skinflint
description: Spend fewer tokens by reading less. Use in any coding task that reads files or runs commands - locate with grep or glob before reading, read line ranges instead of whole files, skip re-reads, and cap command output with skinflint-run.
license: MIT
---

<!-- rules:start (generated from rules/skinflint.md by scripts/sync-rules.mjs; edit the source, not this block) -->
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
<!-- rules:end -->

## Running noisy commands with skinflint-run

`skinflint-run <cmd> [args...]` runs a command, saves its full stdout and stderr
to a log file in the OS temp dir, and prints only:

- the exit code and the duration,
- the last 40 lines,
- up to 40 deduplicated lines matching error, fail, warn, panic or exception,
- the path of the full log.

It exits with the command's own exit code. Open the log only when the summary
is not enough, and then grep it or read a range.

```sh
skinflint-run npm test
skinflint-run pytest -x tests/test_api.py
skinflint-run "npm ci && npm run build"   # a single quoted argument runs through the shell
```

With the skinflint Claude Code plugin installed, `skinflint-run` is on the
shell's `PATH`. Otherwise run the copy bundled with this skill:
`node <this skill's directory>/scripts/skinflint-run.mjs <cmd>`. It needs
Node.js 18 or newer and nothing else.
