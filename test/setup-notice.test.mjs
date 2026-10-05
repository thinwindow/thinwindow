// Setup-cost notice (#35): the first-request sensor, the Stop hook's notice
// and its once-a-week mark, against fixture transcripts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { REPEAT_MS, handleSetupNotice, markPath } from '../hooks/lib/setup-notice.mjs';
import { firstAttachments } from '../hooks/lib/usage.mjs';
import { buildReport, thinwindowActions } from '../skills/thinwindow/scripts/thinwindow-report.mjs';
import { tempDir } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STOP = join(ROOT, 'hooks', 'stop.mjs');
const SECRET = 'REPLY-SECRET-9e2a';
const NOW = Date.now();

const att = (type, chars, extra = {}) => ({ type: 'attachment', ...extra, attachment: { type, content: 'y'.repeat(chars) } });
const req = (id, context, minAgo = 10) => ({
  type: 'assistant',
  timestamp: new Date(NOW - minAgo * 60000).toISOString(),
  message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: context - 5, output_tokens: 40 } },
});
const jsonl = (records) => records.map((r) => JSON.stringify(r)).join('\n') + '\n';
// A 54k first request: skill listing ~5.3k, deferred tools ~2.5k, MCP
// instructions ~1.6k, CLAUDE.md ~0.5k tokens.
const SETUP = [att('skill_listing', 21000), att('deferred_tools_delta', 10000), att('mcp_instructions_delta', 6400), att('nested_memory', 2000), att('date', 50)];
const RECORDS = [{ type: 'user', message: { content: 'Fix the pager.' } }, ...SETUP, req('m1', 54000), att('skill_listing', 90000), req('m2', 56000, 9), req('m3', 57000, 8)];

function session(records = RECORDS, { id = 's1', dir = tempDir('thinwindow-setup-'), stateBase = tempDir('thinwindow-state-') } = {}) {
  const transcript = join(dir, `${id}.jsonl`);
  writeFileSync(transcript, jsonl(records));
  const env = { CLAUDE_CODE_SESSION_ATTENDED: '1', CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_DATA: '' };
  const input = { session_id: id, transcript_path: transcript, cwd: dir, hook_event_name: 'Stop', last_assistant_message: SECRET };
  return { dir, transcript, input, env, opts: { env, home: tempDir('thinwindow-home-'), stateBase, now: NOW } };
}

const LINE = 'ThinWindow: each request in this session starts at 54k tokens (skill listing 5.3k, deferred tools 2.5k, MCP instructions 1.6k). Run /context to see what you could turn off.';

test('the sensor sums the attachments before the first request', () => {
  const sizes = firstAttachments(jsonl([att('skill_listing', 100), att('skill_listing', 50, { isSidechain: true }), att('date', 10), req('m1', 30000), att('skill_listing', 9000)]));
  assert.deepEqual(sizes, { skill_listing: JSON.stringify(att('skill_listing', 100).attachment).length, date: JSON.stringify(att('date', 10).attachment).length });
  assert.equal(firstAttachments(jsonl([att('skill_listing', 100)])), null, 'no request yet');
  assert.deepEqual(firstAttachments(jsonl([req('m1', 30000)])), {});
});

test('shows one line with the three largest parts, marks the project, counts it', async () => {
  const s = session();
  assert.deepEqual(await handleSetupNotice(s.input, s.opts), { systemMessage: LINE });
  const files = readdirSync(join(s.opts.stateBase, 'thinwindow', 'state')).sort();
  assert.deepEqual(files, ['s1.json', markPath(s.dir, s.opts.stateBase).split(/[\\/]/).pop()].sort());
  assert.ok(!markPath(s.dir).endsWith('.json'), 'the report counts *.json files as sessions');
  assert.deepEqual(thinwindowActions(s.opts.stateBase), { sessions: 1, actions: { 'Setup.notice': 1 } });
});

test('once a week per project', async () => {
  const s = session();
  assert.ok(await handleSetupNotice(s.input, s.opts));
  assert.equal(await handleSetupNotice(s.input, s.opts), null, 'the next Stop');
  const same = session(RECORDS, { id: 's2', dir: s.dir, stateBase: s.opts.stateBase });
  assert.equal(await handleSetupNotice(same.input, { ...same.opts, now: NOW + REPEAT_MS - 1 }), null, 'another session, same project, within the week');
  assert.ok(await handleSetupNotice(same.input, { ...same.opts, now: NOW + REPEAT_MS }), 'a week later');
  const other = session(RECORDS, { stateBase: s.opts.stateBase });
  assert.ok(await handleSetupNotice(other.input, other.opts), 'another project');
});

test('stays silent: small setups, no request yet, unattended sessions, off switches', async () => {
  const silent = async (s, opts = s.opts) => {
    assert.equal(await handleSetupNotice(s.input, opts), null);
    assert.equal(existsSync(join(opts.stateBase, 'thinwindow')), false, 'no mark or state written');
  };
  await silent(session([...SETUP, req('m1', 39999)]));
  await silent(session([{ type: 'user', message: { content: 'x' } }, ...SETUP]));
  const s = session();
  await silent({ ...s, input: { ...s.input, transcript_path: join(s.dir, 'not-written-yet.jsonl') } });
  for (const attended of ['0', '', undefined]) await silent(s, { ...s.opts, env: { ...s.env, CLAUDE_CODE_SESSION_ATTENDED: attended } });
  await silent(s, { ...s.opts, env: { ...s.env, THINWINDOW: 'off' } });
  for (const config of [{ setupNotice: false }, { enabled: false }]) {
    const off = session();
    writeFileSync(join(off.dir, '.thinwindow.json'), JSON.stringify(config));
    await silent(off);
  }
});

test('the threshold is configurable, and a setup without known parts gets the total only', async () => {
  const s = session([req('m1', 25000)]);
  assert.equal(await handleSetupNotice(s.input, s.opts), null);
  writeFileSync(join(s.dir, '.thinwindow.json'), JSON.stringify({ setupNoticeMinTokens: 20000 }));
  assert.equal((await handleSetupNotice(s.input, s.opts)).systemMessage, 'ThinWindow: each request in this session starts at 25k tokens. Run /context to see what you could turn off.');
});

test('the notice and /thinwindow:report agree on the parts', async () => {
  const root = tempDir('thinwindow-report-');
  mkdirSync(join(root, 'p'));
  writeFileSync(join(root, 'p', 'a.jsonl'), jsonl(RECORDS));
  const { firstRequest } = await buildReport({ root, stateBase: tempDir() });
  assert.equal(firstRequest.median, 54000);
  const fromReport = `skill listing ${(firstRequest.parts.skillListing / 1000).toFixed(1)}k, deferred tools ${(firstRequest.parts.deferredTools / 1000).toFixed(1)}k, MCP instructions ${(firstRequest.parts.mcpInstructions / 1000).toFixed(1)}k`;
  assert.ok(LINE.includes(`(${fromReport})`), fromReport);
});

test('the Stop script prints the notice, keeps the brief apart, fails open, never logs the reply', () => {
  const s = session();
  const run = (input, env = {}) =>
    spawnSync(process.execPath, [STOP], {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      encoding: 'utf8',
      env: { ...process.env, HOME: s.opts.home, USERPROFILE: s.opts.home, TMPDIR: s.opts.stateBase, TEMP: s.opts.stateBase, TMP: s.opts.stateBase, THINWINDOW: '', THINWINDOW_DEBUG: '1', ...s.env, ...env },
    });
  // The brief fails (its data dir is a file); the notice still shows.
  const notDir = join(s.dir, 'data-is-a-file');
  writeFileSync(notDir, '');
  let r = run(s.input, { CLAUDE_PLUGIN_DATA: notDir });
  assert.equal(r.status, 0);
  assert.deepEqual(JSON.parse(r.stdout), { systemMessage: LINE });
  assert.match(r.stderr, /Stop: brief error: Error/);
  assert.match(r.stderr, /Stop: setup notice, 54\.0k tokens/);
  r = run(s.input);
  assert.equal(r.stdout, '', 'once a week');
  // With briefs on, both run.
  const t = session(RECORDS, { id: 's3' });
  const data = tempDir('thinwindow-data-');
  r = spawnSync(process.execPath, [STOP], { input: JSON.stringify(t.input), encoding: 'utf8', env: { ...process.env, HOME: t.opts.home, TMPDIR: t.opts.stateBase, THINWINDOW: '', THINWINDOW_DEBUG: '', ...t.env, CLAUDE_PLUGIN_DATA: data } });
  assert.equal(JSON.parse(r.stdout).systemMessage, LINE);
  assert.ok(readFileSync(join(data, 'briefs', readdirSync(join(data, 'briefs'))[0], 's3.json'), 'utf8').includes('Fix the pager.'));
  for (const input of ['', 'not json', '[]', '{}', JSON.stringify({ ...s.input, transcript_path: 42 })]) {
    r = run(input, { CLAUDE_PROJECT_DIR: tempDir() });
    assert.equal(r.status, 0, input);
    assert.equal(r.stdout, '', input);
  }
  r = run(`{"session_id":"s1","last_assistant_message":"${SECRET}`);
  assert.match(r.stderr, /Stop: error, allowing: SyntaxError/);
  assert.ok(!r.stderr.includes(SECRET), r.stderr);
});
