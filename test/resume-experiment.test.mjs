import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BRIEF_MAX_CHARS, buildBrief, coldPenaltyUsd, costed, experimentArgs, outcome, readPaths, requestsFromStream, summarize } from '../bench/experiments/resume.mjs';
import { priceOf } from '../bench/lib/pricing.mjs';

const user = (content, extra = {}) => ({ type: 'user', message: { content }, ...extra });
const assistant = (content, id = 'm') => ({ type: 'assistant', message: { id, content, usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 } } });

test('the brief has the five fields, relative paths, exit codes, and stays under ~300 tokens', () => {
  const records = [
    user('Rename displayWidth to visibleTextWidth everywhere.'),
    { type: 'attachment', attachment: { type: 'skill_listing' } },
    user('<command-name>/clear</command-name>'),
    assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'npm test\necho more' } }]),
    user([{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'Exit code 2\nfailed' }]),
    assistant([{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: '/w/lib/help.js' } }]),
    assistant([{ type: 'tool_use', id: 't3', name: 'Bash', input: { command: 'npm run lint' } }]),
    user([{ type: 'tool_result', tool_use_id: 't3', content: 'ok' }]),
    user('Also update the typings.'),
    assistant([{ type: 'tool_use', id: 't4', name: 'Write', input: { file_path: '/w/typings/index.d.ts' } }]),
    assistant([{ type: 'text', text: `Done. ${'x'.repeat(3000)}` }]),
  ];
  const brief = buildBrief(records, { cwd: '/w' });
  assert.ok(brief.length <= BRIEF_MAX_CHARS, `${brief.length} chars`);
  assert.match(brief, /^Brief of an earlier session/);
  assert.match(brief, /\nGoal: Rename displayWidth to visibleTextWidth everywhere\.\n/);
  assert.match(brief, /\nRecent requests: Also update the typings\.\n/);
  assert.match(brief, /\nFiles edited: lib\/help\.js, typings\/index\.d\.ts\n/);
  assert.match(brief, /\nCommands: `npm test` → exit 2; `npm run lint` → exit 0\n/);
  assert.match(brief, /\nLast message: Done\. x+…$/);
  assert.equal(buildBrief(records, { cwd: '/w' }), brief, 'deterministic');
});

test('an empty session still gives a valid brief', () => {
  const brief = buildBrief([]);
  assert.match(brief, /Goal: unknown\nRecent requests: none\nFiles edited: none\nCommands: none\nLast message: none$/);
});

test('per-request usage comes from the stream, once per message id', () => {
  const stream = [
    JSON.stringify(assistant([{ type: 'text', text: 'a' }], 'm1')),
    JSON.stringify(assistant([{ type: 'tool_use', id: 't', name: 'Read', input: { file_path: '/w/a.js' } }], 'm1')),
    'not json',
    JSON.stringify(assistant([{ type: 'tool_use', id: 'u', name: 'Read', input: { file_path: '/elsewhere/b.js' } }], 'm2')),
  ].join('\n');
  assert.deepEqual(requestsFromStream(stream), [
    { input: 1, cacheRead: 3, cacheWrite: 4, output: 2 },
    { input: 1, cacheRead: 3, cacheWrite: 4, output: 2 },
  ]);
  assert.deepEqual(readPaths(stream, '/w'), ['a.js', '/elsewhere/b.js']);
});

test('the cold penalty re-writes the cached reads at the 1h write price', () => {
  // Sonnet 5.5: write $4/M, read $0.2/M.
  assert.equal(coldPenaltyUsd(1e6, priceOf('claude-sonnet-5-5')), 3.8);
});

test('runs keep their session and can resume a fork', () => {
  const a = experimentArgs({ prompt: 'p', model: 'm' });
  assert.ok(!a.includes('--no-session-persistence'));
  assert.ok(a.includes('--setting-sources') && a.includes('--strict-mcp-config'));
  assert.ok(!a.includes('--plugin-dir'), 'baseline: no ThinWindow');
  const b = experimentArgs({ prompt: 'p', model: 'm', resume: 'id', fork: true });
  assert.deepEqual(b.slice(-3), ['--resume', 'id', '--fork-session']);
});

// A's run cost $1. A resumed session's reported cost includes it; the brief
// and fresh arms' don't. Each B row's own cold cost is `cold`, half of it penalty.
const A = { phase: 'A', chain: 1, rep: 1, costUsd: 1 };
const row = (arm, cold, ok = true) => {
  const own = cold / 2;
  const invocations = arm === 'brief' || arm === 'fresh' ? [{ costUsd: own }] : arm === 'compact' ? [{ costUsd: 1 + own / 2 }, { costUsd: 1 + own }] : [{ costUsd: 1 + own }];
  return { phase: 'B', chain: 1, rep: 1, arm, invocations, bPass: ok, aPass: true, coldPenaltyUsd: cold / 2, numTurns: 3, reReads: [] };
};

test("a resumed session's carried cost is not counted again", () => {
  const [cont, compact, brief, fresh] = costed([A, row('continue', 1), row('compact', 0.8), row('brief', 0.6), row('fresh', 0.6)]);
  const near = (x, y) => assert.ok(Math.abs(x - y) < 1e-9, `${x} vs ${y}`);
  near(cont.warmUsd, 0.5);
  near(compact.warmUsd, 0.4);
  near(brief.warmUsd, 0.3);
  near(fresh.warmUsd, 0.3);
  near(cont.coldUsd, 1);
});

test('G2 follows the criteria written before running', () => {
  const g = (rows) => outcome(summarize([A, ...rows])).verdict;
  assert.equal(g([row('continue', 1), row('compact', 0.9), row('brief', 0.6)]), 'go');
  assert.equal(g([row('continue', 1), row('compact', 0.62), row('brief', 0.6)]), 'compact');
  assert.equal(g([row('continue', 1), row('compact', 0.9), row('brief', 0.95)]), 'stop');
  assert.equal(g([row('continue', 1), row('compact', 0.9), row('brief', 0.5, false)]), 'stop');
  assert.equal(g([row('continue', 1), row('compact', 0.9), row('brief', 0.8)]), 'none');
});
