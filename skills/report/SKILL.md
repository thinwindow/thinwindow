---
name: report
description: See where your Claude Code sessions' context cost went, from the transcripts on this machine. Aggregate numbers only. Add --json for a short summary you can choose to share.
disable-model-invocation: true
metadata:
  internal: true
---

!`node "${CLAUDE_PLUGIN_ROOT}/skills/thinwindow/scripts/thinwindow-report.mjs" $ARGUMENTS`

Above is the output of ThinWindow's report script, computed locally from the
user's transcripts. Show it to the user exactly as printed, in a code block
(a `json` block if it is JSON), and add nothing else.

If shell commands are disabled and there is no output above, tell the user to
run it themselves, which keeps the numbers out of the conversation:
`! node "${CLAUDE_PLUGIN_ROOT}/skills/thinwindow/scripts/thinwindow-report.mjs"`
