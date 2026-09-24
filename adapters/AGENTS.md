<!--
thinwindow rules for agents that read AGENTS.md.
Copy everything below this comment into the AGENTS.md at the root of your
project (or into the instructions file your agent reads). Check your agent's
own docs for the file name it loads.
-->
## Reading budget (thinwindow)

<!-- rules:start (generated from rules/thinwindow.md by scripts/sync-rules.mjs; edit the source, not this block) -->
# thinwindow: read less

Everything you read stays in context and is re-sent on every later turn. Read only what the task needs.

- Locate before reading: grep or glob for the symbol, then read only the range around the matches.
- Don't read a whole file over ~300 lines. Read ranges.
- Don't re-read what is already in context unless the file changed.
- Cap command output: quiet flags, `| tail -n 40`, `--max-count`, or run noisy commands (install, build, test, lint) through `thinwindow-run <cmd>`.
- Summaries before detail: `git diff --stat`, `git log -n 10 --oneline`.
- Stop exploring once there is enough evidence to act.
- Batch independent lookups into one call.
- In answers, cite `file:line` instead of pasting large blocks.
<!-- rules:end -->

`thinwindow-run` ships with the thinwindow Agent Skill
(`npx skills add imprvhub/thinwindow`) as `scripts/thinwindow-run.mjs`; run it
with `node <skill dir>/scripts/thinwindow-run.mjs <cmd>`. If it isn't
installed, cap output with a quiet flag or `| tail -n 40` instead.
