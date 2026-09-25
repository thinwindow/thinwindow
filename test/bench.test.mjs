// Benchmark runner and report tests. No network and no real `claude`: the
// end-to-end test uses a fake claude executable and a local git repo.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildClaudeArgs, claudeEnv, parseResult, parseTrace, ruleAbsolute } from '../bench/lib/claude.mjs';
import { BENCH_DIR, FIXTURES_DIR, ROOT_DIR, SOLUTIONS_DIR } from '../bench/lib/paths.mjs';
import { PRIOR_RUN_TOKENS, costOf, priceOf, resolveModel } from '../bench/lib/pricing.mjs';
import { readResultFile, resultsPath } from '../bench/lib/results.mjs';
import { median, pctDelta } from '../bench/lib/stats.mjs';
import { listTaskIds, loadTasks, repoLabel } from '../bench/lib/tasks.mjs';
import { UsageError, estimateCost, parseCli, planRuns, runBench } from '../bench/run.mjs';
import { fmtPct, fmtTokens, markdownReport, summarize, svgChart } from '../bench/report.mjs';
import { tempDir } from './helpers.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUN = join(ROOT_DIR, 'bench', 'run.mjs');

test('there are 8 to 10 valid tasks on 2 or 3 repos', () => {
  const tasks = loadTasks();
  assert.ok(tasks.length >= 8 && tasks.length <= 10, `${tasks.length} tasks`);
  const repos = new Set(tasks.map((t) => t.repo));
  assert.ok(repos.size >= 2 && repos.size <= 3, `${repos.size} repos`);
});

test('every task has its fixtures and a reference solution', () => {
  for (const t of loadTasks()) {
    for (const m of t.verify.matchAll(/"\$THINWINDOW_BENCH_FIXTURES"\/([^\s"']+)/g)) {
      assert.ok(existsSync(join(FIXTURES_DIR, m[1])), `${t.id}: missing fixture ${m[1]}`);
    }
    assert.ok(existsSync(join(SOLUTIONS_DIR, `${t.id}.patch`)), `${t.id}: missing solution`);
  }
});

test('the task mix covers the spec', () => {
  const ids = listTaskIds().join(' ');
  assert.match(ids, /footer-year/);
  assert.match(ids, /rename/);
  assert.match(ids, /config/);
  assert.match(ids, /extract/);
  assert.match(ids, /commander-/);
  assert.match(ids, /click-/);
});

test('repoLabel', () => {
  assert.equal(repoLabel('https://github.com/tj/commander.js.git'), 'tj/commander.js');
  assert.equal(repoLabel('https://github.com/pallets/click'), 'pallets/click');
});

test('parseCli', () => {
  const o = parseCli(['--condition', 'baseline', '--reps', '2', '--model', 'sonnet', '--tasks', 'a,b', '--max-cost', '10']);
  assert.deepEqual(o.conditions, ['baseline']);
  assert.equal(o.reps, 2);
  assert.equal(o.model, 'sonnet');
  assert.deepEqual(o.taskIds, ['a', 'b']);
  assert.equal(o.maxCost, 10);
  assert.equal(o.maxTurns, 40);
  assert.equal(o.dryRun, false);
  assert.deepEqual(parseCli(['--condition', 'baseline,thinwindow', '--model', 'x']).conditions, ['baseline', 'thinwindow']);
  assert.throws(() => parseCli(['--model', 'x']), UsageError);
  assert.throws(() => parseCli(['--condition', 'baseline']), UsageError);
  assert.throws(() => parseCli(['--condition', 'nope', '--model', 'x']), UsageError);
  assert.throws(() => parseCli(['--condition', 'baseline', '--model', 'x', '--reps', '0']), UsageError);
  assert.throws(() => parseCli(['--condition', 'baseline', '--model', 'x', '--max-cost', '-1']), UsageError);
  assert.throws(() => parseCli(['--condition', 'baseline', '--model', 'x', '--bogus']), UsageError);
});

test('planRuns interleaves conditions and alternates the order per rep', () => {
  const tasks = [{ id: 'a' }, { id: 'b' }];
  const plan = planRuns(tasks, ['baseline', 'thinwindow'], 2).map((p) => `${p.task.id}:${p.condition}:${p.rep}`);
  assert.deepEqual(plan, [
    'a:baseline:1', 'a:thinwindow:1', 'b:baseline:1', 'b:thinwindow:1',
    'a:thinwindow:2', 'a:baseline:2', 'b:thinwindow:2', 'b:baseline:2',
  ]);
});

test('buildClaudeArgs: same flags for both conditions, plugin only for thinwindow', () => {
  const base = buildClaudeArgs({ prompt: 'do it', model: 'sonnet', condition: 'baseline' });
  const skin = buildClaudeArgs({ prompt: 'do it', model: 'sonnet', condition: 'thinwindow' });
  assert.deepEqual(base.slice(0, 9), ['-p', 'do it', '--output-format', 'stream-json', '--verbose', '--model', 'sonnet', '--max-turns', '40']);
  assert.ok(!base.includes('--plugin-dir'));
  assert.equal(skin[skin.indexOf('--plugin-dir') + 1], ROOT_DIR);
  assert.deepEqual(skin.slice(0, base.length), base);
  assert.equal(base[base.indexOf('--permission-mode') + 1], 'acceptEdits');
  const settings = JSON.parse(base[base.indexOf('--settings') + 1]);
  assert.equal(settings.sandbox.enabled, true);
  assert.equal(settings.sandbox.failIfUnavailable, true);
  assert.equal(settings.sandbox.allowUnsandboxedCommands, false);
  assert.ok(settings.sandbox.filesystem.denyRead[0].endsWith('bench'));
  assert.ok(settings.permissions.deny.includes('WebSearch'));
  assert.ok(settings.permissions.deny.some((r) => r.startsWith('Read(//') && r.endsWith('/**)')));
  assert.ok(buildClaudeArgs({ prompt: 'x', model: 'm', condition: 'baseline', bare: true }).includes('--bare'));
  assert.throws(() => buildClaudeArgs({ prompt: 'x', model: 'm', condition: 'other' }));
});

test('ruleAbsolute', () => {
  assert.equal(ruleAbsolute('/home/u/thinwindow/bench'), '//home/u/thinwindow/bench');
  assert.equal(ruleAbsolute('C:\\work\\thinwindow\\bench'), '//c/work/thinwindow/bench');
});

test('claudeEnv keeps thinwindow out of the baseline', () => {
  assert.equal(claudeEnv('baseline', { THINWINDOW: '', PATH: 'x' }).THINWINDOW, 'off');
  assert.equal(claudeEnv('thinwindow', { THINWINDOW: 'off' }).THINWINDOW, undefined);
  assert.equal(claudeEnv('thinwindow', { THINWINDOW_DEBUG: '1' }).THINWINDOW_DEBUG, undefined);
});

test('parseResult reads usage, preferring modelUsage (includes subagents)', () => {
  const json = {
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1234,
    num_turns: 7,
    total_cost_usd: 0.5,
    session_id: 's1',
    usage: { input_tokens: 1, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 4 },
    modelUsage: {
      'claude-sonnet-5': { inputTokens: 10, outputTokens: 20, cacheReadInputTokens: 300, cacheCreationInputTokens: 40, costUSD: 0.4 },
      'claude-haiku-4-5': { inputTokens: 1, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, costUSD: 0.1 },
    },
  };
  const r = parseResult(JSON.stringify(json));
  assert.equal(r.inputTokens, 11);
  assert.equal(r.outputTokens, 22);
  assert.equal(r.cacheReadTokens, 303);
  assert.equal(r.cacheCreationTokens, 44);
  assert.equal(r.totalTokens, 380);
  assert.equal(r.costUsd, 0.5);
  assert.equal(r.numTurns, 7);
  assert.equal(r.durationMs, 1234);
  assert.equal(r.isError, false);
  assert.deepEqual(r.modelsUsed, ['claude-sonnet-5', 'claude-haiku-4-5']);

  const noMu = parseResult(JSON.stringify({ ...json, modelUsage: undefined, is_error: true, subtype: 'error_max_turns' }));
  assert.equal(noMu.totalTokens, 10);
  assert.equal(noMu.isError, true);
  assert.equal(noMu.subtype, 'error_max_turns');
  assert.equal(parseResult(`{"type":"system"}\n${JSON.stringify(json)}`).totalTokens, 380);
  assert.equal(parseResult(JSON.stringify([{ type: 'system' }, json])).totalTokens, 380);
  assert.equal(parseResult('not json'), null);
  assert.equal(parseResult(''), null);
});

test('pricing and cost estimate', () => {
  assert.equal(resolveModel('sonnet'), 'claude-sonnet-5');
  assert.equal(resolveModel('opus'), 'claude-opus-5-5');
  assert.equal(resolveModel('claude-haiku-4-5-20251001'), 'claude-haiku-4-5');
  assert.equal(priceOf('some-unknown-model'), null);
  const price = priceOf('claude-sonnet-5');
  assert.equal(costOf({ input: 1e6, cacheCreation: 0, cacheRead: 0, output: 1e6 }, price), 12);

  const tasks = [{ id: 'a' }, { id: 'b' }];
  const plan = planRuns(tasks, ['baseline', 'thinwindow'], 1);
  const prior = estimateCost({ plan, model: 'sonnet' });
  assert.equal(prior.basis.prior, 4);
  assert.ok(Math.abs(prior.total - 4 * costOf(PRIOR_RUN_TOKENS, price)) < 1e-9);

  const history = [
    { model: 'sonnet', modelResolved: 'claude-sonnet-5', task: 'a', condition: 'baseline', costUsd: 1 },
    { model: 'sonnet', modelResolved: 'claude-sonnet-5', task: 'a', condition: 'baseline', costUsd: 3 },
    { model: 'claude-sonnet-5', modelResolved: 'claude-sonnet-5', task: 'a', condition: 'thinwindow', costUsd: 1 },
    { model: 'opus', modelResolved: 'claude-opus-5-5', task: 'b', condition: 'baseline', costUsd: 100 },
  ];
  const est = estimateCost({ plan, model: 'sonnet', history });
  assert.deepEqual(est.perRun, [2, 1, 1, 1]);
  assert.equal(est.basis.taskCondition, 2);
  assert.equal(est.basis.model, 2);
  assert.equal(estimateCost({ plan, model: 'sonnet', estRunUsd: 0.25 }).total, 1);
  assert.equal(estimateCost({ plan, model: 'mystery' }).total, null);
});

function runCli(args) {
  return spawnSync(process.execPath, [RUN, ...args], { encoding: 'utf8', cwd: ROOT_DIR });
}

test('run.mjs --dry-run prints the plan and a cost estimate', () => {
  const n = listTaskIds().length;
  const r = runCli(['--condition', 'baseline,thinwindow', '--reps', '2', '--model', 'sonnet', '--dry-run', '--max-cost', '5']);
  assert.equal(r.status, 0, r.stderr);
  for (const id of listTaskIds()) assert.ok(r.stdout.includes(id), id);
  assert.ok(r.stdout.includes(`= ${n * 4} runs`), r.stdout);
  assert.match(r.stdout, /cost estimate: ~\$\d+\.\d\d for \d+ runs/);
  assert.match(r.stdout, /--max-cost \$5\.00/);
  assert.match(r.stdout, /claude-sonnet-5/);

  const one = runCli(['--condition', 'thinwindow', '--model', 'haiku', '--tasks', 'commander-ci-config', '--dry-run']);
  assert.equal(one.status, 0, one.stderr);
  assert.match(one.stdout, /= 1 run$/m);
});

test('run.mjs rejects bad arguments and unknown tasks with exit 2', () => {
  assert.equal(runCli(['--condition', 'baseline', '--dry-run']).status, 2);
  assert.equal(runCli(['--condition', 'maybe', '--model', 'x', '--dry-run']).status, 2);
  const unknown = runCli(['--condition', 'baseline', '--model', 'x', '--tasks', 'no-such-task', '--dry-run']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /unknown task/);
  assert.equal(runCli(['--help']).status, 0);
});

// A git repo on disk to stand in for a task repo.
function makeRepo() {
  const dir = tempDir('thinwindow-bench-repo-');
  const git = (...args) => spawnSync('git', args, { cwd: dir, encoding: 'utf8' });
  git('init', '-q');
  git('config', 'user.email', 't@example.invalid');
  git('config', 'user.name', 't');
  writeFileSync(join(dir, 'README.md'), 'hello\n');
  git('add', '.');
  git('commit', '-q', '-m', 'init');
  return { dir, commit: git('rev-parse', 'HEAD').stdout.trim() };
}

// Fake claude: records its argv and env, "solves" the task by writing
// done.txt unless the prompt says "fail", and prints a JSON result.
const FAKE_CLAUDE = `
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('0.0.1 (Fake Claude)'); process.exit(0); }
writeFileSync('args.json', JSON.stringify({ args, THINWINDOW: process.env.THINWINDOW ?? null }));
const prompt = args[args.indexOf('-p') + 1];
if (!prompt.includes('fail')) writeFileSync('done.txt', 'ok');
console.log(JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, duration_ms: 50, num_turns: 3, total_cost_usd: 0.4,
  usage: { input_tokens: 10, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 5 },
}));
`;

test('runBench end to end with a fake claude and a local repo', { skip: process.platform === 'win32' && 'bench runs need a POSIX shell' }, async () => {
  const repo = makeRepo();
  const fake = join(tempDir('thinwindow-fake-claude-'), 'claude.mjs');
  writeFileSync(fake, FAKE_CLAUDE);
  const out = join(tempDir('thinwindow-results-'), 'results.jsonl');
  const tasks = [
    { id: 'solve', repo: repo.dir, commit: repo.commit, prompt: 'solve it', setup: 'touch setup-ran', verify: 'test -f done.txt && test -f README.md && test -f setup-ran', timeout: 60 },
    { id: 'broken', repo: repo.dir, commit: repo.commit, prompt: 'fail please', verify: 'test -f done.txt', timeout: 60 },
  ];
  const options = {
    conditions: ['baseline', 'thinwindow'],
    reps: 1,
    model: 'sonnet',
    taskIds: [],
    dryRun: false,
    maxCost: null,
    maxTurns: 40,
    claude: { cmd: process.execPath, prefixArgs: [fake] },
    bare: false,
    out,
    keep: true,
  };
  const logs = [];
  const { records } = await runBench(options, { tasks, log: (s) => logs.push(s) });
  assert.equal(records.length, 4);
  const onDisk = readResultFile(out);
  assert.equal(onDisk.length, 4);
  const solved = onDisk.find((r) => r.task === 'solve' && r.condition === 'thinwindow');
  assert.equal(solved.success, true);
  assert.equal(solved.totalTokens, 1115);
  assert.equal(solved.costUsd, 0.4);
  assert.equal(solved.numTurns, 3);
  assert.equal(solved.commit, repo.commit);
  assert.equal(solved.claudeVersion, '0.0.1');
  assert.equal(solved.modelResolved, 'claude-sonnet-5');
  assert.equal(solved.thinwindowVersion, JSON.parse(readFileSync(join(ROOT_DIR, '.claude-plugin', 'plugin.json'), 'utf8')).version);
  const argsSkin = JSON.parse(readFileSync(join(solved.workdir, 'args.json'), 'utf8'));
  assert.ok(argsSkin.args.includes('--plugin-dir'));
  assert.equal(argsSkin.THINWINDOW, null);
  const base = onDisk.find((r) => r.task === 'solve' && r.condition === 'baseline');
  const argsBase = JSON.parse(readFileSync(join(base.workdir, 'args.json'), 'utf8'));
  assert.ok(!argsBase.args.includes('--plugin-dir'));
  assert.equal(argsBase.THINWINDOW, 'off');
  // The clone has no remote, so the agent can't fetch the repo's future.
  assert.equal(spawnSync('git', ['remote'], { cwd: base.workdir, encoding: 'utf8' }).stdout.trim(), '');
  const failed = onDisk.find((r) => r.task === 'broken');
  assert.equal(failed.success, false);
  assert.ok(Number.isInteger(failed.verifyExitCode) && failed.verifyExitCode !== 0);
  // A failed run keeps what the agent changed (the fake agent writes args.json).
  assert.match(failed.agentStatus, /args\.json/);
  assert.equal(typeof failed.agentDiff, 'string');
  assert.equal(typeof failed.agentFinal, 'string');
  assert.ok(!('agentDiff' in solved) && !('resultText' in solved));
  assert.match(logs.join(''), /4 runs, \$1\.60 total/);
});

test('runBench aborts without recording when claude fails to start', { skip: process.platform === 'win32' && 'bench runs need a POSIX shell' }, async () => {
  const repo = makeRepo();
  const broken = join(tempDir('thinwindow-fake-claude-'), 'claude.mjs');
  writeFileSync(broken, "if (process.argv[2] === '--version') { console.log('0.0.1'); } else { console.error('Error: sandbox unavailable'); process.exitCode = 1; }");
  const out = join(tempDir('thinwindow-results-'), 'results.jsonl');
  const tasks = [{ id: 'solve', repo: repo.dir, commit: repo.commit, prompt: 'solve it', verify: 'true', timeout: 60 }];
  const logs = [];
  const res = await runBench(
    { conditions: ['baseline'], reps: 3, model: 'sonnet', taskIds: [], maxCost: null, maxTurns: 40, claude: { cmd: process.execPath, prefixArgs: [broken] }, bare: false, out, keep: false },
    { tasks, log: (s) => logs.push(s) },
  );
  assert.equal(res.aborted, true);
  assert.equal(res.records.length, 0);
  assert.equal(existsSync(out), false);
  assert.match(logs.join(''), /sandbox unavailable/);

  const notLoggedIn = join(tempDir('thinwindow-fake-claude-'), 'claude.mjs');
  writeFileSync(
    notLoggedIn,
    "if (process.argv[2] === '--version') { console.log('0.0.1'); } else { console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key', total_cost_usd: 0, num_turns: 0, usage: { input_tokens: 0, output_tokens: 0 } })); process.exitCode = 1; }",
  );
  const logs2 = [];
  const res2 = await runBench(
    { conditions: ['baseline'], reps: 2, model: 'sonnet', taskIds: [], maxCost: null, maxTurns: 40, claude: { cmd: process.execPath, prefixArgs: [notLoggedIn] }, bare: false, out, keep: false },
    { tasks, log: (s) => logs2.push(s) },
  );
  assert.equal(res2.aborted, true);
  assert.match(logs2.join(''), /Invalid API key/);
});

test('runBench stops starting runs once --max-cost is reached', { skip: process.platform === 'win32' && 'bench runs need a POSIX shell' }, async () => {
  const repo = makeRepo();
  const fake = join(tempDir('thinwindow-fake-claude-'), 'claude.mjs');
  writeFileSync(fake, FAKE_CLAUDE);
  const out = join(tempDir('thinwindow-results-'), 'results.jsonl');
  const tasks = [{ id: 'solve', repo: repo.dir, commit: repo.commit, prompt: 'solve it', verify: 'true', timeout: 60 }];
  const logs = [];
  const { records, stopped } = await runBench(
    {
      conditions: ['baseline'],
      reps: 5,
      model: 'sonnet',
      taskIds: [],
      maxCost: 1,
      maxTurns: 40,
      claude: { cmd: process.execPath, prefixArgs: [fake] },
      bare: false,
      out,
      keep: false,
    },
    { tasks, log: (s) => logs.push(s) },
  );
  // 0.4 per run: runs start at 0, 0.4 and 0.8, then 1.2 >= 1 stops.
  assert.equal(records.length, 3);
  assert.equal(stopped, true);
  assert.match(logs.join(''), /stopping: cumulative cost \$1\.20 reached --max-cost \$1\.00 after 3 of 5 runs/);
});

test('resultsPath', () => {
  assert.equal(resultsPath('claude-sonnet-5', { date: '2026-09-24', dir: '/r' }).replace(/\\/g, '/'), '/r/2026-09-24-claude-sonnet-5.jsonl');
  assert.match(resultsPath('us.anthropic/x y', { date: 'd', dir: '/r' }), /d-us\.anthropic_x_y\.jsonl$/);
});

test('stats', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
  assert.equal(median([]), null);
  assert.equal(pctDelta(200, 150), -25);
  assert.equal(pctDelta(0, 1), null);
});

function rec(task, condition, totalTokens, extra = {}) {
  return {
    task,
    condition,
    model: 'sonnet',
    modelResolved: 'claude-sonnet-5',
    claudeVersion: '2.1.281',
    thinwindowVersion: '0.1.0',
    thinwindowCommit: 'abc1234',
    startedAt: '2026-09-24T10:00:00Z',
    totalTokens,
    costUsd: totalTokens / 1e6,
    numTurns: 10,
    success: true,
    ...extra,
  };
}

test('report: medians, spread, deltas, totals and failures', () => {
  const records = [
    rec('a', 'baseline', 1000),
    rec('a', 'baseline', 3000),
    rec('a', 'thinwindow', 1000),
    rec('a', 'thinwindow', 500, { success: false }),
    rec('b', 'baseline', 10000),
    rec('b', 'thinwindow', 8000),
    rec('b', 'thinwindow', null, { costUsd: null, numTurns: null, success: false, error: 'boom' }),
  ];
  const [s] = summarize(records);
  assert.equal(s.model, 'claude-sonnet-5');
  const a = s.tasks.find((t) => t.task === 'a');
  assert.equal(a.baseline.medianTokens, 2000);
  assert.deepEqual(a.baseline.tokenSpread, { min: 1000, max: 3000 });
  assert.equal(a.thinwindow.medianTokens, 750);
  assert.equal(a.thinwindow.successes, 1);
  assert.equal(a.tokensDelta, -62.5);
  const b = s.tasks.find((t) => t.task === 'b');
  assert.equal(b.thinwindow.runs, 2);
  assert.equal(b.thinwindow.errors, 1);
  assert.equal(b.thinwindow.medianTokens, 8000);
  assert.equal(s.total.baseline.tokens, 12000);
  assert.equal(s.total.thinwindow.tokens, 8750);
  assert.equal(s.total.thinwindow.successes, 2);
  assert.equal(s.total.thinwindow.runs, 4);
  const md = markdownReport([s]);
  assert.match(md, /\| a \| 2\.0k \(1\.0k–3\.0k\) \| 750 \(500–1\.0k\) \| −62\.5% \|/);
  assert.match(md, /\| \*\*Total\*\* \| \*\*12k\*\* \| \*\*8\.8k\*\* \| \*\*−27\.1%\*\* \|/);
  assert.match(md, /\*\*3\/3\*\* \| \*\*2\/4\*\*/);
  assert.match(md, /tuned on these same tasks/);
  assert.match(md, /1 run\(s\) ended without usage data/);
  assert.match(md, /Claude Code 2\.1\.281/);
});

test('report: SVG chart is self-contained and escapes labels', () => {
  const [s] = summarize([rec('a<b', 'baseline', 2000), rec('a<b', 'thinwindow', 1000)]);
  const svg = svgChart(s);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<\/svg>\n$/);
  assert.ok(svg.includes('a&lt;b'));
  assert.ok(!svg.includes('a<b'));
  assert.match(svg, /prefers-color-scheme: dark/);
  assert.match(svg, /−50\.0%/);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(svg), 'no external references');
});

test('formatting helpers', () => {
  assert.equal(fmtTokens(1_234_567), '1.23M');
  assert.equal(fmtTokens(45_600), '46k');
  assert.equal(fmtTokens(4_560), '4.6k');
  assert.equal(fmtPct(-25), '−25.0%');
  assert.equal(fmtPct(12.345), '+12.3%');
  assert.equal(fmtPct(null), '–');
});

test('the bench directory keeps results and paths inside the repo', () => {
  assert.equal(BENCH_DIR, join(HERE, '..', 'bench'));
});

test('parseTrace lists tool calls from stream-json output', () => {
  const msg = (content) => JSON.stringify({ type: 'assistant', message: { content } });
  const out = [
    JSON.stringify({ type: 'system', subtype: 'init' }),
    msg([{ type: 'text', text: 'hi' }, { type: 'tool_use', name: 'Read', input: { file_path: '/r/src/a.py', limit: 120 } }]),
    msg([{ type: 'tool_use', name: 'Bash', input: { command: 'pytest  -q\n tests' } }]),
    JSON.stringify({ type: 'result', num_turns: 2 }),
  ].join('\n');
  assert.deepEqual(parseTrace(out), ['Read [1+120] /r/src/a.py', 'Bash pytest -q tests']);
});
