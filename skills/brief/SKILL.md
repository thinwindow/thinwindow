---
name: brief
description: Before stepping away, have Claude write a handoff of this session while its cache is still warm. /thinwindow:resume brings it into a fresh session.
disable-model-invocation: true
metadata:
  internal: true
---

Write a handoff of this session for a fresh session that will continue the
work. It is your whole reply: plain text, under 900 characters, exactly these
five lines:

Summary: what the session set out to do, and what is done.
Stopped at: where the work stopped (file, function or command).
Decisions: each decision and why, in a few words.
Didn't work: what was tried and failed, so it isn't tried again.
Next step: the one next action, specific enough to start without asking.

Use only this conversation. Don't read files or run commands for it.
