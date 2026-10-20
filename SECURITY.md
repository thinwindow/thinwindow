# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on
[thinwindow/thinwindow](https://github.com/thinwindow/thinwindow/security/advisories/new).
Don't open a public issue for security problems.

You'll get an acknowledgement as soon as the maintainer sees it, and a fix
or a decision will be coordinated with you before anything is disclosed.

## Supported versions

Only the latest release receives fixes.

## What thinwindow does on your machine

Useful context when assessing a report:

- The Claude Code hooks run as your user, with Node.js, on four events: session
  start, before each prompt you send, at the end of each turn, and before each
  `Read`, `Bash` and `Grep` tool call.
- Before a tool call, the hooks read the files you or the agent point at (to
  count lines, build an outline, or detect lockfiles, minified and binary
  files), your `.thinwindow.json` files, and their own state file.
- Before each prompt, they read the last 256 KB of the session's transcript,
  and its first 256 KB when a cold-resume notice is due. At the end of each
  turn, they read the part of the transcript written since the last turn, and
  its first 256 KB while a setup-cost notice may be due. After a turn that
  could have changed files, they run `git status` in the session's folder;
  `/thinwindow:resume` also runs `git log` there.
- They write one state file per session and one small file per project under
  `<os temp dir>/thinwindow/state/`.
- At the end of each turn, they keep a brief of the session in the plugin's
  data folder (`~/.claude/plugins/data/`). A brief holds excerpts of your
  prompts and of Claude's replies; `"briefs": false` stops writing them.
- `thinwindow-run` writes the full output of the commands it runs to
  `<os temp dir>/thinwindow/logs/`. Command output can contain secrets; you can
  delete the logs at any time.
- `/thinwindow:report` reads your Claude Code transcripts
  (`~/.claude/projects/**/*.jsonl`) only when you run it, and writes nothing.
- ThinWindow removes its own files once they're 7 days old, the next time it
  runs.
- The hooks never return an `allow` decision, so they can't approve a tool
  call your permission settings would have prompted for. The `rewrite` mode,
  on by default, changes a noisy command to run through `thinwindow-run`, and
  the rewritten command still goes through your permission rules.
- thinwindow makes no network requests and collects no telemetry.
