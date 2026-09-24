#!/usr/bin/env node
// skinflint-run: run a noisy command and print a short summary instead of
// its whole output.
//
//   skinflint-run <cmd> [args...]      runs the command directly
//   skinflint-run "<shell command>"    one argument runs through the shell
//
// The full stdout and stderr go to a log file in the OS temp dir (never the
// current repo). The summary has the exit code, the duration, the last 40
// lines, up to 40 deduplicated lines matching error/fail/warn/panic/exception
// that aren't already in those last lines, and the log path. The exit code
// of the command is preserved. SKINFLINT=off runs the command unchanged.
// No dependencies; Node >= 18.
import { spawn } from 'node:child_process';
import { createWriteStream, mkdirSync, readdirSync, realpathSync, statSync, unlinkSync } from 'node:fs';
import { constants, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const TAIL_LINES = 40;
export const MATCH_LINES = 40;
const MAX_LINE_CHARS = 400;
const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MATCH_RE = /error|fail|warn|panic|exception/i;
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)/g;

const USAGE = `usage: skinflint-run <cmd> [args...]
       skinflint-run "<shell command>"

Runs the command, keeps its full output in a log file in the OS temp dir, and
prints the exit code, the duration, the last ${TAIL_LINES} lines, up to ${MATCH_LINES} lines
matching error/fail/warn/panic/exception, and the log path. Exits with the
command's exit code.`;

function isOff(env) {
  const v = String(env.SKINFLINT || '').toLowerCase();
  return v === 'off' || v === '0' || v === 'false' || v === 'disabled';
}

export function logDir(base = tmpdir()) {
  return join(base, 'skinflint', 'logs');
}

function slug(text) {
  return text.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'cmd';
}

function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function pruneLogs(dir, now = Date.now()) {
  try {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (now - statSync(p).mtimeMs > LOG_MAX_AGE_MS) unlinkSync(p);
    }
  } catch {
    // Best effort.
  }
}

function quotePosix(arg) {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;
}

function quoteWindows(arg) {
  return /^[\w@%+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1')}"`;
}

// How to spawn: one argument goes through the shell; several run directly
// (on Windows through cmd.exe, so npm.cmd and friends resolve).
export function spawnSpec(args, platform = process.platform) {
  if (args.length === 1) return { file: args[0], args: [], shell: true, display: args[0] };
  if (platform === 'win32') {
    const line = args.map(quoteWindows).join(' ');
    return { file: line, args: [], shell: true, display: line };
  }
  return { file: args[0], args: args.slice(1), shell: false, display: args.map(quotePosix).join(' ') };
}

function clean(line) {
  // Progress bars redraw with \r: keep what the terminal would show last.
  const cr = line.lastIndexOf('\r');
  let s = (cr === -1 ? line : line.slice(cr + 1)).replace(ANSI_RE, '');
  if (s.length > MAX_LINE_CHARS) s = `${s.slice(0, MAX_LINE_CHARS)}… [${s.length - MAX_LINE_CHARS} more chars]`;
  return s;
}

// Collects the summary from output chunks without keeping the whole output
// in memory.
export class Summarizer {
  constructor({ tailLines = TAIL_LINES, matchLines = MATCH_LINES } = {}) {
    this.tailLines = tailLines;
    this.matchLines = matchLines;
    this.tail = [];
    this.lines = 0;
    this.matchCount = 0;
    this.candidates = [];
    this.seen = new Set();
    this.partial = '';
  }

  push(chunk) {
    const text = this.partial + chunk;
    const parts = text.split('\n');
    this.partial = parts.pop();
    for (const raw of parts) this.line(raw);
  }

  line(raw) {
    const line = clean(raw.endsWith('\r') ? raw.slice(0, -1) : raw);
    this.lines++;
    this.tail.push(line);
    if (this.tail.length > this.tailLines) this.tail.shift();
    if (MATCH_RE.test(line)) {
      this.matchCount++;
      const key = line.trim();
      // Keep enough candidates to still have matchLines after dropping the
      // ones that end up in the tail.
      if (!this.seen.has(key) && this.candidates.length < this.matchLines + this.tailLines) {
        this.seen.add(key);
        this.candidates.push(line);
      }
    }
  }

  finish() {
    if (this.partial !== '') {
      this.line(this.partial);
      this.partial = '';
    }
    const inTail = new Set(this.tail.map((l) => l.trim()));
    const matches = this.candidates.filter((l) => !inTail.has(l.trim())).slice(0, this.matchLines);
    return { lines: this.lines, tail: this.tail, matches, matchCount: this.matchCount };
  }
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  return `${m}m${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}s`;
}

export function formatSummary({ display, code, signal, durationMs, summary, logPath }) {
  const out = [];
  const status = signal ? `killed by ${signal} (exit ${code})` : `exit ${code}`;
  out.push(`$ ${display}`);
  out.push(`${status} · ${formatDuration(durationMs)} · ${summary.lines} ${summary.lines === 1 ? 'line' : 'lines'} of output`);
  if (summary.lines > 0) {
    const shown = summary.tail.length;
    out.push(shown < summary.lines ? `--- last ${shown} lines ---` : '--- output ---');
    out.push(...summary.tail);
  }
  if (summary.matches.length > 0) {
    out.push(`--- ${summary.matches.length} earlier lines matching error|fail|warn|panic|exception (${summary.matchCount} matching lines in total) ---`);
    out.push(...summary.matches);
  }
  out.push(`full log: ${logPath}`);
  return `${out.join('\n')}\n`;
}

// Runs the command. Resolves to the exit code to use.
export function run(args, { env = process.env, stdout = process.stdout, stderr = process.stderr, cwd = process.cwd(), base, platform } = {}) {
  return new Promise((resolvePromise) => {
    if (args.length === 0 || args[0] === '-h' || args[0] === '--help') {
      (args.length === 0 ? stderr : stdout).write(`${USAGE}\n`);
      resolvePromise(args.length === 0 ? 2 : 0);
      return;
    }
    const spec = spawnSpec(args, platform);

    if (isOff(env)) {
      const child = spawn(spec.file, spec.args, { shell: spec.shell, stdio: 'inherit', env, cwd });
      child.on('error', (err) => {
        stderr.write(`skinflint-run: ${err.message}\n`);
        resolvePromise(127);
      });
      child.on('close', (code, signal) => resolvePromise(code ?? 128 + (constants.signals[signal] || 0)));
      return;
    }

    const dir = logDir(base);
    mkdirSync(dir, { recursive: true });
    pruneLogs(dir);
    const logPath = join(dir, `${stamp()}-${slug(spec.display)}-${process.pid}.log`);
    const log = createWriteStream(logPath);
    const summary = new Summarizer();
    const started = Date.now();
    const child = spawn(spec.file, spec.args, {
      shell: spec.shell,
      stdio: ['inherit', 'pipe', 'pipe'],
      env,
      cwd,
      windowsHide: true,
    });
    const forward = (sig) => {
      try {
        child.kill(sig);
      } catch {
        // Already gone.
      }
    };
    const onSigint = () => forward('SIGINT');
    const onSigterm = () => forward('SIGTERM');
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    for (const stream of [child.stdout, child.stderr]) {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        log.write(chunk);
        summary.push(chunk);
      });
    }
    let spawnError = null;
    let done = false;
    const finalize = (code, signal) => {
      if (done) return;
      done = true;
      process.off('SIGINT', onSigint);
      process.off('SIGTERM', onSigterm);
      let exit = code ?? 128 + (constants.signals[signal] || 0);
      if (spawnError) {
        const msg = `skinflint-run: could not start ${spec.display}: ${spawnError.message}\n`;
        log.write(msg);
        summary.push(msg);
        exit = spawnError.code === 'ENOENT' ? 127 : 126;
      }
      log.end(() => {
        stdout.write(
          formatSummary({
            display: spec.display,
            code: exit,
            signal,
            durationMs: Date.now() - started,
            summary: summary.finish(),
            logPath,
          }),
        );
        resolvePromise(exit);
      });
    };
    child.on('error', (err) => {
      spawnError = err;
      // A command that never started emits no 'close' on every Node version.
      if (child.pid === undefined) finalize(null, null);
    });
    child.on('close', finalize);
  });
}

export async function main(argv = process.argv.slice(2)) {
  process.exitCode = await run(argv);
}

function isEntry() {
  try {
    return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) main();
