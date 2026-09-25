<!--
thinwindow rules for agents that read AGENTS.md.
Copy everything below this comment into the AGENTS.md at the root of your
project (or into the instructions file your agent reads). Check your agent's
own docs for the file name it loads.
-->
## Reading budget (thinwindow)

<!-- rules:start (generated from rules/thinwindow.md by scripts/sync-rules.mjs; edit the source, not this block) -->
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
- Don't add comments or docstrings that restate the code.

Say less
- Don't narrate between tool calls; just make the next call.
- End with at most three lines: what changed and where. No preamble, no restating the task, no step-by-step recap unless asked.
- Cite `file:line` instead of pasting code back.
<!-- rules:end -->

`thinwindow-run` ships with the thinwindow Agent Skill
(`npx skills add thinwindow/thinwindow`) as `scripts/thinwindow-run.mjs`; run it
with `node <skill dir>/scripts/thinwindow-run.mjs <cmd>`. If it isn't
installed, cap output with a quiet flag or `| tail -n 40` instead.
