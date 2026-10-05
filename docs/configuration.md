# Configuration

thinwindow works without configuration. To change it, create
`.thinwindow.json` in the project root or `~/.thinwindow.json` in your home
directory. Values in the project file override the home file; lists
(`noisyCommands`, `allowlist.*`) from both files are combined.

```json
{
  "enabled": true,
  "maxReadLines": 400,
  "rewrite": true,
  "briefs": true,
  "coldResumeNotice": true,
  "coldResumeMinTokens": 100000,
  "noisyCommands": ["^just (build|test)\\b"],
  "allowlist": {
    "paths": ["docs/**", "*.lock"],
    "commands": ["^make lint$"]
  }
}
```

| Key | Default | What it does |
| --- | --- | --- |
| `enabled` | `true` | `false` turns every hook off for that project (or everywhere, in `~/.thinwindow.json`). |
| `maxReadLines` | `400` | A whole-file `Read` (no `offset`/`limit`) of a file with more lines than this is denied, and so is `cat` of such a file. |
| `rewrite` | `true` | Runs uncapped noisy commands through `thinwindow-run` automatically (via the hook's `updatedInput`), so the agent gets a summary without spending a turn on a denial. The rewritten command still goes through your normal permission rules. `false` denies them instead, with a soft block. |
| `briefs` | `true` | `false` stops the Stop hook from writing session briefs for `/thinwindow:resume`. Briefs already written are deleted after 7 days. |
| `coldResumeNotice` | `true` | `false` turns off the cold-resume notice (see UserPromptSubmit below). |
| `coldResumeMinTokens` | `100000` | The smallest context, in tokens, for which the cold-resume notice holds a prompt. |
| `setupNotice` | `true` | `false` turns off the setup-cost notice (see Stop below). |
| `setupNoticeMinTokens` | `40000` | The smallest first request, in tokens, for which the setup-cost notice shows. |
| `noisyCommands` | see below | Extra regular expressions for noisy commands. They are added to the built-in list. |
| `allowlist.paths` | `[]` | Globs (`*`, `?`, `**`) for files thinwindow never blocks, matched against the path relative to the project root and the absolute path. A glob without `/` matches the file name anywhere. |
| `allowlist.commands` | `[]` | Regular expressions for Bash commands thinwindow never blocks, tested against the whole command. Use it to exempt a built-in noisy pattern. |

A missing, unreadable or mistyped file is ignored (with a debug message), and a
key with the wrong type keeps its default.

## Environment variables

| Variable | Effect |
| --- | --- |
| `THINWINDOW=off` | Turns thinwindow off, whatever the config files say. `thinwindow-run` then runs the command with its output untouched. |
| `THINWINDOW_DEBUG=1` | The hooks write each decision to stderr, which Claude Code keeps in its debug log (`claude --debug`, or `claude --debug-file <path>`). |

## What the hooks do

**SessionStart** (startup, resume, clear, compact, fork) adds
`rules/thinwindow.md` to Claude's context. On `compact` and `clear` it also
forgets which files were read, because that content is no longer in the
context.

**PreToolUse `Read`**

- Large-file guard: no `offset`/`limit` and more than `maxReadLines` lines →
  the Read returns the first 120 lines, plus a line-numbered outline of the
  file's classes, functions and headings, so the agent can read the range it
  needs in the next call. With `rewrite` off, the call is denied instead,
  with the line count and a suggestion to grep and read a range.
- Re-read guard: the same file and range, read earlier by the same agent
  (the main conversation and each subagent are tracked separately), with the
  same mtime and size → denied as "already in context".
- Soft block: repeating the exact denied (or shortened) call within ten minutes goes through,
  so the agent can never get stuck. Ranged reads count for Claude Code's
  read-before-edit check; only reads cut short with a `PARTIAL view` notice
  don't ([docs](https://code.claude.com/docs/en/tools-reference#edit-tool-behavior)).
- Images, PDFs, notebooks, binary files and missing paths are left alone.

**PreToolUse `Bash`**

- Denied outright, with a cheaper replacement: `cat` (or `bat`, `less`,
  `more`, `nl`, `tac`) of a file over `maxReadLines` lines, of a lockfile, or
  of a minified or binary file; `git log` without `-n`, a range or `--since`;
  `ls -R`; `tree` without `-L`; `find` from the repo root without
  `-maxdepth`. Output piped into `head`, `tail`, `grep`, `wc` and similar, or
  redirected to a file, is considered capped and is not blocked.
- Noisy commands (install, build, test and lint for npm, pnpm, yarn, bun,
  pip, uv, poetry, pytest, cargo, go, gradle, maven, dotnet, make and more;
  see `DEFAULT_NOISY_COMMANDS` in `hooks/lib/config.mjs`) that aren't capped by
  a pipe, a redirect, a quiet flag or `thinwindow-run` → rewritten to
  `thinwindow-run <cmd>`, or a soft block when `rewrite` is off. Commands started
  in the background are left alone.
- Scope issues → fixed in place, or a soft block suggesting the fix when
  `rewrite` is off: a recursive search is limited to its first 100 lines (grep
  also skips `node_modules`, `.git`, `dist` and `build`), and a bare
  `git diff` runs as `git diff --stat`. What counts as a scope issue: a recursive `grep`/`egrep`/`fgrep` (with `-r`/
  `-R`/`--recursive`), or `rg`/`ag` (always recursive), over the whole tree
  with no `-m`/`--max-count`, no exclude flag (`--exclude-dir` for grep;
  `-g`/`--type` for `rg`) and no output-bounding flag (`-c`/`-l`/`-L`,
  `--count`, `--files-with-matches`); or `git diff` with no summary flag
  (`--stat` and friends) and no path, either after `--` or naming a file or
  directory that exists. Scoping to a subdirectory,
  a single file, or a pipe/redirect (same as above) avoids it.

**PreToolUse `Grep`**

- A content search (`output_mode: "content"`) with no `head_limit` gets
  `head_limit: 100`. File-list and count searches are left alone.

**`thinwindow-run`** keeps the full log in the temp dir and prints the exit
code and duration, then the last 10 lines when the command succeeded, or the
last 40 lines plus earlier error-like lines when it failed. When nothing would
be cut (at most 10 lines on success, 40 on failure), it prints the output as it
is, plus the exit code if the command failed. The hook runs it as
`node '<plugin dir>/skills/thinwindow/scripts/thinwindow-run.mjs' <cmd>` and
points a direct `thinwindow-run <cmd>` at the same path. To run those calls
without a permission prompt, allow
`Bash(node '*/skills/thinwindow/scripts/thinwindow-run.mjs' *)`; it replaces
`Bash(thinwindow-run *)`, which no longer matches. Either rule approves every
command it wraps.

thinwindow never returns an `allow` decision, so it can't approve a tool call
your permission settings would have prompted for. If a hook fails for any
reason, the tool call proceeds.

**Stop** (the end of every turn) updates the session's brief for
`/thinwindow:resume`. It reads only what the transcript gained since the last
turn (at most 4 MB per turn), runs `git status` after a turn that used Bash,
Edit or Write, and prints nothing. Claude Code waits for Stop hooks before
the turn ends, so this one skips its work when the transcript hasn't grown.

Stop also shows the setup-cost notice. Every request re-sends the session's
setup (system prompt, tools, skill listing, MCP instructions, CLAUDE.md
files), so a session's first request shows what each later one starts at.

- It reads the first 256 KB of the transcript for the first request: its
  context, and the attachments written before it, sized as in
  `/thinwindow:report` (JSON characters / 4).
- When that context is at least `setupNoticeMinTokens`, it shows you one
  line, as a `systemMessage`, which Claude never sees:

  ```text
  ThinWindow: each request in this session starts at 54k tokens (skill listing 5.3k, deferred tools 2.5k, MCP instructions 1.6k). Run /context to see what you could turn off.
  ```

- At most once a week per project, and only in sessions a person attends
  (`CLAUDE_CODE_SESSION_ATTENDED=1`, as above). If the transcript doesn't have
  the first request yet, a later turn checks again.

**UserPromptSubmit** (before each prompt) is the cold-resume notice. Claude
Code caches a conversation for an hour at most, so a prompt sent after an hour
without a request re-writes the whole context at the cache-write price.

- It reads the last 256 KB of the session's transcript for the last request:
  its time, its context (input + cache read + cache write tokens) and its
  model.
- When that request is over an hour old and its context is at least
  `coldResumeMinTokens`, it holds the prompt once. The message shows what
  continuing re-writes, in tokens and in US$ at the model's list price, next
  to a fresh start: `/clear`, then `/thinwindow:resume <your request>`, or a
  new session when this session's brief isn't the project's newest. The fresh
  start's figure is the session's first request, from the first 256 KB of the
  transcript.
- Sending again continues. Any prompt goes through until a request runs, and
  the hook never acts for you.
- It never holds a command (a prompt starting with `/`), or a prompt Claude
  Code writes itself, such as a background task's report. It holds nothing
  unless Claude Code says a person is at the session: it sets
  `CLAUDE_CODE_SESSION_ATTENDED=1` for hooks in terminal, IDE and desktop
  sessions and `0` in `-p`, SDK and background ones. That variable isn't
  documented; without it, nothing is held.

## State and logs

- Read tracking lives in one JSON file per session in
  `<os temp dir>/thinwindow/state/`, with the time of the last request a
  cold-resume notice was shown for. The same folder holds one
  `setup-<project hash>.mark` file per project, with when the setup-cost
  notice was last shown. Files older than a week are removed at the start of
  a new session.
- `thinwindow-run` logs go to `<os temp dir>/thinwindow/logs/` and are removed
  after a week.
- Session briefs live in `<plugin data dir>/briefs/<project hash>/<session id>.json`
  (`~/.claude/plugins/data/` holds the plugin data dir), and are removed after
  a week, at the start of a new session. `/thinwindow:resume` reads the newest
  one under 48 hours old for the current project. Nothing is written inside your repository, and nothing is
  sent anywhere.
