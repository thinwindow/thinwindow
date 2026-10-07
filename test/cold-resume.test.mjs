// Cold-resume notice (#34): the transcript sensor, the UserPromptSubmit hook
// and its message, against fixture transcripts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { briefsDir } from '../hooks/lib/brief.mjs';
import { handleUserPromptSubmit, IDLE_MS } from '../hooks/lib/cold-resume.mjs';
import { firstRequest, lastRequest, readSlice } from '../hooks/lib/usage.mjs';
import { COLD_GAP_MS, PRICES } from '../skills/thinwindow/scripts/thinwindow-report.mjs';
import { tempDir } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const HOOK = join(ROOT, 'hooks', 'user-prompt-submit.mjs');
const SECRET = 'PROMPT-SECRET-5c1d';
const MIN = 60_000;
const NOW = Date.now();

const at = (minAgo) => new Date(NOW - minAgo * MIN).toISOString();
// A request `minAgo` minutes before NOW whose context is `context` tokens.
const req = (minAgo, context, { model = 'claude-opus-5-5', side = false } = {}) => ({
  type: 'assistant',
  timestamp: at(minAgo),
  ...(side && { isSidechain: true }),
  message: { id: `msg_${minAgo}`, model, usage: { input_tokens: 5, cache_read_input_tokens: context - 1005, cache_creation_input_tokens: 1000, output_tokens: 40 } },
});
const jsonl = (records) => records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n';

// A session: a 52k-token setup, a 380k-token last request three hours ago,
// then records that aren't requests, as a real transcript's tail has.
function session(records = [{ type: 'user', message: { content: 'Fix the pager.' } }, req(400, 52000), req(181, 380000), { type: 'last-prompt' }, { type: 'queue-operation' }]) {
  const dir = tempDir('thinwindow-cold-');
  const transcript = join(dir, 's1.jsonl');
  writeFileSync(transcript, jsonl(records));
  const input = { session_id: 's1', transcript_path: transcript, cwd: dir, hook_event_name: 'UserPromptSubmit', prompt: 'Go on.' };
  const env = { CLAUDE_CODE_SESSION_ATTENDED: '1', CLAUDE_PROJECT_DIR: dir, CLAUDE_PLUGIN_DATA: '' };
  return { dir, transcript, input, env, opts: { env, home: tempDir('thinwindow-home-'), stateBase: tempDir('thinwindow-state-'), now: NOW } };
}

const stats = (s) => JSON.parse(readFileSync(join(s.opts.stateBase, 'thinwindow', 'state', 's1.json'), 'utf8')).stats;

test('the sensor finds the last and first requests, skipping what never reached the API', () => {
  const text = jsonl([
    { type: 'user', message: { content: 'hi' } },
    { type: 'attachment', attachment: { type: 'skill_listing' } },
    req(400, 52000),
    req(181, 380000, { model: 'claude-sonnet-5-5' }),
    req(10, 9000, { side: true }),
    // A local API-error record: zero usage, not a Claude model.
    { type: 'assistant', timestamp: at(5), message: { model: '<synthetic>', usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    { type: 'last-prompt', usage: 1 },
    '{"type":"assistant","usage":',
  ]);
  assert.deepEqual(lastRequest(text), { at: Date.parse(at(181)), context: 380000, model: 'claude-sonnet-5-5' });
  assert.equal(firstRequest(text).context, 52000);
  assert.equal(lastRequest(jsonl([{ type: 'user', message: { content: 'x' } }])), null);
});

test('the sensor reads bounded slices and never a cut line', () => {
  const dir = tempDir('thinwindow-slice-');
  const file = join(dir, 't.jsonl');
  const huge = { type: 'user', message: { content: 'x'.repeat(500) } };
  writeFileSync(file, jsonl([req(90, 70000), huge, req(80, 75000)]));
  assert.equal(lastRequest(readSlice(file, { bytes: 400 })).context, 75000);
  assert.equal(firstRequest(readSlice(file, { fromEnd: false, bytes: 400 })).context, 70000);
  // The slice falls inside one long line: nothing, rather than a fragment.
  writeFileSync(file, jsonl([req(90, 70000), huge]));
  assert.equal(readSlice(file, { bytes: 400 }), '');
  writeFileSync(file, jsonl([huge, req(90, 70000)]));
  assert.equal(readSlice(file, { fromEnd: false, bytes: 400 }), '');
  assert.ok(readSlice(file).endsWith('\n'), 'a file smaller than the slice is read whole');
  assert.equal(readSlice(join(dir, 'not-written-yet.jsonl')), '', "a new session's transcript");
});

test('holds the first prompt after an hour idle, with what each choice re-writes', async () => {
  const s = session();
  const out = await handleUserPromptSubmit(s.input, s.opts);
  assert.deepEqual(out, {
    decision: 'block',
    reason: [
      'ThinWindow held this message: this session has been idle 3 h, so its prompt cache has expired.',
      'Continuing re-writes ~380k tokens (~US$3.04 at Opus 5.5 list price): send it again.',
      'A new session re-writes ~52k tokens (~US$0.42): /clear, then send your request.',
    ].join('\n'),
  });
  assert.equal(PRICES['claude-opus-5-5'].cacheWrite, 8, 'the figures above are 380k and 52k at US$8 per million');
  assert.doesNotMatch(out.reason, /sav/i);
  assert.deepEqual(stats(s), { 'ColdResume.notice': 1 });
});

test('once per idle gap: any later prompt goes through until a request runs', async () => {
  const s = session();
  assert.equal((await handleUserPromptSubmit(s.input, s.opts)).decision, 'block');
  // Sent again half an hour later, past the soft block's ten-minute window.
  assert.equal(await handleUserPromptSubmit({ ...s.input, prompt: 'Something else.' }, { ...s.opts, now: NOW + 30 * MIN }), null);
  assert.deepEqual(stats(s), { 'ColdResume.notice': 1, 'ColdResume.continue': 1 });
  // That prompt ran; the session then sits idle for two hours again.
  writeFileSync(s.transcript, readFileSync(s.transcript, 'utf8') + jsonl([req(-30, 395000)]));
  assert.equal((await handleUserPromptSubmit(s.input, { ...s.opts, now: NOW + 150 * MIN })).decision, 'block');
  assert.equal(stats(s)['ColdResume.notice'], 2);
});

test('offers /thinwindow:resume only when the newest brief in the project is this session\'s', async () => {
  const s = session();
  const data = tempDir('thinwindow-data-');
  const dir = briefsDir(data, s.dir);
  mkdirSync(dir, { recursive: true });
  const brief = (id, minAgo) => {
    writeFileSync(join(dir, `${id}.json`), '{}');
    utimesSync(join(dir, `${id}.json`), new Date(NOW - minAgo * MIN), new Date(NOW - minAgo * MIN));
  };
  brief('s1', 181);
  const opts = { ...s.opts, env: { ...s.env, CLAUDE_PLUGIN_DATA: data } };
  const line = async (o) => (await handleUserPromptSubmit(s.input, o)).reason.split('\n')[2];
  assert.equal(await line(opts), 'A fresh start from a short brief re-writes ~52k tokens (~US$0.42): /clear, then /thinwindow:resume <your request>.');
  // Another session in this project wrote a brief since: resume would load that one.
  brief('s2', 30);
  assert.match(await line({ ...opts, stateBase: tempDir() }), /^A new session re-writes/);
  // Briefs turned off.
  brief('s2', 500);
  writeFileSync(join(s.dir, '.thinwindow.json'), JSON.stringify({ briefs: false }));
  assert.match(await line({ ...opts, stateBase: tempDir() }), /^A new session re-writes/);
});

test('stays out of the way: a short gap, a small context, commands, unattended sessions, off switches', async () => {
  const silent = async (s, input = s.input, opts = s.opts) => {
    assert.equal(await handleUserPromptSubmit(input, opts), null, JSON.stringify(input.prompt));
    assert.equal(existsSync(join(opts.stateBase, 'thinwindow')), false, 'no state written');
  };
  await silent(session([req(400, 52000), req(59, 380000)]));
  await silent(session([req(400, 52000), req(181, 99999)]));
  await silent(session([{ type: 'user', message: { content: 'x' } }, { type: 'last-prompt' }]));
  const s = session();
  for (const prompt of ['/clear', '  /thinwindow:resume go on', '/compact', '<task-notification>\n<status>completed</status>', '', undefined]) {
    await silent(s, { ...s.input, prompt });
  }
  for (const attended of ['0', '', undefined]) await silent(s, s.input, { ...s.opts, env: { ...s.env, CLAUDE_CODE_SESSION_ATTENDED: attended } });
  await silent(s, s.input, { ...s.opts, env: { ...s.env, THINWINDOW: 'off' } });
  for (const config of [{ coldResumeNotice: false }, { enabled: false }]) {
    const off = session();
    writeFileSync(join(off.dir, '.thinwindow.json'), JSON.stringify(config));
    await silent(off);
  }
  // A pasted prompt was sent by a person.
  assert.equal((await handleUserPromptSubmit({ ...s.input, prompt: '<pasted_content id="1">\nlog\n</pasted_content id="1">' }, s.opts)).decision, 'block');
});

test('the context threshold is configurable', async () => {
  const s = session([req(400, 52000), req(181, 60000)]);
  assert.equal(await handleUserPromptSubmit(s.input, s.opts), null);
  writeFileSync(join(s.dir, '.thinwindow.json'), JSON.stringify({ coldResumeMinTokens: 50000 }));
  assert.match((await handleUserPromptSubmit(s.input, s.opts)).reason, /re-writes ~60k tokens/);
});

test('a model without a list price gets token counts only, and long gaps read in days', async () => {
  const s = session([req(4000, 30000, { model: 'gateway-model' }), req(3000, 250000, { model: 'gateway-model' })]);
  const { reason } = await handleUserPromptSubmit(s.input, s.opts);
  assert.match(reason, /idle 2 days,/);
  assert.match(reason, /\nContinuing re-writes ~250k tokens: send it again\.\n/);
  assert.doesNotMatch(reason, /US\$/);
});

test('the hook script prints the decision, fails open, and never logs the prompt', () => {
  const s = session();
  const run = (input, env = {}) =>
    spawnSync(process.execPath, [HOOK], {
      input: typeof input === 'string' ? input : JSON.stringify(input),
      encoding: 'utf8',
      env: { ...process.env, HOME: s.opts.home, USERPROFILE: s.opts.home, TMPDIR: s.opts.stateBase, TEMP: s.opts.stateBase, TMP: s.opts.stateBase, THINWINDOW: '', THINWINDOW_DEBUG: '1', ...s.env, ...env },
    });
  let r = run({ ...s.input, prompt: SECRET });
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.stdout).decision, 'block');
  assert.match(r.stderr, /cold-resume notice, 380k tokens/);
  r = run({ ...s.input, prompt: SECRET });
  assert.equal(r.stdout, '', 'sent again: through');
  for (const input of ['', 'not json', '[]', '{}', JSON.stringify({ ...s.input, transcript_path: join(s.dir, 'missing.jsonl') }), JSON.stringify({ ...s.input, transcript_path: 42 })]) {
    r = run(input);
    assert.equal(r.status, 0, input);
    assert.equal(r.stdout, '', input);
  }
  r = run({ ...s.input, transcript_path: join(s.dir, 'missing.jsonl') });
  assert.equal(r.stderr, '', 'a new session without a transcript yet is not an error');
  r = run(`{"session_id":"s1","prompt":"${SECRET}`);
  assert.match(r.stderr, /UserPromptSubmit: error, allowing: SyntaxError/);
  for (const out of [r.stderr, run({ ...s.input, session_id: 's9', prompt: SECRET }).stderr]) assert.ok(!out.includes(SECRET), out);
});

test('the idle limit is the report\'s cold gap', () => {
  assert.equal(IDLE_MS, COLD_GAP_MS);
});
