#!/usr/bin/env node
// thinwindow benchmark runner.
//
//   node bench/run.mjs --condition baseline|thinwindow --reps N --model <m> [--tasks ids]
//                      [--dry-run] [--max-cost <usd>]
//
// For every run: a fresh temp clone of the task repo at its pinned commit,
// then `claude -p "<prompt>" --output-format json --model <m> --max-turns 40`
// (plus `--plugin-dir <this repo>` for the thinwindow condition), then the
// task's `verify` command. Each run is appended to
// bench/results/<date>-<model>.jsonl. See bench/README.md.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { CONDITIONS, DEFAULT_MAX_TURNS, buildClaudeArgs, claudeEnv, claudeVersion, parseResult, parseTrace } from './lib/claude.mjs';
import { ROOT_DIR } from './lib/paths.mjs';
import { PRIOR_RUN_TOKENS, costOf, priceOf, resolveModel } from './lib/pricing.mjs';
import { runProcess, runSync, tail, which } from './lib/proc.mjs';
import { appendResult, readResults, resultsPath } from './lib/results.mjs';
import { median } from './lib/stats.mjs';
import { loadTasks, repoLabel } from './lib/tasks.mjs';
import { cloneAt, makeWorkdir, removeWorkdir, runSetup, runVerify } from './lib/workspace.mjs';
import { loadState, statePath } from '../hooks/lib/state.mjs';

const USAGE = `usage: node bench/run.mjs --condition baseline|thinwindow --reps N --model <m> [options]

  --condition <c>     baseline, thinwindow, or both as "baseline,thinwindow" (interleaved)
  --reps <n>          repetitions per task and condition (default 1)
  --model <m>         model passed to claude --model (alias or full id)
  --tasks <ids>       comma-separated task ids (default: all in bench/tasks)
  --dry-run           print the plan and a cost estimate; run nothing
  --max-cost <usd>    stop starting runs once the cumulative cost reaches this
  --max-turns <n>     claude --max-turns (default ${DEFAULT_MAX_TURNS})
  --claude <path>     claude executable (default: claude on PATH)
  --bare              pass --bare to claude (needs ANTHROPIC_API_KEY)
  --out <file>        results file (default bench/results/<date>-<model>.jsonl)
  --keep              keep the temp clones for inspection
  --est-run-usd <x>   dry run: use this cost per run instead of the estimate
  -h, --help          show this help`;

export class UsageError extends Error {}

// Claude Code didn't start (not logged in, no sandbox support...): stop
// instead of recording a run that never happened.
export class StartupError extends Error {}

export function parseCli(argv) {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv,
      options: {
        condition: { type: 'string' },
        reps: { type: 'string', default: '1' },
        model: { type: 'string' },
        tasks: { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'max-cost': { type: 'string' },
        'max-turns': { type: 'string', default: String(DEFAULT_MAX_TURNS) },
        claude: { type: 'string', default: 'claude' },
        bare: { type: 'boolean', default: false },
        out: { type: 'string' },
        keep: { type: 'boolean', default: false },
        'est-run-usd': { type: 'string' },
        help: { type: 'boolean', short: 'h', default: false },
      },
    }));
  } catch (err) {
    throw new UsageError(err.message);
  }
  if (values.help) return { help: true };
  if (!values.condition) throw new UsageError('--condition is required');
  const conditions = values.condition.split(',').map((s) => s.trim()).filter(Boolean);
  for (const c of conditions) if (!CONDITIONS.includes(c)) throw new UsageError(`unknown condition "${c}" (use ${CONDITIONS.join(' or ')})`);
  if (!values.model) throw new UsageError('--model is required');
  const reps = Number(values.reps);
  if (!Number.isInteger(reps) || reps < 1) throw new UsageError('--reps must be a positive integer');
  const maxTurns = Number(values['max-turns']);
  if (!Number.isInteger(maxTurns) || maxTurns < 1) throw new UsageError('--max-turns must be a positive integer');
  const num = (name) => {
    if (values[name] === undefined) return null;
    const v = Number(values[name]);
    if (!Number.isFinite(v) || v < 0) throw new UsageError(`--${name} must be a non-negative number`);
    return v;
  };
  return {
    conditions: [...new Set(conditions)],
    reps,
    model: values.model,
    taskIds: values.tasks ? values.tasks.split(',').map((s) => s.trim()).filter(Boolean) : [],
    dryRun: values['dry-run'],
    maxCost: num('max-cost'),
    maxTurns,
    claude: { cmd: values.claude, prefixArgs: [] },
    bare: values.bare,
    out: values.out || null,
    keep: values.keep,
    estRunUsd: num('est-run-usd'),
  };
}

// Interleaves conditions and alternates which goes first on each rep, so
// neither condition always runs first (warm caches, time of day).
export function planRuns(tasks, conditions, reps) {
  const plan = [];
  for (let rep = 1; rep <= reps; rep++) {
    for (const task of tasks) {
      const order = rep % 2 === 1 ? conditions : [...conditions].reverse();
      for (const condition of order) plan.push({ task, condition, rep });
    }
  }
  return plan;
}

// Cost per planned run: the median cost of earlier runs of the same model
// (same task and condition when available), else a price-based prior.
export function estimateCost({ plan, model, history = [], estRunUsd = null }) {
  const resolved = resolveModel(model);
  const price = priceOf(model);
  const prior = price ? costOf(PRIOR_RUN_TOKENS, price) : null;
  const mine = history.filter((r) => r.model === model || r.modelResolved === resolved);
  const costs = (pred) => mine.filter(pred).map((r) => r.costUsd);
  const allMedian = median(costs(() => true));
  const basis = { override: 0, taskCondition: 0, task: 0, model: 0, prior: 0, unknown: 0 };
  let total = 0;
  const perRun = plan.map(({ task, condition }) => {
    let usd = null;
    if (estRunUsd !== null) {
      usd = estRunUsd;
      basis.override++;
    } else if ((usd = median(costs((r) => r.task === task.id && r.condition === condition))) !== null) {
      basis.taskCondition++;
    } else if ((usd = median(costs((r) => r.task === task.id))) !== null) {
      basis.task++;
    } else if (allMedian !== null) {
      usd = allMedian;
      basis.model++;
    } else if (prior !== null) {
      usd = prior;
      basis.prior++;
    } else {
      basis.unknown++;
    }
    if (usd !== null) total += usd;
    return usd;
  });
  return { perRun, total: basis.unknown ? null : total, basis, prior, price, resolved, historyRuns: mine.length };
}

function fmtUsd(v) {
  return v === null || v === undefined ? 'n/a' : `$${v.toFixed(2)}`;
}

function fmtMinutes(seconds) {
  return seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`;
}

export function formatPlan({ tasks, plan, options, estimate, outFile }) {
  const lines = [];
  const { conditions, reps, model, maxTurns, maxCost } = options;
  lines.push('thinwindow bench: dry run (nothing is cloned or run)');
  const price = estimate.price;
  lines.push(
    `model: ${model}${estimate.resolved !== model ? ` (${estimate.resolved})` : ''}` +
      (price
        ? `, $${price.input}/$${price.output} per MTok in/out, cache write $${price.cacheWrite}, cache read $${price.cacheRead}`
        : ', price unknown'),
  );
  lines.push(`conditions: ${conditions.join(', ')} · reps: ${reps} · max turns: ${maxTurns}`);
  lines.push(`results: ${relative(process.cwd(), outFile) || outFile}`);
  lines.push('');
  const w = Math.max(4, ...tasks.map((t) => t.id.length));
  lines.push(`${'task'.padEnd(w)}  ${'repo@commit'.padEnd(30)}  timeout  runs`);
  for (const t of tasks) {
    const runs = plan.filter((p) => p.task.id === t.id).length;
    lines.push(`${t.id.padEnd(w)}  ${`${repoLabel(t.repo)}@${t.commit.slice(0, 7)}`.padEnd(30)}  ${fmtMinutes(t.timeout).padStart(7)}  ${String(runs).padStart(4)}`);
  }
  lines.push('');
  lines.push(`total: ${tasks.length} task${tasks.length > 1 ? 's' : ''} × ${conditions.length} condition${conditions.length > 1 ? 's' : ''} × ${reps} rep${reps > 1 ? 's' : ''} = ${plan.length} run${plan.length === 1 ? '' : 's'}`);
  lines.push('');
  const b = estimate.basis;
  const sources = [];
  if (b.override) sources.push(`${b.override} from --est-run-usd`);
  if (b.taskCondition) sources.push(`${b.taskCondition} from earlier runs of the same task and condition`);
  if (b.task) sources.push(`${b.task} from earlier runs of the same task`);
  if (b.model) sources.push(`${b.model} from earlier runs of this model`);
  if (b.prior) {
    const p = PRIOR_RUN_TOKENS;
    sources.push(
      `${b.prior} from a rough prior of ${fmtUsd(estimate.prior)} per run (no results for this model yet; assumes ` +
        `${p.input / 1000}k input, ${p.cacheCreation / 1000}k cache-write, ${p.cacheRead / 1000}k cache-read, ${p.output / 1000}k output tokens)`,
    );
  }
  if (b.unknown) sources.push(`${b.unknown} unknown: no price for this model; pass --est-run-usd`);
  lines.push(`cost estimate: ${estimate.total === null ? 'n/a' : `~${fmtUsd(estimate.total)}`} for ${plan.length} run${plan.length === 1 ? '' : 's'}`);
  for (const s of sources) lines.push(`  - ${s}`);
  if (maxCost !== null) {
    let acc = 0;
    let fit = 0;
    for (const c of estimate.perRun) {
      if (c === null || acc >= maxCost) break;
      acc += c;
      fit++;
    }
    lines.push(`--max-cost ${fmtUsd(maxCost)}: stops starting runs once reached (about ${fit} of ${plan.length} runs at this estimate)`);
  } else {
    lines.push('no --max-cost set');
  }
  return `${lines.join('\n')}\n`;
}

function thinwindowMeta() {
  const plugin = JSON.parse(readFileSync(join(ROOT_DIR, '.claude-plugin', 'plugin.json'), 'utf8'));
  const rev = runSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT_DIR, allowFail: true });
  const status = runSync('git', ['status', '--porcelain', '--', 'rules', 'hooks', 'skills', 'bin'], { cwd: ROOT_DIR, allowFail: true });
  return {
    thinwindowVersion: plugin.version,
    thinwindowCommit: rev.status === 0 ? rev.stdout.trim() : null,
    thinwindowDirty: status.status === 0 ? status.stdout.trim() !== '' : null,
    rulesChars: readFileSync(join(ROOT_DIR, 'rules', 'thinwindow.md'), 'utf8').length,
  };
}

// One run: clone, agent, verify. Always resolves to a record.
export async function runOne({ task, condition, rep, options, meta, env = process.env }) {
  const started = new Date();
  const dir = makeWorkdir(`${task.id}-${condition}`);
  const record = {
    v: 1,
    startedAt: started.toISOString(),
    task: task.id,
    repo: task.repo,
    commit: task.commit,
    condition,
    rep,
    model: options.model,
    modelResolved: resolveModel(options.model),
    maxTurns: options.maxTurns,
    bare: options.bare,
    ...meta,
  };
  try {
    cloneAt(task.repo, task.commit, dir);
    if (task.setup) {
      const setup = await runSetup(task, dir);
      // An environment problem that would hit both conditions: stop the benchmark.
      if (!setup.success) throw new StartupError(`setup failed for ${task.id}: ${setup.tail}`);
    }
    const agentEnv = claudeEnv(condition, env);
    // A Python task's setup makes .bench-venv; put it first on the agent's PATH.
    const venvBin = join(dir, '.bench-venv', 'bin');
    if (existsSync(venvBin)) agentEnv.PATH = `${venvBin}${delimiter}${agentEnv.PATH || ''}`;
    const args = buildClaudeArgs({ prompt: task.prompt, model: options.model, condition, maxTurns: options.maxTurns, bare: options.bare });
    const res = await runProcess(options.claude.cmd, [...options.claude.prefixArgs, ...args], {
      cwd: dir,
      env: agentEnv,
      timeoutMs: task.timeout * 1000,
    });
    const parsed = parseResult(res.stdout);
    // No JSON, or an error result before any tokens were used (for example
    // not logged in): an environment problem, not a benchmark result.
    if (options.abortOnStartupFailure && (!parsed || (parsed.isError && parsed.totalTokens === 0))) {
      throw new StartupError(`claude did not complete a single request (exit ${res.code}): ${tail(`${res.stderr}\n${res.stdout}`, 10, 1500)}`);
    }
    Object.assign(record, parsed || {
      inputTokens: null,
      cacheCreationTokens: null,
      cacheReadTokens: null,
      outputTokens: null,
      totalTokens: null,
      costUsd: null,
      numTurns: null,
      durationMs: res.durationMs,
      isError: true,
      subtype: 'unparsed_output',
      modelsUsed: [],
      sessionId: null,
    });
    record.trace = parseTrace(res.stdout);
    record.exitCode = res.code;
    record.timedOut = res.timedOut;
    record.wallMs = res.durationMs;
    if (!parsed || res.code !== 0) record.claudeStderr = tail(res.stderr, 10, 1000);
    const verify = await runVerify(task, dir);
    record.success = verify.success;
    record.verifyExitCode = verify.exitCode;
    record.verifyMs = verify.durationMs;
    if (!verify.success) {
      record.verifyTail = verify.tail;
      Object.assign(record, failureFootprint(dir, record.resultText));
    }
    delete record.resultText;
    if (condition === 'thinwindow' && record.sessionId) {
      record.thinwindow = loadState(statePath(record.sessionId)).stats || {};
    }
  } catch (err) {
    if (err instanceof StartupError) throw err;
    record.success = false;
    record.error = String(err.message || err);
  } finally {
    if (options.keep) record.workdir = dir;
    else removeWorkdir(dir);
  }
  return record;
}

// What the agent changed and said, so a failed run can be diagnosed after
// its temp clone is gone. Untracked files are marked intent-to-add so the
// diff includes them.
function failureFootprint(dir, resultText) {
  const git = (args) => runSync('git', args, { cwd: dir, allowFail: true }).stdout || '';
  git(['add', '-A', '-N']);
  return {
    agentStatus: tail(git(['status', '--short']), 40, 2000),
    agentDiff: git(['diff']).slice(0, 8000),
    agentFinal: tail(resultText, 30, 2000),
  };
}

function fmtTokens(n) {
  if (!Number.isFinite(n)) return 'n/a';
  return n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}k`;
}

export async function runBench(options, { log = (s) => process.stdout.write(s), env = process.env, tasks } = {}) {
  const list = tasks || loadTasks(options.taskIds);
  const plan = planRuns(list, options.conditions, options.reps);
  const outFile = options.out || resultsPath(options.model);
  const meta = { claudeVersion: claudeVersion(options.claude.cmd, options.claude.prefixArgs), ...thinwindowMeta() };
  const records = [];
  let cumulative = 0;
  let stopped = false;
  for (const [i, run] of plan.entries()) {
    if (options.maxCost !== null && cumulative >= options.maxCost) {
      log(`stopping: cumulative cost ${fmtUsd(cumulative)} reached --max-cost ${fmtUsd(options.maxCost)} after ${i} of ${plan.length} runs\n`);
      stopped = true;
      break;
    }
    log(`[${i + 1}/${plan.length}] ${run.task.id} · ${run.condition} · rep ${run.rep} ... `);
    let record;
    try {
      record = await runOne({ ...run, options: { ...options, abortOnStartupFailure: i === 0 }, meta, env });
    } catch (err) {
      if (!(err instanceof StartupError)) throw err;
      log(`aborted\n${err.message}\nNothing was recorded. Check that \`claude -p\` works here and that the sandbox is available (https://code.claude.com/docs/en/sandboxing).\n`);
      return { records, cumulative, stopped: true, aborted: true, outFile };
    }
    appendResult(outFile, record);
    records.push(record);
    cumulative += Number.isFinite(record.costUsd) ? record.costUsd : 0;
    log(
      record.error
        ? `error: ${record.error}\n`
        : `${record.success ? 'pass' : 'FAIL'} · ${fmtTokens(record.totalTokens)} tokens · ${fmtUsd(record.costUsd)} · ${record.numTurns ?? '?'} turns · ${Math.round((record.wallMs || 0) / 1000)}s${record.timedOut ? ' (timed out)' : ''}\n`,
    );
  }
  log(`${records.length} runs, ${fmtUsd(cumulative)} total, appended to ${outFile}\n`);
  return { records, cumulative, stopped, outFile };
}

async function main() {
  let options;
  try {
    options = parseCli(process.argv.slice(2));
  } catch (err) {
    if (err instanceof UsageError) {
      console.error(`error: ${err.message}\n\n${USAGE}`);
      process.exitCode = 2;
      return;
    }
    throw err;
  }
  if (options.help) {
    console.log(USAGE);
    return;
  }
  let tasks;
  try {
    tasks = loadTasks(options.taskIds);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exitCode = 2;
    return;
  }
  const outFile = options.out || resultsPath(options.model);
  if (options.dryRun) {
    const plan = planRuns(tasks, options.conditions, options.reps);
    let history = [];
    try {
      history = readResults();
    } catch (err) {
      console.error(`warning: ignoring earlier results: ${err.message}`);
    }
    const estimate = estimateCost({ plan, model: options.model, history, estRunUsd: options.estRunUsd });
    process.stdout.write(formatPlan({ tasks, plan, options, estimate, outFile }));
    const missing = [options.claude.cmd, 'git', 'bash', 'python3', 'npm'].filter((c) => !which(c));
    if (missing.length) process.stdout.write(`note: not found on PATH (needed for a real run): ${missing.join(', ')}\n`);
    return;
  }
  if (!claudeVersion(options.claude.cmd)) {
    console.error(`error: could not run "${options.claude.cmd} --version"; install Claude Code or pass --claude <path>`);
    process.exitCode = 2;
    return;
  }
  const { records, aborted } = await runBench({ ...options, out: outFile }, { tasks });
  if (aborted || records.some((r) => r.error)) process.exitCode = 1;
}

function isMain() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) main();
