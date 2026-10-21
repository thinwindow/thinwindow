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

- The Claude Code hooks run as your user, with Node.js, on five events: session
  start, before each prompt you send, at the end of each turn, before each
  `Read`, `Bash` and `Grep` tool call, and after each `Bash` call.
- After a `Bash` call that succeeded, the hook receives the command's output,
  as every PostToolUse hook does. It keeps nothing from it unless the command
  is a noisy one (an install, build, test or lint), whose output it cuts.
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
  `<os temp dir>/thinwindow/state/`, a folder created so only your user can open
  it (one created by 0.4 or earlier keeps its mode).
- At the end of each turn, they keep a brief of the session in the plugin's
  data folder (`~/.claude/plugins/data/`). A brief holds excerpts of your
  prompts and of Claude's replies; `"briefs": false` stops writing them.
- The Bash hook (for the output it cuts) and `thinwindow-run` write the full
  output of those commands to `<os temp dir>/thinwindow/logs/`, created the
  same way. Command output can contain secrets; you can delete the logs at any
  time.
- `/thinwindow:report` reads your Claude Code transcripts
  (`~/.claude/projects/**/*.jsonl`) only when you run it, and writes nothing.
- ThinWindow removes its own files once they're 7 days old, the next time it
  runs.
- The hooks never return an `allow` decision, so they can't approve a tool
  call your permission settings would have prompted for. The `rewrite` mode,
  on by default, adds a cap to an unbounded search or `git diff` and drops a
  `| head` that would cut a few short files, and the PreToolUse hook points a
  direct `thinwindow-run` call at the runner's path; a rewritten command still
  goes through your permission rules. Noisy commands run as written; only what
  Claude sees of their output changes.
- thinwindow makes no network requests and collects no telemetry.
