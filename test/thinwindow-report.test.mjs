import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { PRICES as BENCH_PRICES } from '../bench/lib/pricing.mjs';
import { PRICES, buildReport, defaultRoot, formatJson, formatText } from '../skills/thinwindow/scripts/thinwindow-report.mjs';
import { tempDir } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCRIPT = join(ROOT, 'skills', 'thinwindow', 'scripts', 'thinwindow-report.mjs');
const T0 = Date.parse('2026-09-01T10:00:00Z');
const MIN = 60 * 1000;

// Transcript records in Claude Code's format, with only the fields the report reads.
function req(id, at, { read = 0, write = 0, input = 10, out = 100, model = 'claude-opus-5-5', side = false, tools = [] } = {}) {
  return {
    type: 'assistant',
    isSidechain: side,
    timestamp: new Date(at).toISOString(),
    version: '2.1.289',
    message: {
      id,
      model,
      content: tools.map(([toolId, name]) => ({ type: 'tool_use', id: toolId, name, input: {} })),
      usage: { input_tokens: input, output_tokens: out, cache_read_input_tokens: read, cache_creation_input_tokens: write },
    },
  };
}
const result = (toolId, content) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: toolId, content }] } });
const compact = () => ({ type: 'system', subtype: 'compact_boundary' });

function corpus(sessions) {
  const root = tempDir('thinwindow-report-');
  for (const [file, records] of Object.entries(sessions)) {
    const path = join(root, 'projects', file);
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, records.map((r) => (typeof r === 'string' ? r : JSON.stringify(r))).join('\n') + '\n');
  }
  return { root: join(root, 'projects'), stateBase: join(root, 'tmp') };
}

test('a request after more than 60 idle minutes that writes over 20k is a cold re-write', async () => {
  const r = await buildReport(
    corpus({
      'p/a.jsonl': [
        req('m1', T0, { write: 50000 }),
        req('m2', T0 + 5 * MIN, { read: 50000, write: 1000 }),
        req('m3', T0 + 125 * MIN, { write: 300000 }), // cold
        req('m4', T0 + 130 * MIN, { read: 300000 }),
        req('m5', T0 + 300 * MIN, { read: 290000, write: 10000 }), // idle, but the cache write is small
      ],
    }),
  );
  assert.equal(r.coldRewrites.count, 1);
  assert.equal(r.coldRewrites.sessions, 1);
  assert.equal(r.coldRewrites.medianContext, 300010);
  // 300k written at Opus 5.5's $8/M, out of every request's cost at its own price.
  // Every request: 10 input at $4/M and 100 output at $20/M, plus its cache reads ($0.2/M) and writes ($8/M).
  const fixed = 10 * 4 + 100 * 20;
  const total = (5 * fixed + 50000 * 8 + (50000 * 0.2 + 1000 * 8) + 300000 * 8 + 300000 * 0.2 + (290000 * 0.2 + 10000 * 8)) / 1e6;
  assert.ok(Math.abs(r._usd.total - total) < 1e-9, `${r._usd.total} vs ${total}`);
  assert.equal(r._usd.cold, 2.4);
  assert.equal(r.coldRewrites.shareOfCost, Number((2.4 / total).toFixed(3)));
  assert.equal(r.coldRewrites.shareOfCacheWrites, Number((300000 / 361000).toFixed(3)));
});

test('each request is priced at its own model, and a local error record does not reset the idle clock', async () => {
  const r = await buildReport(
    corpus({
      'p/a.jsonl': [
        req('m1', T0, { write: 50000, model: 'claude-sonnet-5-5' }),
        req('m2', T0 + 2 * MIN, { read: 50000, model: 'claude-sonnet-5-5' }),
        req('m3', T0 + 90 * MIN, { input: 0, out: 0, model: '<synthetic>' }), // an API error, written locally
        req('m4', T0 + 91 * MIN, { write: 100000, model: 'claude-sonnet-5-5' }),
      ],
    }),
  );
  assert.equal(r.requests, 3);
  assert.equal(r.coldRewrites.count, 1);
  assert.equal(r._usd.cold, 0.4); // Sonnet 5.5 writes at $4/M
  assert.deepEqual(r.costShareByModel, { sonnet: 1 });
  assert.equal(r.unpricedRequests, 0);
});

test('requests are counted once per message id', async () => {
  const r = await buildReport(corpus({ 'p/a.jsonl': [req('m1', T0, { write: 1000 }), req('m1', T0, { write: 1000 }), req('m2', T0 + MIN), req('m3', T0 + 2 * MIN)] }));
  assert.equal(r.requests, 3);
  assert.equal(r.sessions, 1);
});

test('a tool result is re-sent until the session is compacted; an image counts as ~1.6k tokens', async () => {
  const r = await buildReport(
    corpus({
      'p/a.jsonl': [
        req('m1', T0, { read: 9990, tools: [['t1', 'Read']] }),
        result('t1', 'x'.repeat(4000)), // 1,000 tokens, re-sent with the next 2 requests
        req('m2', T0 + MIN, { read: 9990, tools: [['t2', 'mcp__server__shot']] }),
        req('m3', T0 + 2 * MIN, { read: 9990 }),
        compact(),
        req('m4', T0 + 3 * MIN, { read: 9990, tools: [['t3', 'Bash']] }),
        result('t3', [{ type: 'image', source: { data: 'A'.repeat(90000) } }]), // 1,600 tokens, re-sent once
        req('m5', T0 + 4 * MIN, { read: 9990 }),
      ],
    }),
  );
  const resent = 5 * 10000;
  assert.equal(r.toolOutput.bySource.read, Number(((1000 * 2) / resent).toFixed(3)));
  assert.equal(r.toolOutput.bySource.bash, Number((1600 / resent).toFixed(3)));
  // Bands are in characters, 4 per token: the image counts as 6,400.
  assert.equal(r.toolOutput.bySize.under2k, 0);
  assert.equal(r.toolOutput.bySize.to8k, Number((3600 / resent).toFixed(3)));
});

test('sidechains and sub-agent transcripts are counted apart', async () => {
  const r = await buildReport(
    corpus({
      'p/a.jsonl': [req('m1', T0, { write: 1000 }), req('s1', T0 + MIN, { write: 900000, side: true }), req('m2', T0 + 2 * MIN), req('m3', T0 + 3 * MIN)],
      'p/a/subagents/agent-1.jsonl': [req('s2', T0, { write: 5000 }), req('s3', T0 + 200 * MIN, { write: 500000 })],
    }),
  );
  assert.equal(r.requests, 3);
  assert.equal(r.subagents.requests, 3);
  assert.equal(r.coldRewrites.count, 0);
  assert.ok(r.contextPerRequest.mean < 1000);
});

test('the setup line comes from attachments before the first request', async () => {
  const listing = { type: 'attachment', attachment: { type: 'skill_listing', content: 'y'.repeat(3960) } };
  const later = { type: 'attachment', attachment: { type: 'skill_listing', content: 'y'.repeat(40000) } };
  const r = await buildReport(corpus({ 'p/a.jsonl': [listing, req('m1', T0, { write: 20000 }), later, req('m2', T0 + MIN), req('m3', T0 + 2 * MIN)] }));
  assert.equal(r.firstRequest.median, 20010);
  assert.equal(r.firstRequest.parts.skillListing, Math.round(JSON.stringify(listing.attachment).length / 4));
});

test('an unknown format prints "not recognized", never numbers', async () => {
  const changed = { type: 'assistant', timestamp: new Date(T0).toISOString(), version: '3.0.1', message: { id: 'm1', usage: { tokens: { in: 5 } } } };
  const r = await buildReport(corpus({ 'p/a.jsonl': [changed, { ...changed, message: { ...changed.message, id: 'm2' } }] }));
  assert.equal(r.error, 'format-not-recognized');
  assert.equal(r.requests, undefined);
  const text = formatText(r);
  assert.match(text, /format not recognized/);
  assert.match(text, /Claude Code up to 3\.0\.1/);
  assert.doesNotMatch(text, /US\$|tokens \(median\)/);

  const moved = { type: 'assistant', timestamp: new Date(T0).toISOString(), message: { id: 'm1', content: [] } };
  assert.equal((await buildReport(corpus({ 'p/a.jsonl': [moved] }))).error, 'format-not-recognized');
});

test('a few unreadable lines are skipped and counted, not fatal', async () => {
  const records = [req('m1', T0), '{not json', req('m2', T0 + MIN), req('m3', T0 + 2 * MIN)];
  const r = await buildReport(corpus({ 'p/a.jsonl': records }));
  assert.equal(r.error, undefined);
  assert.equal(r.skippedLines, 1);
});

test('no transcripts: says so', async () => {
  const r = await buildReport({ root: join(tempDir(), 'missing'), stateBase: tempDir() });
  assert.equal(r.error, 'no-sessions');
  assert.match(formatText(r), /no Claude Code sessions/);
});

test('sessions from a Claude Code newer than the checked one get a note', async () => {
  const rec = (id, at) => ({ ...req(id, at), version: '2.9.0' });
  const r = await buildReport(corpus({ 'p/a.jsonl': [rec('m1', T0), rec('m2', T0 + MIN), rec('m3', T0 + 2 * MIN)] }));
  assert.equal(r.checkedVersion, false);
  assert.match(formatText(r), /Checked against Claude Code up to 2\.1/);
});

test("ThinWindow's own counts come from its state files, known keys only", async () => {
  const c = corpus({ 'p/a.jsonl': [req('m1', T0), req('m2', T0 + MIN), req('m3', T0 + 2 * MIN)] });
  mkdirSync(join(c.stateBase, 'thinwindow', 'state'), { recursive: true });
  writeFileSync(join(c.stateBase, 'thinwindow', 'state', 's1.json'), JSON.stringify({ v: 1, agents: {}, denied: [], stats: { 'Bash.rewrite': 3, 'Read.deny': 1, 'Other.secret': 9 } }));
  writeFileSync(join(c.stateBase, 'thinwindow', 'state', 's2.json'), JSON.stringify({ v: 1, agents: {}, denied: [], stats: { 'ColdResume.notice': 5, 'ColdResume.continue': 2 } }));
  const r = await buildReport(c);
  assert.deepEqual(r.thinwindowLast7Days, { sessions: 2, actions: { 'Bash.rewrite': 3, 'Read.deny': 1, 'ColdResume.notice': 5, 'ColdResume.continue': 2 } });
  // Distinct counts: the order doesn't depend on how the directory lists files.
  assert.match(formatText(r), /cold-resume notices 5, commands rewritten 3, sent again after a notice 2, reads cut or refused 1/);
});

test('no output string comes from transcript content', async () => {
  // Every string a transcript could carry is a canary: content, paths, project
  // and session names, tool, model and MCP server names, attachment fields.
  const C = 'CANARY';
  const records = [
    { type: 'attachment', cwd: `/home/${C}`, sessionId: `${C}-sid`, attachment: { type: 'skill_listing', content: C, names: [C] } },
    { type: 'attachment', attachment: { type: `${C}_type`, content: C } },
    { type: 'user', cwd: `/home/${C}`, gitBranch: C, message: { content: `${C} prompt` } },
    { ...req(`${C}-1`, T0, { write: 60000, tools: [['t1', `mcp__${C}__tool`], ['t2', `${C}Tool`]] }), cwd: `/home/${C}`, slug: C, version: `2.1.5-${C}` },
    result('t1', [{ type: 'text', text: `${C} output /Users/${C}/secret.txt` }]),
    result('t2', `${C} ${C}`),
    { type: 'system', subtype: `${C}_compact`, content: C },
    { type: C, summary: C },
    { ...req(`${C}-2`, T0 + 120 * MIN, { write: 80000, model: `claude-${C}-9` }), requestId: C },
    req(`${C}-3`, T0 + 121 * MIN, { read: 80000, model: `${C}-model[1m]` }),
    { ...req(`${C}-4`, T0 + 122 * MIN, { side: true }), agentId: C },
  ];
  const c = corpus({ [`-Users-${C}-project/${C}-session.jsonl`]: records, [`${C}/sub/subagents/${C}.jsonl`]: [req(`${C}-5`, T0)] });
  mkdirSync(join(c.stateBase, 'thinwindow', 'state'), { recursive: true });
  writeFileSync(join(c.stateBase, 'thinwindow', 'state', `${C}.json`), JSON.stringify({ v: 1, stats: { [`${C}.deny`]: 1, 'Bash.rewrite': 1 } }));
  const r = await buildReport(c);
  assert.equal(r.error, undefined);
  assert.equal(r.coldRewrites.count, 1);
  for (const out of [formatText(r), formatJson(r)]) assert.ok(!out.includes(C), out);

  const bad = await buildReport(corpus({ [`${C}/${C}.jsonl`]: [{ type: 'assistant', version: `4.0.0-${C}`, message: { usage: { [C]: 1 } } }] }));
  for (const out of [formatText(bad), formatJson(bad)]) assert.ok(!out.includes(C), out);
});

test('--json leaves out US$ amounts and states the price basis', async () => {
  const r = await buildReport(corpus({ 'p/a.jsonl': [req('m1', T0, { write: 50000 }), req('m2', T0 + 90 * MIN, { write: 60000 }), req('m3', T0 + 91 * MIN)] }));
  const json = JSON.parse(formatJson(r));
  assert.equal(json._usd, undefined);
  assert.doesNotMatch(formatJson(r), /US\$/);
  assert.equal(json.pricing, "each request at its own model's Anthropic API list price (Sep 2026)");
  assert.match(formatText(r), /Prices: each request at its own model's Anthropic API list price/);
  assert.match(formatText(r), /re-written: /);
  assert.doesNotMatch(formatText(r), /sav/i);
});

test('the price table matches bench/lib/pricing.mjs', () => {
  assert.deepEqual(PRICES, BENCH_PRICES);
});

test('reads the transcripts of the Claude Code config in use', () => {
  assert.equal(defaultRoot({}, '/h'), join('/h', '.claude', 'projects'));
  assert.equal(defaultRoot({ CLAUDE_CONFIG_DIR: '/cfg' }, '/h'), join('/cfg', 'projects'));
});

test('CLI: --json and the text report run end to end; unknown flags are refused', () => {
  const c = corpus({ 'p/a.jsonl': [req('m1', T0, { write: 50000 }), req('m2', T0 + MIN), req('m3', T0 + 2 * MIN)] });
  const env = { ...process.env, CLAUDE_CONFIG_DIR: join(c.root, '..'), TMPDIR: c.stateBase, TEMP: c.stateBase, TMP: c.stateBase };
  const text = spawnSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' });
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /^ThinWindow report: 1 sessions, 3 requests/);
  const json = spawnSync(process.execPath, [SCRIPT, '--json'], { env, encoding: 'utf8' });
  assert.equal(JSON.parse(json.stdout).requests, 3);
  assert.equal(spawnSync(process.execPath, [SCRIPT, '--dir', '/'], { env, encoding: 'utf8' }).status, 2);
});
