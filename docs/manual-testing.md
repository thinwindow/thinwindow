# Checking the hooks in a real Claude Code session

The unit tests (`node --test`) run the hook scripts with the same JSON that
Claude Code sends, but only a real session proves that Claude Code loads the
plugin and acts on the hook output. These steps take about ten minutes and use
a handful of short prompts.

Requirements: Claude Code 2.1.139 or newer (hooks use the exec form with
`args`), and Node.js 18 or newer on `PATH`.

## 1. Prepare a scratch project

Use a throwaway git repo so nothing real is touched:

```sh
mkdir -p /tmp/thinwindow-manual && cd /tmp/thinwindow-manual
git init -q
seq 1 1000 | sed 's/^/line /' > big.txt
printf 'export const answer = 42;\n' > small.ts
printf '{ "scripts": { "test": "node -e \\"for (let i = 0; i < 300; i++) console.log(i)\\"" } }\n' > package.json
git add . && git commit -qm init
```

## 2. Load the plugin

Pick one:

- For a single session: `claude --plugin-dir /path/to/thinwindow`
- Through the marketplace, from a local checkout:
  ```
  /plugin marketplace add /path/to/thinwindow
  /plugin install thinwindow@thinwindow
  ```
  (Once the repository is public: `/plugin marketplace add thinwindow/thinwindow`.)

To record every decision, start the session like this and keep the log open
in another terminal:

```sh
THINWINDOW_DEBUG=1 claude --debug-file /tmp/thinwindow-debug.txt --plugin-dir /path/to/thinwindow
tail -f /tmp/thinwindow-debug.txt | grep -i -E 'thinwindow|hook'
```

## 3. The hooks are registered

Run `/hooks`. Expect a `SessionStart` hook and a `PreToolUse` hook (matcher
`Read|Bash`), both with source `Plugin Hooks`.

## 4. SessionStart injects the rules

Prompt: `What does thinwindow ask you to do before reading a file? Answer in one line.`

Expect an answer based on the first rule ("Locate before reading: grep or glob
for the symbol..."). The debug log shows `SessionStart` running
`hooks/session-start.mjs`.

## 5. Large-file guard

Prompt: `Use the Read tool to read big.txt in full, with no offset or limit.`

Expect the Read to return lines 1-120, with a note (`thinwindow: big.txt has
1000 lines, so this Read returned lines 1-120...`) and a line-numbered outline
of the file. Repeating the identical whole-file Read returns the full file.
With `"rewrite": false` (section 9) the first Read is denied instead, with the
line count.

## 6. Re-read guard

Prompt: `Read small.ts. Then read small.ts again with the Read tool.`

Expect the second Read to be denied with `already in your context`. Then run
`echo 'export const other = 1;' >> small.ts` in your terminal and ask for
another read: it goes through because the file changed.

## 7. Bash anti-patterns (hard deny)

Prompt: `Run exactly this command: git log`

Expect a denial suggesting `git log -n 10 --oneline`. Try `cat big.txt`,
`ls -R` and `find . -name "*.txt"` the same way; each is denied with a cheaper
replacement. `git log -n 3 --oneline` runs normally.

## 8. Noisy commands and thinwindow-run

Prompt: `Run exactly this command: npm test`

Expect no denial: the command runs as `thinwindow-run npm test`. The output is
a summary: an `exit 0 · <duration> · <n> lines of output` header, the last 10
lines (the last 40 and the error-like lines when the command fails), and
`full log: <temp dir>/thinwindow/logs/...log`. The log file holds every line.
`thinwindow-run` is found because the plugin puts its `bin/` on the Bash
tool's `PATH`. A normal permission prompt still appears if your settings would
prompt for it.

## 9. Soft-block mode

```sh
echo '{ "rewrite": false }' > /tmp/thinwindow-manual/.thinwindow.json
```

Start a new session and prompt: `Run exactly this command: npm test`

Expect a denial suggesting `thinwindow-run npm test`; repeating the identical
command runs it uncapped. Section 5 changes the same way: the whole-file Read
is denied with the line count. Remove the file afterwards.

## 10. Compaction resets read tracking

Read `small.ts`, run `/compact`, then ask to read `small.ts` again. Expect the
read to go through (debug: `SessionStart(compact): read-tracking state
reset`).

## 11. Off switches

- `THINWINDOW=off claude --plugin-dir /path/to/thinwindow`: no rules injected,
  no denials.
- `{ "enabled": false }` in `.thinwindow.json`: same, for that project.

## 12. Fail open

Break the state file on purpose and check that tool calls still work:

```sh
cd "$(node -p 'require("os").tmpdir()')/thinwindow/state"
echo 'garbage' > "$(ls -t | head -n 1)"   # the newest file is the current session
```

Any Read or Bash call in that session proceeds normally; thinwindow starts a
fresh state.

## Headless variant

To check the wiring without an interactive session, stream the hook events
of a one-shot run. It uses the model, so it costs a small amount:

```sh
cd /tmp/thinwindow-manual
claude -p "Read big.txt in full with the Read tool, then stop." \
  --plugin-dir /path/to/thinwindow --output-format stream-json --verbose \
  --include-hook-events --max-turns 4 | grep -E 'hook|thinwindow'
```

Expect a `SessionStart` hook event and a tool result containing
`thinwindow: big.txt has 1000 lines`.
