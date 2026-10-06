// The 0.4.0 measurement harness (#37): arguments, environment fingerprint,
// seeded order, aggregation refusal, hierarchical intervals, chains and kept
// transcripts. No network and no real `claude`.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { Budget, experimentArgs, runJob } from '../bench/experiments/resume.mjs';
import { buildClaudeArgs, hostFingerprint, runFingerprint } from '../bench/lib/claude.mjs';
import { ROOT_DIR, RESULTS_DIR } from '../bench/lib/paths.mjs';
import { readResultFile } from '../bench/lib/results.mjs';
import { dedupeRuns, versionDir } from '../bench/lib/results.mjs';
import { bootstrapDelta, costPerCompleted, hierarchicalBootstrap, mulberry32, sumOfMedians } from '../bench/lib/stats.mjs';
import { KEEP_ATTACHMENTS, isPublicRepo, keepTranscript, scrubTranscript, scrubber } from '../bench/lib/transcripts.mjs';
import { UsageError, defaultOut, parseCli, planRuns } from '../bench/run.mjs';
import { chainRuns, envMismatch, markdownReport, since, summarize } from '../bench/report.mjs';
import { tempDir } from './helpers.mjs';

test('parseCli: the harness flags, and the old ones unchanged', () => {
  const o = parseCli(['--condition', 'baseline,thinwindow', '--model', 'm', '--seed', '42', '--tools', 'Bash,Read', '--disallowed-tools', 'Skill', '--agent', 'thinwindow-minimal', '--account', 'acct-a', '--keep-transcripts']);
  assert.equal(o.seed, 42);
  assert.equal(o.tools, 'Bash,Read');
  assert.equal(o.disallowedTools, 'Skill');
  assert.equal(o.agent, 'thinwindow-minimal');
  assert.equal(o.account, 'acct-a');
  assert.equal(o.keepTranscripts, true);
  assert.equal(o.chains, null);
  const plain = parseCli(['--condition', 'baseline', '--model', 'm']);
  assert.ok(Number.isInteger(plain.seed), 'a random seed is drawn and recorded');
  assert.equal(plain.tools, null);
  assert.equal(plain.keepTranscripts, false);
  assert.deepEqual(parseCli(['--condition', 'baseline', '--model', 'm', '--chains', '1,3']).chains, [1, 3]);
  assert.throws(() => parseCli(['--condition', 'baseline', '--model', 'm', '--chains', '4']), UsageError);
  assert.throws(() => parseCli(['--condition', 'baseline', '--model', 'm', '--chains', '1', '--tasks', 'a']), UsageError);
  assert.throws(() => parseCli(['--condition', 'baseline', '--model', 'm', '--seed', '-1']), UsageError);
});

test('buildClaudeArgs: harness settings are the same for both conditions', () => {
  const opts = { prompt: 'p', model: 'm', tools: 'Bash,Read', disallowedTools: 'Skill', agent: 'thinwindow-minimal', persist: true };
  const base = buildClaudeArgs({ ...opts, condition: 'baseline' });
  const skin = buildClaudeArgs({ ...opts, condition: 'thinwindow' });
  assert.deepEqual(skin.slice(0, base.length), base);
  assert.deepEqual(skin.slice(base.length), ['--plugin-dir', ROOT_DIR]);
  assert.ok(!base.includes('--no-session-persistence'), 'persist keeps the session');
  for (const [flag, value] of [['--tools', 'Bash,Read'], ['--disallowedTools', 'Skill'], ['--agent', 'thinwindow-minimal']]) assert.equal(base[base.indexOf(flag) + 1], value);
  assert.ok(!base.includes('--disable-slash-commands'), 'chains need typed commands');
  const old = buildClaudeArgs({ prompt: 'p', model: 'm', condition: 'baseline' });
  assert.ok(old.includes('--no-session-persistence') && !old.includes('--tools') && !old.includes('--agent'), '0.3.0 arguments by default');
});

const STREAM = (skills, cacheRead) =>
  [
    { type: 'system', subtype: 'init', tools: ['Read', 'Bash', 'mcp__acct__secret'], skills, agents: ['general-purpose', 'Explore'] },
    { type: 'assistant', message: { id: 'm1', usage: { input_tokens: 3, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 9000, output_tokens: 5 } } },
    { type: 'assistant', message: { id: 'm2', usage: { input_tokens: 1, cache_read_input_tokens: 9000, cache_creation_input_tokens: 10, output_tokens: 7 } } },
  ]
    .map((e) => JSON.stringify(e))
    .join('\n');

test('runFingerprint: counts and hashes from init, ThinWindow skills apart, first request and cache state', () => {
  const base = runFingerprint(STREAM(['acct-skill', 'review'], 0));
  const skin = runFingerprint(STREAM(['review', 'thinwindow:resume', 'acct-skill', 'thinwindow:report'], 4000));
  for (const k of ['toolCount', 'toolsHash', 'skillCount', 'skillsHash', 'agentCount']) assert.equal(base[k], skin[k], k);
  assert.equal(base.toolCount, 3);
  assert.equal(base.skillCount, 2);
  assert.equal(skin.pluginSkillCount, 2);
  assert.match(base.toolsHash, /^[0-9a-f]{12}$/);
  assert.ok(!JSON.stringify(base).includes('secret'), 'names are hashed');
  assert.deepEqual(base.firstRequest, { input: 3, cacheRead: 0, cacheWrite: 9000, output: 5, context: 9003 });
  assert.equal(base.cacheState, 'cold');
  assert.equal(skin.cacheState, 'warm');
  assert.equal(runFingerprint('not json').toolCount, null);
  const host = hostFingerprint({ account: 'acct-a', env: { CLAUDE_CONFIG_DIR: '/x/.claude-bench-flow' } });
  assert.equal(host.profile, '.claude-bench-flow');
  assert.match(host.account, /^[0-9a-f]{12}$/);
  assert.notEqual(host.account, 'acct-a');
  assert.equal(hostFingerprint({ env: {} }).profile, 'default');
  assert.equal(hostFingerprint({ env: {} }).account, null);
});

test('planRuns: a seeded random order per pair, reproducible; alternating without a seed', () => {
  const tasks = Array.from({ length: 8 }, (_, i) => ({ id: `t${i}` }));
  const a = planRuns(tasks, ['baseline', 'thinwindow'], 3, 7).map((p) => `${p.task.id}:${p.condition}:${p.rep}`);
  assert.deepEqual(planRuns(tasks, ['baseline', 'thinwindow'], 3, 7).map((p) => `${p.task.id}:${p.condition}:${p.rep}`), a);
  assert.notDeepEqual(planRuns(tasks, ['baseline', 'thinwindow'], 3, 8).map((p) => `${p.task.id}:${p.condition}:${p.rep}`), a);
  assert.equal(a.length, 48);
  for (let i = 0; i < a.length; i += 2) {
    const [t1, c1, r1] = a[i].split(':');
    const [t2, c2, r2] = a[i + 1].split(':');
    assert.ok(t1 === t2 && r1 === r2 && c1 !== c2, 'both conditions of a pair run back to back');
  }
  const firsts = a.filter((_, i) => i % 2 === 0).map((x) => x.split(':')[1]);
  assert.ok(firsts.includes('baseline') && firsts.includes('thinwindow'));
  assert.deepEqual(planRuns([{ id: 'x' }], ['baseline', 'thinwindow'], 2).map((p) => p.condition), ['baseline', 'thinwindow', 'thinwindow', 'baseline']);
});

test('0.4.0 rows live in their own folder, and a run found twice counts once', () => {
  assert.equal(versionDir('0.4.0-dev'), join(RESULTS_DIR, '0.4.0'));
  assert.equal(defaultOut({ model: 'm' }, '0.4.0-dev'), join(RESULTS_DIR, '0.4.0', `${defaultOut({ model: 'm' }, '0.4.0').split('/').pop()}`));
  assert.match(defaultOut({ model: 'm', chains: [1] }, '0.4.0-dev'), /0\.4\.0\/\d{4}-\d\d-\d\d-m-chains\.jsonl$/);
  assert.equal(defaultOut({ model: 'm', out: '/x.jsonl' }), '/x.jsonl');
  assert.deepEqual(dedupeRuns([{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'a' }, {}, {}]).length, 4);
  assert.ok(since('0.4.0-dev') && since('0.4.0') && since('0.10.1') && since('1.0.0'));
  assert.ok(!since('0.3.0') && !since('0.3.9') && !since(undefined));
});

// A 0.4.0 row with a full fingerprint.
function row(task, condition, costUsd, extra = {}) {
  return {
    task,
    condition,
    model: 'claude-sonnet-5-5',
    modelResolved: 'claude-sonnet-5-5',
    claudeVersion: '2.1.289',
    thinwindowVersion: '0.4.0-dev',
    effort: 'default',
    os: 'darwin 22.6.0',
    profile: '.claude-bench-flow',
    account: 'abc123abc123',
    maxTurns: 40,
    bare: false,
    toolList: null,
    disallowedTools: null,
    agent: null,
    toolCount: 28,
    toolsHash: 'aaaaaaaaaaaa',
    skillCount: 17,
    skillsHash: 'bbbbbbbbbbbb',
    pluginSkillCount: condition === 'thinwindow' ? 4 : 0,
    agentCount: 5,
    firstRequest: { context: condition === 'thinwindow' ? 21000 : 19000 },
    cacheState: 'warm',
    startedAt: '2026-10-06T10:00:00Z',
    totalTokens: costUsd * 1e6,
    costUsd,
    numTurns: 10,
    success: true,
    ...extra,
  };
}

const suite = () => {
  const rows = [];
  for (let t = 0; t < 4; t++) {
    for (let r = 0; r < 3; r++) {
      rows.push(row(`t${t}`, 'baseline', (t + 1) * (1 + r / 10)));
      rows.push(row(`t${t}`, 'thinwindow', (t + 1) * 0.8 * (1 + r / 10)));
    }
  }
  return rows;
};

test('report refuses to aggregate rows from different environments, or across methods', () => {
  assert.deepEqual(envMismatch(suite()), []);
  const drifted = suite();
  drifted[5] = { ...drifted[5], toolsHash: 'cccccccccccc', claudeVersion: '2.1.290' };
  assert.deepEqual(envMismatch(drifted), ['claudeVersion', 'toolsHash']);
  assert.throws(() => summarize(drifted), /different environments \(claudeVersion, toolsHash differ\)/);
  // A run that never reached Claude Code has no fingerprint to compare.
  assert.doesNotThrow(() => summarize([...suite(), row('t0', 'thinwindow', null, { toolCount: null, toolsHash: null, totalTokens: null, success: false })]));
  assert.throws(() => summarize([...suite(), row('t0', 'baseline', 1, { thinwindowVersion: '0.3.0' })]), /before and after 0\.4\.0/);
  // ThinWindow's own skills and the first request differ by condition only.
  assert.equal(summarize(suite())[0].env.pluginSkillCount, 4);
});

test('hierarchical bootstrap: seeded, brackets the change, and wider than tasks-only when runs vary', () => {
  const rand = mulberry32(3);
  const groups = Array.from({ length: 8 }, (_, t) => {
    const scale = 1 + t;
    const runs = (f) => Array.from({ length: 3 }, () => ({ costUsd: scale * f * (0.6 + 0.8 * rand()), success: true, totalTokens: 1 }));
    return { baseline: runs(1), thinwindow: runs(0.8) };
  });
  const a = hierarchicalBootstrap(groups, costPerCompleted, { reps: 4000 });
  assert.deepEqual(hierarchicalBootstrap(groups, costPerCompleted, { reps: 4000 }), a, 'seeded');
  assert.ok(a.ci[0] < a.point && a.point < a.ci[1]);
  assert.ok(a.mde > 0 && Math.abs(a.mde - 2.8 * a.se) < 1e-12);
  const tasksOnly = bootstrapDelta(groups.map((g) => ['baseline', 'thinwindow'].map((c) => g[c].reduce((s, r) => s + r.costUsd, 0) / 3)), { reps: 4000 });
  assert.ok(100 * Math.expm1(a.ci[1]) - 100 * Math.expm1(a.ci[0]) > tasksOnly[1] - tasksOnly[0], 'run-to-run noise widens the interval');
  assert.equal(hierarchicalBootstrap(groups.slice(0, 1), costPerCompleted), null);
  // No passing run in a condition: cost per completed task is undefined, and dropped.
  const failing = groups.map((g) => ({ ...g, thinwindow: g.thinwindow.map((r) => ({ ...r, success: false })) }));
  assert.equal(hierarchicalBootstrap(failing, costPerCompleted, { reps: 100 }), null);
  assert.ok(Math.abs(sumOfMedians('costUsd')([{ baseline: [{ costUsd: 2 }], thinwindow: [{ costUsd: 1 }] }]) - Math.log(0.5)) < 1e-12);
  // A failure is paid for by the tasks that completed.
  assert.ok(Math.abs(costPerCompleted([{ baseline: [{ costUsd: 1, success: true }, { costUsd: 1, success: false }], thinwindow: [{ costUsd: 1, success: true }] }]) - Math.log(1 / 2)) < 1e-12);
});

test('0.4.0 report: cost per completed task, intervals with the smallest detectable effect, environment', () => {
  const [s] = summarize(suite());
  assert.equal(s.method, 'hierarchical');
  assert.ok(Math.abs(s.total.costPerCompleted.delta - -20) < 1e-9);
  assert.ok(s.total.costPerCompleted.ci[0] <= -20 && s.total.costPerCompleted.ci[1] >= -20);
  assert.ok(s.total.tokensMde > 0 && s.total.costMde > 0);
  const md = markdownReport([s]);
  assert.match(md, /Cost per completed task: −20\.0% \(95% interval .+; smallest detectable effect ±\d+\.\d%\)/);
  assert.match(md, /Environment: Claude Code 2\.1\.289 · effort default · profile \.claude-bench-flow · account abc123abc123 · 28 tools \(aaaaaaaaaaaa\) · 17 skills \(bbbbbbbbbbbb\) \+ 4 ThinWindow/);
  assert.match(md, /First request \(median\): baseline 19k tokens, thinwindow 21k tokens · cold first requests: baseline 0\/12, thinwindow 0\/12/);
  assert.match(md, /resamples tasks, then runs within each task and condition/);
});

test('chains: one run per chain, rep and condition, priced from token usage with the cold penalty', () => {
  const req = (n) => [{ input: n, cacheRead: 0, cacheWrite: 0, output: 0 }];
  const env = Object.fromEntries(Object.entries(row('x', 'baseline', 1)).filter(([k]) => !['task', 'condition', 'costUsd', 'totalTokens', 'success', 'firstRequest'].includes(k)));
  const ab = (condition, arm, { bPass = true, aAfter = true } = {}) => [
    { ...env, kind: 'chain', experiment: 'resume', phase: 'A', chain: 1, rep: 1, taskA: 'a', taskB: 'b', condition, requests: req(1e6), numTurns: 4, aPass: true, costUsd: 99, pluginSkillCount: condition === 'thinwindow' ? 4 : 0 },
    { ...env, kind: 'chain', experiment: 'resume', phase: 'B', chain: 1, rep: 1, taskA: 'a', taskB: 'b', condition, arm, requests: req(5e5), numTurns: 3, bPass, aPass: aAfter, coldPenaltyUsd: arm === 'continue' ? 0.5 : 0.1, invocations: [{ costUsd: 150, subtype: 'success' }], sessionId: `${condition}-b` },
  ];
  const [base, skin] = chainRuns([...ab('baseline', 'continue'), ...ab('thinwindow', 'fresh', { aAfter: false })]);
  // $2 per MTok input on Sonnet 5.5: A $2, B $1, plus the penalty; never the cumulative $150.
  assert.ok(Math.abs(base.costUsd - 3.5) < 1e-9);
  assert.ok(Math.abs(skin.costUsd - 3.1) < 1e-9);
  assert.equal(base.totalTokens, 1.5e6);
  assert.equal(base.numTurns, 7);
  assert.equal(base.success, true);
  assert.equal(skin.success, false, 'A must still pass after B');
  assert.equal(base.task, 'chain-1 (a → b)');
  const [s] = summarize([...ab('baseline', 'continue'), ...ab('thinwindow', 'fresh')]);
  assert.equal(s.model, 'claude-sonnet-5-5 (chains)');
  assert.equal(s.env.pluginSkillCount, 4);
  assert.match(markdownReport([s]), /A chain run is task A, then task B in the same clone/);
  // #32's rows (no harness kind) are not chain runs.
  assert.deepEqual(chainRuns([]), []);
});

test("chain arms: thinwindow loads the plugin and keeps the session; the baseline resumes A's fork", () => {
  const harness = { maxTurns: 40, tools: null, disallowedTools: 'Skill', agent: null };
  const fresh = experimentArgs({ prompt: '/thinwindow:resume do B', model: 'm', condition: 'thinwindow', ...harness });
  assert.equal(fresh[fresh.indexOf('--plugin-dir') + 1], ROOT_DIR);
  assert.ok(!fresh.includes('--no-session-persistence') && !fresh.includes('--resume'));
  assert.equal(fresh[fresh.indexOf('--disallowedTools') + 1], 'Skill');
  const cont = experimentArgs({ prompt: 'do B', model: 'm', condition: 'baseline', resume: 'A', fork: true, ...harness });
  assert.ok(!cont.includes('--plugin-dir'));
  assert.deepEqual(cont.slice(-3), ['--resume', 'A', '--fork-session']);
});

const HOME = '/Users/someone';
const CLONE = '/private/var/folders/xx/T/thinwindow-bench-a-baseline-123';
const TRANSCRIPT = [
  { type: 'queue-operation', operation: 'enqueue', content: 'prompt' },
  { type: 'attachment', uuid: 'u0', sessionId: 's1', cwd: CLONE, attachment: { type: 'credential_org', organizationUuid: 'org-secret' } },
  { type: 'attachment', uuid: 'u1', sessionId: 's1', attachment: { type: 'prompt_snapshot', systemPrompt: `You are... ${HOME}/.claude/CLAUDE.md`, tools: ['x'] } },
  { type: 'attachment', uuid: 'u2', sessionId: 's1', attachment: { type: 'skill_listing', names: ['acct-skill'], content: 'acct-skill: private' } },
  { type: 'attachment', uuid: 'u3', sessionId: 's1', attachment: { type: 'hook_additional_context', content: 'thinwindow: read less', hookName: 'SessionStart' } },
  { type: 'user', uuid: 'u4', sessionId: 's1', cwd: CLONE, promptSource: 'x', entrypoint: 'sdk-cli', message: { role: 'user', content: 'fix the bug' } },
  {
    type: 'assistant',
    uuid: 'u5',
    sessionId: 's1',
    requestId: 'req-secret',
    message: {
      id: 'm1',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      usage: { input_tokens: 1 },
      container: 'c',
      content: [
        { type: 'thinking', thinking: 'plan', signature: 'sig-secret' },
        { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: `${CLONE}/lib/a.js` } },
        { type: 'redacted_thinking', data: 'opaque' },
      ],
    },
  },
  { type: 'user', uuid: 'u6', sessionId: 's1', toolUseResult: { originalFile: 'all of it' }, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: [{ type: 'text', text: `owner someone in ${HOME}/x, skill in ${HOME}/code/thinwindow/skills/resume` }] }] } },
  { type: 'cost-state', totalCostUSD: 1 },
  { type: 'file-history-snapshot', snapshot: {} },
];

test('kept transcripts: an allowlist of records, fields and attachments, with home and clone paths replaced', () => {
  const scrub = scrubber({ clone: CLONE, home: HOME, config: `${HOME}/.claude-bench-flow`, plugin: `${HOME}/code/thinwindow`, user: 'someone', tmp: '/private/var/folders/xx/T' });
  const out = scrubTranscript(TRANSCRIPT, scrub);
  const text = JSON.stringify(out);
  for (const secret of ['org-secret', 'You are', 'acct-skill', 'req-secret', 'sig-secret', 'all of it', 'opaque', HOME, 'someone', 'enqueue', 'totalCostUSD']) assert.ok(!text.includes(secret), secret);
  assert.deepEqual(out.map((r) => r.type), ['attachment', 'attachment', 'attachment', 'attachment', 'user', 'assistant', 'user']);
  assert.deepEqual(out[0].attachment, { type: 'credential_org', chars: JSON.stringify(TRANSCRIPT[1].attachment).length });
  assert.equal(out[3].attachment.content, 'thinwindow: read less', 'what ThinWindow injects is kept');
  assert.ok(KEEP_ATTACHMENTS.includes('hook_additional_context'));
  assert.equal(out[4].cwd, '<clone>');
  assert.equal(out[4].promptSource, undefined);
  assert.deepEqual(out[5].message.content, [{ type: 'thinking', thinking: 'plan' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '<clone>/lib/a.js' } }, { type: 'redacted_thinking' }]);
  assert.deepEqual(out[5].message.usage, { input_tokens: 1 });
  assert.equal(out[6].message.content[0].content[0].text, 'owner <user> in ~/x, skill in <plugin>/skills/resume');
  assert.equal(out[6].toolUseResult, undefined);
  assert.ok(isPublicRepo('https://github.com/tj/commander.js.git') && !isPublicRepo('/tmp/repo') && !isPublicRepo('git@github.com:x/y'));
});

test('keepTranscript writes only the named session, next to the results', () => {
  const root = tempDir('thinwindow-projects-');
  mkdirSync(join(root, '-tmp-clone'));
  writeFileSync(join(root, '-tmp-clone', 'sess-1.jsonl'), `${TRANSCRIPT.map((r) => JSON.stringify(r)).join('\n')}\n`);
  writeFileSync(join(root, '-tmp-clone', 'other.jsonl'), '{"type":"user"}\n');
  const outDir = tempDir('thinwindow-out-');
  assert.equal(keepTranscript('sess-1', { outDir, clone: CLONE, root }), 'transcripts/sess-1.jsonl');
  const kept = readFileSync(join(outDir, 'transcripts', 'sess-1.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(kept.length, 7);
  assert.equal(keepTranscript('missing', { outDir, clone: CLONE, root }), null);
  assert.equal(keepTranscript('../escape', { outDir, clone: CLONE, root }), null);
});

// Fake claude for a chain: "A" writes a.txt, "B" writes b.txt; a resumed run
// reports the carried cost cumulatively, as Claude Code does.
const FAKE_CHAIN = `
import { appendFileSync, writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('0.0.1'); process.exit(0); }
const prompt = args[args.indexOf('-p') + 1];
const resume = args.includes('--resume') ? args[args.indexOf('--resume') + 1] : null;
appendFileSync('calls.log', JSON.stringify({ prompt, resume, plugin: args.includes('--plugin-dir'), persist: !args.includes('--no-session-persistence'), disallowed: args.includes('--disallowedTools') ? args[args.indexOf('--disallowedTools') + 1] : null }) + '\\n');
writeFileSync(prompt.includes('task A') ? 'a.txt' : 'b.txt', 'ok');
const session = resume ? resume + '-fork' : (prompt.includes('task A') ? 'sa-' : 'sb-') + process.pid;
const usage = { input_tokens: 1000, cache_read_input_tokens: resume ? 50000 : 0, cache_creation_input_tokens: 0, output_tokens: 0 };
console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: session, tools: ['Read'], skills: args.includes('--plugin-dir') ? ['thinwindow:resume'] : [] }));
console.log(JSON.stringify({ type: 'assistant', message: { id: 'm-' + session, usage } }));
console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, num_turns: 2, total_cost_usd: resume ? 9 : 0.01, session_id: session, result: 'done',
  modelUsage: { 'claude-sonnet-5-5': { inputTokens: 1000, cacheReadInputTokens: usage.cache_read_input_tokens, cacheCreationInputTokens: 0, outputTokens: 0 } } }));
`;

test('a chain job runs A then B under one condition and writes rows the report joins', { skip: process.platform === 'win32' && 'bench runs need a POSIX shell' }, async () => {
  const repo = tempDir('thinwindow-chain-repo-');
  const git = (...a) => spawnSync('git', a, { cwd: repo, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  writeFileSync(join(repo, 'README.md'), 'x\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  const commit = git('rev-parse', 'HEAD').stdout.trim();
  const fake = join(tempDir('thinwindow-fake-chain-'), 'claude.mjs');
  writeFileSync(fake, FAKE_CHAIN);
  const tasks = [
    { id: 'a', repo, commit, prompt: 'do task A', verify: 'test -f a.txt', timeout: 60 },
    { id: 'b', repo, commit, prompt: 'do task B', verify: 'test -f b.txt && test -f a.txt', timeout: 60 },
  ];
  const out = join(tempDir('thinwindow-chain-out-'), 'chains.jsonl');
  const env = { ...Object.fromEntries(Object.entries(row('x', 'baseline', 1)).filter(([k]) => ['claudeVersion', 'thinwindowVersion', 'effort', 'os', 'profile', 'account', 'maxTurns', 'bare', 'toolList', 'agent'].includes(k))), disallowedTools: 'Skill', kind: 'chain' };
  const run = { harness: true, claude: { cmd: process.execPath, prefixArgs: [fake] }, maxTurns: 40, disallowedTools: 'Skill' };
  for (const [condition, arm] of [['baseline', 'continue'], ['thinwindow', 'fresh']]) {
    await runJob({ chain: 1, rep: 1, model: 'claude-sonnet-5-5', budget: new Budget(null), env, out, log: () => {}, condition, arms: [arm], run, tasks });
  }
  const rows = readResultFile(out);
  assert.deepEqual(rows.map((r) => `${r.condition}:${r.phase}:${r.arm ?? ''}`), ['baseline:A:', 'baseline:B:continue', 'thinwindow:A:', 'thinwindow:B:fresh']);
  assert.ok(rows.every((r) => r.kind === 'chain' && r.toolCount === 1 && r.finalMessage === 'done' && r.sessionId));
  const [contB, freshB] = [rows[1], rows[3]];
  assert.equal(contB.coldReadTokens, 50000);
  assert.equal(freshB.coldReadTokens, 0);
  assert.equal(freshB.briefFound, false);
  assert.equal(rows[2].pluginSkillCount, 1);
  const [base, skin] = chainRuns(rows);
  assert.ok(base.success && skin.success);
  // A $0.002 + B $0.002 + 50k reads at $0.2/MTok + 50k × ($4 − $0.2)/MTok cold: not the reported cumulative $9.
  assert.ok(Math.abs(base.costUsd - (0.002 + 0.002 + 0.01 + 0.19)) < 1e-9, String(base.costUsd));
  assert.ok(Math.abs(skin.costUsd - 0.004) < 1e-9, String(skin.costUsd));
  assert.doesNotThrow(() => summarize(rows));
});
