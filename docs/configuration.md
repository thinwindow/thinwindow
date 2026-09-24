# Configuration

thinwindow works without configuration. To change it, create
`.thinwindow.json` in the project root or `~/.thinwindow.json` in your home
directory. Values in the project file override the home file; lists
(`noisyCommands`, `allowlist.*`) from both files are combined.

```json
{
  "enabled": true,
  "maxReadLines": 400,
  "rewrite": false,
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
| `rewrite` | `false` | `true` runs uncapped noisy commands through `thinwindow-run` automatically (via the hook's `updatedInput`) instead of denying them. The rewritten command still goes through your normal permission rules. |
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
  denied with the line count and a suggestion to grep and read a range.
- Re-read guard: the same file and range, read earlier by the same agent
  (the main conversation and each subagent are tracked separately), with the
  same mtime and size → denied as "already in context".
- Soft block: repeating the exact denied call within ten minutes goes through,
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
  a pipe, a redirect, a quiet flag or `thinwindow-run` → soft block suggesting
  `thinwindow-run <cmd>`, or a rewrite when `rewrite` is on. Commands started
  in the background are left alone.

thinwindow never returns an `allow` decision, so it can't approve a tool call
your permission settings would have prompted for. If a hook fails for any
reason, the tool call proceeds.

## State and logs

- Read tracking lives in one JSON file per session in
  `<os temp dir>/thinwindow/state/`. Files older than a week are removed at
  the start of a new session.
- `thinwindow-run` logs go to `<os temp dir>/thinwindow/logs/` and are removed
  after a week. Nothing is written inside your repository, and nothing is
  sent anywhere.
