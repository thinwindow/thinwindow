import assert from 'node:assert/strict';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { loadConfig } from '../hooks/lib/config.mjs';
import { checkRead } from '../hooks/lib/read-guard.mjs';
import { RETRY_WINDOW_MS, updateState } from '../hooks/lib/state.mjs';
import { lines, makeProject } from './helpers.mjs';

const proj = makeProject();
const config = loadConfig({ projectDir: proj.root, home: proj.home, env: {} });
const fresh = () => ({ v: 1, agents: {}, denied: [] });

function read(state, tool_input, { agent_id, now, cfg = config } = {}) {
  return checkRead({
    input: { session_id: 's', tool_name: 'Read', tool_input, ...(agent_id ? { agent_id } : {}) },
    config: cfg,
    state,
    projectDir: proj.root,
    now,
  });
}

const big = join(proj.root, 'big.txt');
const small = join(proj.root, 'src', 'small.ts');

test('denies a whole-file read of a file over maxReadLines', () => {
  const r = read(fresh(), { file_path: big });
  assert.equal(r.action, 'deny');
  assert.equal(r.kind, 'large-file');
  assert.match(r.reason, /big\.txt has 900 lines, over the 400-line limit/);
  assert.match(r.reason, /repeat this exact Read call/);
});

test('allows ranged reads of a large file', () => {
  assert.equal(read(fresh(), { file_path: big, offset: 100, limit: 50 }).action, 'allow');
  assert.equal(read(fresh(), { file_path: big, limit: 50 }).action, 'allow');
  assert.equal(read(fresh(), { file_path: big, offset: 850 }).action, 'allow');
});

test('maxReadLines is configurable', () => {
  const cfg = { ...config, maxReadLines: 1000 };
  assert.equal(read(fresh(), { file_path: big }, { cfg }).action, 'allow');
});

test('soft block: an identical retry goes through', () => {
  const state = fresh();
  assert.equal(read(state, { file_path: big }).action, 'deny');
  const retry = read(state, { file_path: big });
  assert.equal(retry.action, 'allow');
  assert.equal(retry.kind, 'retry');
});

test('the retry window expires', () => {
  const session = `window-${Date.now()}`;
  const t0 = 1_000_000;
  const at = (now) => updateState(session, (s) => read(s, { file_path: big }, { now }), { base: proj.stateBase, now });
  assert.equal(at(t0).action, 'deny');
  assert.equal(at(t0 + RETRY_WINDOW_MS + 1).action, 'deny');
  assert.equal(at(t0 + RETRY_WINDOW_MS + 2).action, 'allow');
});

test('re-read guard: same file and range, unchanged, is denied', () => {
  const state = fresh();
  assert.equal(read(state, { file_path: small }).action, 'allow');
  const again = read(state, { file_path: small });
  assert.equal(again.action, 'deny');
  assert.equal(again.kind, 'reread');
  assert.match(again.reason, /already in your context/);
  // ...and the soft block lets an identical retry through.
  assert.equal(read(state, { file_path: small }).action, 'allow');
});

test('re-read guard: a different range is a different read', () => {
  const state = fresh();
  assert.equal(read(state, { file_path: big, offset: 1, limit: 50 }).action, 'allow');
  assert.equal(read(state, { file_path: big, offset: 51, limit: 50 }).action, 'allow');
  assert.equal(read(state, { file_path: big, offset: 1, limit: 50 }).action, 'deny');
});

test('re-read guard: a changed file can be read again', () => {
  const state = fresh();
  const f = join(proj.root, 'src', 'changing.ts');
  writeFileSync(f, lines(5));
  assert.equal(read(state, { file_path: f }).action, 'allow');
  appendFileSync(f, 'one more line\n');
  assert.equal(read(state, { file_path: f }).action, 'allow');
});

test('re-read guard is per agent: a subagent has its own context', () => {
  const state = fresh();
  assert.equal(read(state, { file_path: small }).action, 'allow');
  assert.equal(read(state, { file_path: small }, { agent_id: 'agent-1' }).action, 'allow');
  assert.equal(read(state, { file_path: small }, { agent_id: 'agent-1' }).action, 'deny');
});

test('skips missing files, images, PDFs, notebooks and binaries', () => {
  const state = fresh();
  assert.equal(read(state, { file_path: join(proj.root, 'nope.txt') }).kind, 'missing');
  assert.equal(read(state, { file_path: join(proj.root, 'image.png') }).kind, 'special-file');
  assert.equal(read(state, { file_path: join(proj.root, 'doc.pdf') }).kind, 'special-file');
  assert.equal(read(state, { file_path: join(proj.root, 'blob.dat') }).kind, 'binary');
  assert.equal(read(state, { file_path: proj.root }).kind, 'missing');
});

test('allowlist.paths exempts files from both guards', () => {
  const cfg = loadConfig({ projectDir: proj.root, home: proj.home, env: {} });
  cfg.allowPathPatterns = [/^big\.txt$/];
  const state = fresh();
  assert.equal(read(state, { file_path: big }, { cfg }).kind, 'allowlist');
  assert.equal(read(state, { file_path: big }, { cfg }).kind, 'allowlist');
});

test('updateState persists reads across hook processes', () => {
  const session = `persist-${Date.now()}`;
  const opts = { base: proj.stateBase };
  const first = updateState(session, (state) => read(state, { file_path: small }), opts);
  const second = updateState(session, (state) => read(state, { file_path: small }), opts);
  assert.equal(first.action, 'allow');
  assert.equal(second.action, 'deny');
});
