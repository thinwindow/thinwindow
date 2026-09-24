// End-to-end tests of the hook scripts as Claude Code runs them: JSON on
// stdin, JSON (or nothing) on stdout, always exit 0.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeProject, tempDir } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PRE = join(ROOT, 'hooks', 'pre-tool-use.mjs');
const START = join(ROOT, 'hooks', 'session-start.mjs');
const RULES = readFileSync(join(ROOT, 'rules', 'thinwindow.md'), 'utf8').trim();
const proj = makeProject();

function runHook(script, input, env = {}) {
  const tmp = tempDir('thinwindow-tmp-');
  const res = spawnSync(process.execPath, [script], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      HOME: proj.home,
      USERPROFILE: proj.home,
      TMPDIR: tmp,
      TEMP: tmp,
      TMP: tmp,
      CLAUDE_PROJECT_DIR: proj.root,
      THINWINDOW: '',
      THINWINDOW_DEBUG: '',
      ...env,
    },
  });
  return { ...res, json: res.stdout ? JSON.parse(res.stdout) : null };
}

const readInput = (file_path, session_id = 'e2e') => ({
  session_id,
  cwd: proj.root,
  hook_event_name: 'PreToolUse',
  tool_name: 'Read',
  tool_input: { file_path },
  tool_use_id: 'toolu_1',
});

test('SessionStart injects the rules as additionalContext', () => {
  const r = runHook(START, { session_id: 'e2e', hook_event_name: 'SessionStart', source: 'startup', cwd: proj.root });
  assert.equal(r.status, 0);
  assert.deepEqual(r.json, { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: RULES } });
});

test('SessionStart on compact resets read tracking', () => {
  const tmp = tempDir('thinwindow-tmp-');
  const env = { TMPDIR: tmp, TEMP: tmp, TMP: tmp };
  const small = join(proj.root, 'src', 'small.ts');
  assert.equal(runHook(PRE, readInput(small, 'compact-1'), env).stdout, '');
  assert.equal(runHook(PRE, readInput(small, 'compact-1'), env).json.hookSpecificOutput.permissionDecision, 'deny');
  const start = runHook(START, { session_id: 'compact-1', hook_event_name: 'SessionStart', source: 'compact' }, env);
  assert.equal(start.json.hookSpecificOutput.additionalContext, RULES);
  assert.equal(runHook(PRE, readInput(small, 'compact-1'), env).stdout, '');
});

test('PreToolUse denies with the documented JSON shape', () => {
  const r = runHook(PRE, { session_id: 'deny', cwd: proj.root, tool_name: 'Bash', tool_input: { command: 'git log' } });
  assert.equal(r.status, 0);
  const out = r.json.hookSpecificOutput;
  assert.equal(out.hookEventName, 'PreToolUse');
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /git log/);
  assert.deepEqual(Object.keys(r.json), ['hookSpecificOutput']);
});

test('PreToolUse turns a large whole-file Read into its head, with no permission decision', () => {
  const r = runHook(PRE, readInput(join(proj.root, 'big.txt'), 'head'));
  const out = r.json.hookSpecificOutput;
  assert.equal(out.permissionDecision, undefined);
  assert.equal(out.updatedInput.limit, 120);
  assert.equal(out.updatedInput.file_path, join(proj.root, 'big.txt'));
  assert.match(out.additionalContext, /has 900 lines, so this Read returned lines 1-120/);
});

test('PreToolUse caps a content Grep with no head_limit', () => {
  const input = { session_id: 'g', cwd: proj.root, tool_name: 'Grep', tool_input: { pattern: 'x', output_mode: 'content' } };
  const out = runHook(PRE, input).json.hookSpecificOutput;
  assert.deepEqual(out.updatedInput, { pattern: 'x', output_mode: 'content', head_limit: 100 });
  const files = runHook(PRE, { ...input, tool_input: { pattern: 'x' } });
  assert.equal(files.stdout, '');
});

test('PreToolUse prints nothing when it has no objection', () => {
  const r = runHook(PRE, readInput(join(proj.root, 'src', 'small.ts'), 'quiet'));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('PreToolUse ignores other tools', () => {
  const r = runHook(PRE, { session_id: 'x', tool_name: 'Edit', tool_input: { file_path: join(proj.root, 'big.txt') } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('rewrite mode returns updatedInput without a permission decision', () => {
  const dir = tempDir('thinwindow-rw-');
  writeFileSync(join(dir, '.thinwindow.json'), JSON.stringify({ rewrite: true }));
  const r = runHook(
    PRE,
    { session_id: 'rw', cwd: dir, tool_name: 'Bash', tool_input: { command: 'npm test', description: 'Run tests' } },
    { CLAUDE_PROJECT_DIR: dir },
  );
  const out = r.json.hookSpecificOutput;
  assert.deepEqual(out.updatedInput, { command: 'thinwindow-run npm test', description: 'Run tests' });
  assert.equal(out.permissionDecision, undefined);
  assert.match(out.additionalContext, /thinwindow-run/);
});

test('PreToolUse counts what thinwindow did per session', () => {
  const tmp = tempDir('thinwindow-stats-');
  const call = (command) =>
    spawnSync(process.execPath, [PRE], {
      input: JSON.stringify({ session_id: 'stats', cwd: proj.root, tool_name: 'Bash', tool_input: { command } }),
      env: { ...process.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, CLAUDE_PROJECT_DIR: proj.root },
      encoding: 'utf8',
    });
  call('npm test');
  call('git log');
  call('ls');
  const state = JSON.parse(readFileSync(join(tmp, 'thinwindow', 'state', 'stats.json'), 'utf8'));
  assert.deepEqual(state.stats, { 'Bash.rewrite': 1, 'Bash.deny': 1 });
});

test('fails open: bad input, missing fields and odd tool input exit 0 silently', () => {
  for (const input of ['', 'not json', '[]', '{}', JSON.stringify({ tool_name: 'Read' }), JSON.stringify({ tool_name: 'Bash', tool_input: { command: 42 } })]) {
    for (const script of [PRE, START]) {
      const r = runHook(script, input);
      assert.equal(r.status, 0, `${script} ${input}`);
      if (script === PRE) assert.equal(r.stdout, '', input);
    }
  }
});

test('THINWINDOW=off disables both hooks', () => {
  const env = { THINWINDOW: 'off' };
  assert.equal(runHook(PRE, readInput(join(proj.root, 'big.txt')), env).stdout, '');
  assert.equal(runHook(START, { session_id: 'off', source: 'startup' }, env).stdout, '');
});

test('"enabled": false in .thinwindow.json disables both hooks', () => {
  const dir = tempDir('thinwindow-off-');
  writeFileSync(join(dir, '.thinwindow.json'), JSON.stringify({ enabled: false }));
  const env = { CLAUDE_PROJECT_DIR: dir };
  assert.equal(runHook(PRE, readInput(join(proj.root, 'big.txt')), env).stdout, '');
  assert.equal(runHook(START, { session_id: 'off', source: 'startup' }, env).stdout, '');
});

test('THINWINDOW_DEBUG=1 logs decisions to stderr only', () => {
  const r = runHook(PRE, readInput(join(proj.root, 'big.txt'), 'dbg'), { THINWINDOW_DEBUG: '1' });
  assert.match(r.stderr, /\[thinwindow\] Read rewrite \(large-file\)/);
  assert.equal(r.json.hookSpecificOutput.updatedInput.limit, 120);
});

test('hooks.json points at the scripts under test', () => {
  const hooks = JSON.parse(readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')).hooks;
  assert.deepEqual(hooks.SessionStart[0].hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/hooks/session-start.mjs']);
  assert.equal(hooks.SessionStart[0].matcher, 'startup|resume|clear|compact|fork');
  assert.deepEqual(hooks.PreToolUse[0].hooks[0].args, ['${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.mjs']);
  assert.equal(hooks.PreToolUse[0].matcher, 'Read|Bash|Grep');
});
