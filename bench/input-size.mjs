#!/usr/bin/env node
// Tier 1: what ThinWindow's hooks do to the size of tool output, measured
// without a model or an API key. Every Read and Bash call in the published
// baseline traces is replayed in a fresh clone of its task's repository at
// the pinned commit, with the task's setup run first (node_modules and the
// venv are there, as they were for the agent): once as the agent sent it,
// and once as ThinWindow's PreToolUse hook rewrites or refuses it.
//
// Sizes are characters of tool output as Claude Code 2.1.282 hands it to the
// model (CLAUDE_CODE below). They are not tokens and not cost: output size is
// one part of what enters the context, and the context is one part of the
// bill. Needs network, git, bash, Node.js and Python 3; takes a few minutes.
//
//   node bench/input-size.mjs [--model <m>] [--out <file>] [--keep]
import { existsSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { handlePreToolUse } from '../hooks/lib/handlers.mjs';
import { baseName, commandWords, parseShell } from '../hooks/lib/shell.mjs';
import { RESULTS_DIR, ROOT_DIR } from './lib/paths.mjs';
import { runProcess, runSync } from './lib/proc.mjs';
import { listResultFiles, readResultFile } from './lib/results.mjs';
import { loadTask } from './lib/tasks.mjs';
import { cloneAt, makeWorkdir, removeWorkdir, runSetup, shellFor } from './lib/workspace.mjs';

// What Claude Code 2.1.282 does with a tool result, from its own tool
// descriptions and https://code.claude.com/docs/en/tools-reference: a
// successful command's output reaches the model inline up to 30,000
// characters, past that as a 2,000-character preview plus the path of the
// full log; a failed one up to 10,000. Read returns up to 2,000 lines, each
// as the line number, a tab and the line, and answers an unchanged re-read
// of the same range with a short notice instead of the content.
export const CLAUDE_CODE = {
  version: '2.1.282',
  bashInlineChars: 30000,
  bashPreviewChars: 2000,
  bashFailureChars: 10000,
  readDefaultLines: 2000,
  unchangedReread:
    'File unchanged since last read. The content from the earlier Read tool_result in this conversation is still current — refer to that instead of re-reading.',
};
// The trace keeps 140 characters per call; a call that long was cut short.
const TRACE_WIDTH = 140;

// Commands replayed as they are. Anything else (scripts, installs, edits)
// can change the clone or needs the agent's own state, so it isn't run.
const READERS = new Set([
  'cat', 'head', 'tail', 'sed', 'grep', 'egrep', 'fgrep', 'rg', 'find', 'ls', 'tree', 'wc', 'nl', 'awk', 'cut', 'sort',
  'uniq', 'tr', 'echo', 'printf', 'true', 'cd', 'pwd', 'git', 'file', 'stat', 'basename', 'dirname', 'diff', 'column', 'od',
]);
const GIT_READS = new Set(['log', 'show', 'diff', 'status', 'ls-files', 'grep', 'blame', 'rev-parse', 'branch']);
const TESTS = [/^npm (test|t|run \S+)$/, /^npx (jest|tsd|tsc|eslint)\b/, /^node --test\b/, /^(python3?|py) -m (pytest|unittest)\b/, /^pytest\b/];

function writes(name, args) {
  if (name === 'sed') return args.some((a) => /^-[^-]*i/.test(a) || a.startsWith('--in-place'));
  if (name === 'find') return args.some((a) => /^-(exec|execdir|delete|ok|okdir|fprint0?|fls)$/.test(a));
  return args.includes('--fix') || args.includes('--write');
}

// Which hook mechanism acted, read off the message the agent gets with it.
const MECHANISMS = [
  ['large Read: first lines and an outline', /so this Read returned lines/],
  ['re-read refused', /already in your context/],
  ['command run through thinwindow-run', /through thinwindow-run|can print thousands of lines/],
  ['recursive search capped', /limited `|recursed over the whole tree/],
  ['git diff shown as --stat', /as git diff --stat|git diff with no --stat/],
  ['head cap dropped from a short cat', /thinwindow dropped `/],
  ['printing refused (large, lock, minified or binary file)', /is a lockfile|is minified|is a binary file|would print all/],
  ['git log without -n refused', /git log without -n/],
  ['recursive listing refused', /ls -R lists|tree without -L|find from the repo root/],
];

export function mechanisms(message) {
  return MECHANISMS.filter(([, re]) => re.test(message || '')).map(([name]) => name);
}

// Why a traced Bash command is not replayed, or null when it can be.
export function notReplayable(command) {
  if (/<<|\n/.test(command)) return 'heredoc or script';
  const parsed = parseShell(command);
  if (!parsed.ok) return 'unparsed';
  for (const p of parsed.pipelines) {
    if (p.background) return 'background';
    for (const stage of p.stages) {
      const words = commandWords(stage).words.map((w) => w.text);
      if (words.length === 0) continue;
      const line = words.join(' ');
      const name = baseName(words[0]);
      if (stage.redirects.some((r) => r.target && r.target !== '/dev/null' && !/^\d$/.test(r.target))) return 'writes a file';
      if (writes(name, words.slice(1))) return 'writes a file';
      if (name === 'git' && !GIT_READS.has(words.find((w, i) => i > 0 && !w.startsWith('-')))) return 'changes the repository';
      if (!READERS.has(name) && !TESTS.some((re) => re.test(line))) return 'runs code';
    }
  }
  return null;
}

// Characters of a command's output as Claude Code shows it to the model.
export function inlineChars(chars, exitCode) {
  if (exitCode !== 0) return Math.min(chars, CLAUDE_CODE.bashFailureChars);
  return chars <= CLAUDE_CODE.bashInlineChars ? chars : CLAUDE_CODE.bashPreviewChars + 120;
}

// Characters of a Read result: line number, tab, line.
export function readChars(text, offset, limit) {
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  const start = Math.max(1, offset ?? 1);
  const shown = lines.slice(start - 1, start - 1 + (limit ?? CLAUDE_CODE.readDefaultLines));
  return shown.reduce((a, line, i) => a + String(start + i).length + 1 + line.length + 1, 0);
}

// "Read [3565+40] /tmp/…/thinwindow-bench-task-cond-XXXXXX/src/a.py" -> parts.
export function parseStep(step) {
  const m = /^(\w+)(?: \[(\d+)\+(\d*)\])? ?(.*)$/.exec(step);
  if (!m) return null;
  return { tool: m[1], offset: m[2] ? Number(m[2]) : undefined, limit: m[3] ? Number(m[3]) : undefined, arg: m[4], cut: step.length >= TRACE_WIDTH };
}

const CLONE_PATH = /\/(?:private\/)?(?:var\/folders|tmp)\/\S*?thinwindow-bench-[A-Za-z0-9-]+?-[A-Za-z0-9]{6}(?=\/|\s|$)/g;

function trackedFiles(dir) {
  return runSync('git', ['ls-files'], { cwd: dir }).stdout.split('\n').filter(Boolean);
}

// A traced path inside the agent's clone, mapped to the replay clone. The
// trace may have cut it short; a unique prefix still names one file.
function resolvePath(arg, dir, files) {
  const m = /thinwindow-bench-[A-Za-z0-9-]+?-[A-Za-z0-9]{6}\/(.*)$/.exec(arg);
  const rel = m ? m[1] : null;
  if (rel === null) return null;
  if (existsSync(join(dir, rel)) && statSync(join(dir, rel)).isFile()) return join(dir, rel);
  const hits = files.filter((f) => f.startsWith(rel));
  return hits.length === 1 ? join(dir, hits[0]) : null;
}

async function runBash(command, dir, env) {
  const res = await runProcess(shellFor(), ['-c', command], { cwd: dir, env, timeoutMs: 180000 });
  const chars = res.stdout.length + res.stderr.length;
  return { raw: chars, shown: inlineChars(chars, res.code), exit: res.code, timedOut: res.timedOut };
}

function hookFor(input, ctx) {
  return handlePreToolUse(input, { env: { CLAUDE_PROJECT_DIR: ctx.dir, PATH: ctx.env.PATH }, home: ctx.home, stateBase: ctx.state });
}

// One traced call, as the agent sent it and as the hook leaves it.
async function replayStep(step, ctx, reads) {
  const s = parseStep(step);
  if (!s || !['Bash', 'Read', 'Edit', 'Write'].includes(s.tool)) return null;
  const row = { tool: s.tool, call: step.replace(CLONE_PATH, '<clone>') };
  if (s.tool === 'Edit' || s.tool === 'Write') {
    // The agent changed this file: a later Read of it is not a re-read.
    const path = resolvePath(s.arg, ctx.dir, ctx.files);
    if (path) utimesSync(path, new Date(), new Date(Date.now() + ++ctx.tick * 1000));
    return null;
  }
  if (s.tool === 'Read') {
    const path = resolvePath(s.arg, ctx.dir, ctx.files);
    if (!path) return { ...row, skipped: 'path not found' };
    const text = readFileSync(path, 'utf8');
    const key = `${path}|${s.offset}|${s.limit}`;
    const mtime = statSync(path).mtimeMs;
    const before = reads.get(key) === mtime ? CLAUDE_CODE.unchangedReread.length : readChars(text, s.offset, s.limit);
    reads.set(key, mtime);
    const tool_input = { file_path: path, ...(s.offset != null && { offset: s.offset }), ...(s.limit != null && { limit: s.limit }) };
    const out = hookFor({ tool_name: 'Read', tool_input, session_id: ctx.session, cwd: ctx.dir }, ctx);
    const d = out?.hookSpecificOutput;
    if (!d) return { ...row, hook: 'none', before, after: before };
    if (d.permissionDecision === 'deny') return { ...row, hook: 'deny', why: mechanisms(d.permissionDecisionReason), before, after: d.permissionDecisionReason.length };
    const u = d.updatedInput;
    return { ...row, hook: 'rewrite', why: mechanisms(d.additionalContext), before, after: readChars(text, u.offset, u.limit) + (d.additionalContext || '').length };
  }
  if (s.cut) return { ...row, skipped: 'cut short in the trace' };
  const command = s.arg.replace(CLONE_PATH, ctx.dir);
  const out = hookFor({ tool_name: 'Bash', tool_input: { command }, session_id: ctx.session, cwd: ctx.dir }, ctx);
  const d = out?.hookSpecificOutput;
  const hook = !d ? 'none' : d.permissionDecision === 'deny' ? 'deny' : 'rewrite';
  if (d) row.why = mechanisms(d.permissionDecisionReason || d.additionalContext);
  const skip = notReplayable(command);
  if (skip) return { ...row, hook, skipped: skip };
  const before = await runBash(command, ctx.dir, ctx.env);
  if (hook === 'none') return { ...row, hook, before: before.shown, after: before.shown, exit: before.exit };
  if (hook === 'deny') return { ...row, hook, before: before.shown, after: d.permissionDecisionReason.length, exit: before.exit };
  const after = await runBash(d.updatedInput.command, ctx.dir, ctx.env);
  return { ...row, hook, before: before.shown, after: after.shown + (d.additionalContext || '').length, exit: before.exit };
}

function summarize(rows) {
  const by = (pred) => {
    const r = rows.filter(pred);
    const measured = r.filter((x) => Number.isFinite(x.before));
    const sum = (k) => measured.reduce((a, x) => a + x[k], 0);
    return { calls: r.length, measured: measured.length, before: sum('before'), after: sum('after') };
  };
  const models = [...new Set(rows.map((r) => r.model))].sort();
  return models.map((model) => {
    const mine = (r) => r.model === model;
    return {
      model,
      all: by(mine),
      changed: by((r) => mine(r) && r.hook && r.hook !== 'none'),
      rewritten: by((r) => mine(r) && r.hook === 'rewrite'),
      refused: by((r) => mine(r) && r.hook === 'deny'),
      skipped: Object.entries(rows.filter((r) => mine(r) && r.skipped).reduce((a, r) => ({ ...a, [r.skipped]: (a[r.skipped] || 0) + 1 }), {})),
    };
  });
}

async function main() {
  const { values } = parseArgs({
    options: { model: { type: 'string' }, out: { type: 'string', default: join(RESULTS_DIR, 'input-size.json') }, keep: { type: 'boolean', default: false } },
  });
  const runs = listResultFiles()
    .flatMap((f) => readResultFile(f).map((r) => ({ ...r, file: relative(ROOT_DIR, f) })))
    .filter((r) => r.condition === 'baseline' && (!values.model || r.model === values.model || r.modelResolved === values.model));
  const clones = new Map();
  const rows = [];
  const work = mkdtempSync(join(tmpdir(), 'thinwindow-input-size-'));
  try {
    for (const run of runs) {
      const task = loadTask(run.task);
      const key = `${task.repo}@${task.commit}`;
      if (!clones.has(key)) {
        const dir = makeWorkdir(`size-${run.task}`);
        cloneAt(task.repo, task.commit, dir);
        if (task.setup && !(await runSetup(task, dir)).success) throw new Error(`setup failed for ${run.task}`);
        const venv = join(dir, '.bench-venv', 'bin');
        const PATH = [existsSync(venv) && venv, join(ROOT_DIR, 'bin'), process.env.PATH].filter(Boolean).join(delimiter);
        clones.set(key, { dir, files: trackedFiles(dir), env: { ...process.env, PATH, CI: '1' } });
        process.stderr.write(`cloned ${key}\n`);
      }
      const ctx = { ...clones.get(key), session: run.sessionId, home: work, state: work, tick: 0 };
      const reads = new Map();
      for (const [i, step] of (run.trace || []).entries()) {
        const row = await replayStep(step, ctx, reads);
        if (row) rows.push({ model: run.modelResolved || run.model, task: run.task, file: run.file, session: run.sessionId, step: i, ...row });
      }
    }
  } finally {
    if (!values.keep) for (const c of clones.values()) removeWorkdir(c.dir);
    removeWorkdir(work);
  }
  const report = { generatedBy: 'bench/input-size.mjs', claudeCode: CLAUDE_CODE, unit: 'characters of tool output', summary: summarize(rows), calls: rows };
  writeFileSync(values.out, `${JSON.stringify(report, null, 1)}\n`);
  for (const s of report.summary) {
    const pct = (a, b) => (a ? `${((100 * (b - a)) / a).toFixed(1)}%` : '–');
    console.log(`${s.model}: ${s.all.calls} calls, ${s.all.measured} replayed; hooks changed ${s.changed.calls} (${s.changed.measured} replayed): ${s.all.before} -> ${s.all.after} chars (${pct(s.all.before, s.all.after)})`);
  }
  console.error(`wrote ${relative(ROOT_DIR, values.out)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
