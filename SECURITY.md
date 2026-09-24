# Security policy

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on
[imprvhub/thinwindow](https://github.com/imprvhub/thinwindow/security/advisories/new).
Don't open a public issue for security problems.

You'll get an acknowledgement as soon as the maintainer sees it, and a fix
or a decision will be coordinated with you before anything is disclosed.

## Supported versions

Only the latest release receives fixes.

## What thinwindow does on your machine

Useful context when assessing a report:

- The Claude Code hooks run as your user, with Node.js, on every session
  start and on every `Read` and `Bash` tool call.
- The hooks read files you or the agent point at (to count lines or detect
  lockfiles, minified and binary files), your `.thinwindow.json` files, and
  their own state file.
- They write one state file per session under `<os temp dir>/thinwindow/state/`.
- `thinwindow-run` writes the full output of the commands it runs to
  `<os temp dir>/thinwindow/logs/`. Command output can contain secrets; the
  logs are pruned after a week, and you can delete them at any time.
- The hooks never return an `allow` decision, so they can't approve a tool
  call your permission settings would have prompted for. The optional
  `rewrite` mode changes a command to run through `thinwindow-run`, and the
  rewritten command still goes through your permission rules.
- thinwindow makes no network requests and collects no telemetry.
