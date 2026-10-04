// Session briefs (#33): a short summary of a session, kept up to date at every
// Stop from the transcript, without calling a model. The format is the one the
// resume experiment validated (#32, bench/results/experiments/resume.md):
// goal, recent requests, files edited, commands with exit codes, last message.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { loadConfig } from './config.mjs';
import { HOOK_ENV, debug } from './hook-io.mjs';
import { pruneFiles, safeId, saveState } from './state.mjs';

export const BRIEF_MAX_CHARS = 1200; // ~300 tokens at 4 chars per token
// Field limits of the brief #32 measured, and of the ≤ 150-token short form
// that /thinwindow:resume injects (same fields, same order, shorter).
export const FULL = { goal: 200, requests: 3, request: 80, files: 8, commands: 4, command: 70, max: BRIEF_MAX_CHARS };
export const SHORT = { goal: 100, requests: 1, request: 60, files: 3, commands: 2, command: 40, max: 600 };
export const BRIEF_MAX_AGE_MS = 48 * 60 * 60 * 1000;
export const MAX_READ_BYTES = 4 * 1024 * 1024;
const MAX_GIT_FILES = 200;
const WRITE_TOOLS = /^(Bash|PowerShell|Edit|MultiEdit|Write|NotebookEdit)$/;
// The prefix the Bash hook adds to run a command through thinwindow-run
// (RUN in bash-guard.mjs, not imported: the Stop hook loads only this file).
const RUN_PREFIX = /^node '[^']*thinwindow-run\.mjs' /;
const GIT_TIMEOUT_MS = 1000;

// A path inside cwd as a relative, forward-slash path; others unchanged.
export const relPath = (cwd, file) => (cwd && file.startsWith(cwd) ? relative(cwd, file).replace(/\\/g, '/') : file);

export const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

function promptText(rec) {
  if (rec.type !== 'user' || rec.isMeta || rec.isCompactSummary) return null;
  const c = rec.message?.content;
  if (typeof c === 'string') return c.startsWith('<') ? null : c;
  if (!Array.isArray(c) || c.some((b) => b.type === 'tool_result')) return null;
  const text = c.filter((b) => b.type === 'text').map((b) => b.text).join(' ');
  return text && !text.startsWith('<') ? text : null;
}

function resultText(block) {
  const c = block.content;
  return typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text || '').join(' ') : '';
}

// The fields are stored already cut to the full brief's limits, so a brief
// file never holds more of a prompt or reply than those limits allow.
export function emptyBrief() {
  return { v: 1, goal: null, requests: [], edited: [], commands: [], last: '', git: null, offset: 0, skip: false };
}

// Adds transcript records to a brief. Called once with a whole session (the
// experiment) or with each Stop's new records (the hook): same result.
export function foldRecords(brief, records, { cwd = '' } = {}) {
  for (const rec of records) {
    try {
      foldRecord(brief, rec, cwd);
    } catch {
      // A record in an unexpected shape is skipped, so it can't stall the
      // offset and fail every later Stop.
    }
  }
  return brief;
}

function foldRecord(brief, rec, cwd) {
  const p = promptText(rec);
  if (p) {
    if (brief.goal === null) brief.goal = clip(p, FULL.goal);
    else brief.requests = [...brief.requests, clip(p, FULL.request)].slice(-FULL.requests);
  }
  const content = Array.isArray(rec.message?.content) ? rec.message.content : [];
  for (const b of content) {
    if (rec.type === 'assistant' && b.type === 'text' && b.text.trim()) brief.last = clip(b.text, BRIEF_MAX_CHARS);
    if (rec.type === 'assistant' && b.type === 'tool_use') {
      const file = b.input?.file_path || b.input?.notebook_path;
      if (/^(Edit|MultiEdit|Write|NotebookEdit)$/.test(b.name) && file) {
        const rel = relPath(cwd, file);
        if (!brief.edited.includes(rel)) brief.edited.push(rel);
      }
      if (b.name === 'Bash' && b.input?.command) {
        const cmd = String(b.input.command).split('\n')[0].replace(RUN_PREFIX, ''); // read as typed
        brief.commands = [...brief.commands, { id: b.id, cmd: clip(cmd, FULL.command), exit: null }].slice(-FULL.commands);
      }
    }
    if (rec.type === 'user' && b.type === 'tool_result') {
      const c = brief.commands.find((x) => x.id === b.tool_use_id);
      if (c) {
        const m = /Exit code (\d+)/.exec(resultText(b));
        c.exit = b.is_error ? (m ? Number(m[1]) : 1) : 0;
      }
    }
  }
}

// The brief as text. Files edited lists `git status` first (agents often edit
// through Bash, which no Edit/Write call shows), then Edit/Write calls.
export function renderBrief(brief, limits = FULL) {
  const cmds = brief.commands.slice(-limits.commands).map((c) => `\`${clip(c.cmd, limits.command)}\` → ${c.exit === null ? '?' : `exit ${c.exit}`}`);
  const all = [...new Set([...(brief.git || []), ...brief.edited])];
  const files = all.length > limits.files ? [...all.slice(0, limits.files), `+${all.length - limits.files} more`] : all;
  const lines = [
    'Brief of an earlier session in this repository, for reference only: check it against `git status` and the files before relying on it.',
    `Goal: ${clip(brief.goal, limits.goal) || 'unknown'}`,
    `Recent requests: ${brief.requests.slice(-limits.requests).map((p) => clip(p, limits.request)).join(' | ') || 'none'}`,
    `Files edited: ${files.join(', ') || 'none'}`,
    `Commands: ${cmds.join('; ') || 'none'}`,
  ];
  const head = lines.join('\n');
  const room = limits.max - head.length - '\nLast message: '.length;
  return `${head}\nLast message: ${clip(brief.last, Math.max(40, room)) || 'none'}`.slice(0, limits.max);
}

// A ≤ 300-token brief of a whole session's transcript records.
export function buildBrief(records, { cwd = '' } = {}) {
  return renderBrief(foldRecords(emptyBrief(), records, { cwd }));
}

// --- Storage: <CLAUDE_PLUGIN_DATA>/briefs/<project hash>/<session id>.json ---

export function briefsDir(dataDir, projectDir) {
  return join(dataDir, 'briefs', createHash('sha256').update(String(projectDir)).digest('hex').slice(0, 16));
}

export function loadBrief(path) {
  try {
    const b = JSON.parse(readFileSync(path, 'utf8'));
    if (b?.v === 1 && Number.isInteger(b.offset) && [b.requests, b.edited, b.commands].every(Array.isArray)) return b;
  } catch {
    // Missing or corrupt: start over.
  }
  return emptyBrief();
}

// Complete JSONL records written to `path` after byte `offset`, reading at
// most `max` bytes, so a Stop never reads a whole long transcript; a long
// backlog is caught up over the next Stops. A partly written last line waits
// for the next Stop. A line longer than `max` (an inline image) is skipped:
// `skip` says the read ended inside one.
export function readNewRecords(path, offset, skip = false, max = MAX_READ_BYTES) {
  const fd = openSync(path, 'r');
  let buf;
  try {
    const len = Math.max(0, Math.min(fstatSync(fd).size - offset, max));
    buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, offset);
  } finally {
    closeSync(fd);
  }
  let start = 0;
  if (skip) {
    const nl = buf.indexOf(10);
    if (nl === -1) return { records: [], offset: offset + buf.length, skip: true };
    start = nl + 1;
  }
  const end = buf.lastIndexOf(10) + 1;
  if (end <= start) {
    if (start === 0 && buf.length === max) return { records: [], offset: offset + max, skip: true };
    return { records: [], offset: offset + start, skip: false };
  }
  const records = [];
  for (const line of buf.toString('utf8', start, end).split('\n')) {
    if (!line) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      // Not a record.
    }
  }
  return { records, offset: offset + end, skip: false };
}

// Changed and untracked files under `cwd`'s repository, relative to its root,
// or null outside a repository (or if git is slow or missing).
// --no-optional-locks: never take the index lock from under the user's git.
export function gitChangedFiles(cwd) {
  const r = spawnSync('git', ['--no-optional-locks', 'status', '--porcelain', '-z'], {
    cwd,
    encoding: 'utf8',
    timeout: GIT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  const files = [];
  const entries = r.stdout.split('\0');
  for (let i = 0; i < entries.length; i++) {
    if (entries[i].length > 3) files.push(entries[i].slice(3));
    if (/^[RC]/.test(entries[i])) i++; // the next entry is the rename's source
  }
  // ponytail: keeps the first 200 files, so "+N more" undercounts past that.
  return files.slice(0, MAX_GIT_FILES);
}

// The Stop hook's work: fold what the transcript gained since the last Stop
// into this session's brief. Skips everything when nothing changed.
export function updateBrief({ dataDir, projectDir, sessionId, transcriptPath, cwd, lastMessage, toolCalls, now = Date.now() }) {
  const dir = briefsDir(dataDir, projectDir);
  const path = join(dir, `${safeId(sessionId)}.json`);
  let brief = loadBrief(path);
  const size = statSync(transcriptPath).size;
  // The transcript is written asynchronously and can lag this turn; Claude
  // Code passes the turn's final text separately.
  const last = typeof lastMessage === 'string' && lastMessage.trim() ? clip(lastMessage, BRIEF_MAX_CHARS) : null;
  if (size === brief.offset && (last === null || last === brief.last)) return { path, skipped: true };
  if (size < brief.offset) brief = emptyBrief(); // the transcript was replaced
  const read = readNewRecords(transcriptPath, brief.offset, brief.skip);
  foldRecords(brief, read.records, { cwd });
  if (last !== null) brief.last = last;
  brief.offset = read.offset;
  brief.skip = read.skip;
  // git status only after a turn that could have changed files (~20 ms).
  // Older Claude Code versions don't pass the turn's tool calls: run it.
  if (cwd && (!Array.isArray(toolCalls) || toolCalls.some((c) => WRITE_TOOLS.test(c?.tool_name)))) brief.git = gitChangedFiles(cwd);
  brief.created ??= new Date(now).toISOString();
  brief.updated = new Date(now).toISOString();
  mkdirSync(dir, { recursive: true });
  saveState(path, brief);
  return { path, skipped: false, records: read.records.length };
}

// Stop hook: keep this session's brief up to date for /thinwindow:resume.
// Prints nothing, so a session that never uses the brief gains no tokens.
// Claude Code runs Stop hooks synchronously (`async` is for tool events
// only), so this reads just what the transcript gained since the last Stop,
// and lives here, not in handlers.mjs, to load fewer modules.
// Input schema: https://code.claude.com/docs/en/hooks#stop-input
export function handleStop(input, { env = HOOK_ENV, home, now = Date.now() } = {}) {
  const dataDir = env.CLAUDE_PLUGIN_DATA;
  if (!dataDir || !input.session_id || typeof input.transcript_path !== 'string') return null;
  const projectDir = env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const config = loadConfig({ projectDir, env, home });
  if (!config.enabled || !config.briefs) return null;
  const r = updateBrief({
    dataDir,
    projectDir,
    sessionId: input.session_id,
    transcriptPath: input.transcript_path,
    cwd: typeof input.cwd === 'string' ? input.cwd : projectDir,
    lastMessage: input.last_assistant_message,
    toolCalls: input.tool_calls_in_turn,
    now,
  });
  // Counts only: never transcript content.
  debug(r.skipped ? 'Stop: transcript unchanged' : `Stop: brief updated from ${r.records} new records`, env);
  return null;
}

// Removes briefs older than 7 days, and project folders left empty.
export function pruneBriefs(dataDir, { now = Date.now() } = {}) {
  const root = join(dataDir, 'briefs');
  let dirs = [];
  try {
    dirs = readdirSync(root);
  } catch {
    return;
  }
  for (const d of dirs) {
    pruneFiles(join(root, d), { now });
    try {
      rmdirSync(join(root, d));
    } catch {
      // Not empty.
    }
  }
}

// --- /thinwindow:resume ---

// This project's most recently written brief, if it is under 48 hours old.
export function latestBrief(dataDir, projectDir, now = Date.now()) {
  const dir = briefsDir(dataDir, projectDir);
  let best = null;
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return null;
  }
  for (const name of names) {
    try {
      const mtime = statSync(join(dir, name)).mtimeMs;
      if (now - mtime < BRIEF_MAX_AGE_MS && (!best || mtime > best.mtime)) best = { path: join(dir, name), mtime };
    } catch {
      // Removed meanwhile.
    }
  }
  return best && { path: best.path, brief: loadBrief(best.path), mtime: best.mtime };
}

function commitsSince(dir, iso) {
  const r = spawnSync('git', ['log', `--since=${iso}`, '--format=%h %s', '-n', '100'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 2000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  return r.stdout.split('\n').filter(Boolean);
}

function ago(ms) {
  const min = Math.max(1, Math.round(ms / 60000));
  return min < 120 ? `${min} min` : `${Math.round(min / 60)} h`;
}

// What /thinwindow:resume injects: the short brief, its age, the commits made
// since, and where the full brief is.
export function resumeText({ dataDir, projectDir, now = Date.now() }) {
  const found = dataDir && projectDir ? latestBrief(dataDir, projectDir, now) : null;
  if (!found || found.brief.goal === null) return 'No ThinWindow brief from the last 48 hours for this project.\n';
  const { path, brief, mtime } = found;
  const commits = commitsSince(projectDir, brief.updated || new Date(mtime).toISOString());
  let since = '';
  if (commits) {
    const n = commits.length === 100 ? '100+' : String(commits.length);
    since = commits.length ? `; ${n} commit${commits.length === 1 ? '' : 's'} since: ${clip(commits.slice(0, 3).join('; '), 150)}` : '; no commits since';
  }
  return `${renderBrief(brief, SHORT)}\nWritten ${ago(now - mtime)} ago${since}.\nFull brief: ${path}\n`;
}
