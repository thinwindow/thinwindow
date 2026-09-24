import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Summarizer, formatSummary, logDir, run, spawnSpec } from '../skills/skinflint/scripts/skinflint-run.mjs';
import { tempDir } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BIN = join(ROOT, 'bin', 'skinflint-run');
const NODE = process.execPath;

function sink() {
  let data = '';
  return { write: (s) => (data += s), get text() { return data; } };
}

async function runCapture(args, env = {}) {
  const base = tempDir('skinflint-logs-');
  const out = sink();
  const err = sink();
  const code = await run(args, { env: { ...process.env, SKINFLINT: '', ...env }, stdout: out, stderr: err, base });
  const logPath = (/full log: (.+)$/m.exec(out.text) || [])[1];
  return { code, out: out.text, err: err.text, logPath, base };
}

// Prints `n` numbered lines, with an error line every 10th line, then exits.
const script = (n, exit = 0) =>
  `for (let i = 1; i <= ${n}; i++) console.log(i % 10 === 0 ? 'line ' + i + ' Error: bad thing ' + (i % 30) : 'line ' + i); process.exitCode = ${exit};`;

test('preserves the exit code and reports it', async () => {
  const r = await runCapture([NODE, '-e', 'process.exitCode = 7']);
  assert.equal(r.code, 7);
  assert.match(r.out, /^exit 7 · /m);
  const ok = await runCapture([NODE, '-e', '']);
  assert.equal(ok.code, 0);
  assert.match(ok.out, /^exit 0 · \S+ · 0 lines of output$/m);
});

test('prints only the last 40 lines plus earlier deduplicated matches', async () => {
  const r = await runCapture([NODE, '-e', script(200, 1)]);
  assert.equal(r.code, 1);
  const body = r.out.split('\n');
  assert.ok(body.includes('--- last 40 lines ---'));
  assert.ok(body.includes('line 161') && body.includes('line 199'));
  assert.ok(!body.includes('line 160 Error: bad thing 10') || body.indexOf('line 160 Error: bad thing 10') > body.indexOf('--- last 40 lines ---'));
  assert.ok(!body.includes('line 159'));
  // Earlier error lines: 10..150 step 10, deduplicated by text (i % 30 repeats
  // the message but the line number differs, so all are distinct).
  const header = body.find((l) => l.startsWith('--- ') && l.includes('earlier lines matching'));
  assert.ok(header, r.out);
  assert.match(header, /--- 16 earlier lines matching .* \(20 matching lines in total\) ---/);
  assert.match(r.out, /^\$ /);
  assert.match(r.out, /200 lines of output/);
});

test('deduplicates identical matching lines and caps them at 40', async () => {
  const src = `for (let i = 0; i < 500; i++) { console.log('warning: same thing'); console.log('error ' + i); } for (let i = 0; i < 40; i++) console.log('ok ' + i);`;
  const r = await runCapture([NODE, '-e', src]);
  const lines = r.out.split('\n');
  assert.equal(lines.filter((l) => l === 'warning: same thing').length, 1);
  const start = lines.findIndex((l) => l.includes('earlier lines matching'));
  const end = lines.findIndex((l) => l.startsWith('full log:'));
  assert.equal(end - start - 1, 40);
});

test('keeps the full output in a log file in the temp dir', async () => {
  const r = await runCapture([NODE, '-e', script(120)]);
  assert.ok(r.logPath, r.out);
  const rel = relative(logDir(r.base), r.logPath);
  assert.ok(!rel.startsWith('..') && !isAbsolute(rel), `${r.logPath} not under ${logDir(r.base)}`);
  const log = readFileSync(r.logPath, 'utf8');
  assert.equal(log.split('\n').filter(Boolean).length, 120);
  assert.match(log, /^line 1\n/);
});

test('captures stderr too', async () => {
  const r = await runCapture([NODE, '-e', 'console.error("panic: stderr line"); process.exitCode = 2']);
  assert.equal(r.code, 2);
  assert.match(r.out, /panic: stderr line/);
  assert.match(readFileSync(r.logPath, 'utf8'), /panic: stderr line/);
});

test('a single argument runs through the shell', async () => {
  const r = await runCapture(['echo hello&& exit 3']);
  assert.equal(r.code, 3);
  assert.match(r.out, /^hello\s*$/m);
});

test('a missing command exits 127', { skip: process.platform === 'win32' && 'cmd.exe reports missing commands itself' }, async () => {
  const r = await runCapture(['skinflint-no-such-command-xyz', '--flag']);
  assert.equal(r.code, 127);
  assert.match(r.out, /could not start/);
});

test('no arguments prints usage and exits 2', async () => {
  const r = await runCapture([]);
  assert.equal(r.code, 2);
  assert.match(r.err, /^usage: skinflint-run/);
});

test('SKINFLINT=off passes output through untouched', async () => {
  const res = spawnSync(NODE, [BIN, NODE, '-e', 'console.log("raw"); process.exitCode = 5'], {
    encoding: 'utf8',
    env: { ...process.env, SKINFLINT: 'off' },
  });
  assert.equal(res.status, 5);
  assert.equal(res.stdout, 'raw\n');
});

test('bin/skinflint-run works as an executable entry point', () => {
  const tmp = tempDir('skinflint-tmp-');
  const res = spawnSync(NODE, [BIN, NODE, '-e', 'console.log("via bin"); process.exitCode = 4'], {
    encoding: 'utf8',
    env: { ...process.env, SKINFLINT: '', TMPDIR: tmp, TEMP: tmp, TMP: tmp },
  });
  assert.equal(res.status, 4);
  assert.match(res.stdout, /^via bin$/m);
  assert.match(res.stdout, /full log: /);
});

test('strips ANSI codes and carriage-return redraws from the summary', () => {
  const s = new Summarizer();
  s.push('\u001b[31mred error\u001b[0m\n');
  s.push('progress 10%\rprogress 100%\n');
  s.push('no newline at end');
  const out = s.finish();
  assert.deepEqual(out.tail, ['red error', 'progress 100%', 'no newline at end']);
});

test('truncates very long lines in the summary', () => {
  const s = new Summarizer();
  s.push(`${'x'.repeat(5000)}\n`);
  assert.match(s.finish().tail[0], /… \[4600 more chars\]$/);
});

test('formatSummary reports signals', () => {
  const text = formatSummary({
    display: 'sleep 9',
    code: 143,
    signal: 'SIGTERM',
    durationMs: 61000,
    summary: { lines: 0, tail: [], matches: [], matchCount: 0 },
    logPath: '/tmp/x.log',
  });
  assert.match(text, /killed by SIGTERM \(exit 143\) · 1m01s · 0 lines of output/);
});

test('spawnSpec', () => {
  assert.deepEqual(spawnSpec(['npm test'], 'linux'), { file: 'npm test', args: [], shell: true, display: 'npm test' });
  assert.deepEqual(spawnSpec(['npm', 'test'], 'linux'), { file: 'npm', args: ['test'], shell: false, display: 'npm test' });
  assert.equal(spawnSpec(['grep', 'a b'], 'linux').display, "grep 'a b'");
  const win = spawnSpec(['npm', 'run', 'my script'], 'win32');
  assert.equal(win.shell, true);
  assert.equal(win.file, 'npm run "my script"');
});
