#!/usr/bin/env node
// thinwindow benchmark runner.
//
//   node bench/run.mjs --condition baseline|thinwindow --reps N --model <m> [--tasks ids]
//                      [--dry-run] [--max-cost <usd>]
//   node bench/run.mjs --chains 1,2,3 --condition baseline,thinwindow --reps N --model <m>
//
// For every run: a fresh temp clone of the task repo at its pinned commit,
// then `claude -p "<prompt>" --output-format json --model <m> --max-turns 40`
// (plus `--plugin-dir <this repo>` for the thinwindow condition), then the
// task's `verify` command. Each run is appended to
// bench/results/<version>/<date>-<model>.jsonl. See bench/README.md.
import { randomInt } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { delimiter, dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { CONDITIONS, DEFAULT_MAX_TURNS, buildClaudeArgs, claudeEnv, claudeVersion, configDir, hostFingerprint, parseInit, parseResult, parseTrace, parseTraceTails, runFingerprint } from './lib/claude.mjs';
import { ROOT_DIR } from './lib/paths.mjs';
import { PRIOR_RUN_TOKENS, costOf, priceOf, resolveModel } from './lib/pricing.mjs';
import { runProcess, runSync, tail, which } from './lib/proc.mjs';
import { appendResult, readResults, resultsPath, versionDir } from './lib/results.mjs';
import { median, mulberry32, shuffle } from './lib/stats.mjs';
import { loadTask, loadTasks, repoLabel } from './lib/tasks.mjs';
import { isPublicRepo, keepTranscript, scrubber } from './lib/transcripts.mjs';
import { cloneAt, makeWorkdir, removeWorkdir, runSetup, runVerify } from './lib/workspace.mjs';
import { loadState, statePath } from '../hooks/lib/state.mjs';
import { Budget, CHAINS, runJob } from './experiments/resume.mjs';

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
  --out <file>        results file (default bench/results/<version>/<date>-<model>.jsonl)
  --keep              keep the temp clones for inspection
  --est-run-usd <x>   dry run: use this cost per run instead of the estimate

0.4.0 harness (#37), the same for both conditions:
  --seed <n>          seed of the random condition order per pair (default: random, recorded)
  --tools <list>      claude --tools (built-in tools available)
  --disallowed-tools <list>  claude --disallowedTools
  --agent <name>      claude --agent (not a user agent: the bench doesn't load them; use --disallowed-tools)
  --account <label>   account label, recorded hashed
  --keep-transcripts  keep each run's session, scrubbed, in <results dir>/transcripts/ (public repos only)
  --chains <ids>      run #32's chains (A, then B in the same clone) instead of single tasks:
                      the baseline continues A's session, thinwindow starts fresh with
                      /thinwindow:resume (ids 1-${CHAINS.length})
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
        seed: { type: 'string' },
        tools: { type: 'string' },
        'disallowed-tools': { type: 'string' },
        agent: { type: 'string' },
        account: { type: 'string' },
        'keep-transcripts': { type: 'boolean', default: false },
        chains: { type: 'string' },
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
  const seed = values.seed === undefined ? randomInt(2 ** 31) : Number(values.seed);
  if (!Number.isInteger(seed) || seed < 0) throw new UsageError('--seed must be a non-negative integer');
  let chains = null;
  if (values.chains !== undefined) {
    chains = values.chains.split(',').map((s) => Number(s.trim()));
    if (!chains.length || chains.some((c) => !Number.isInteger(c) || c < 1 || c > CHAINS.length)) throw new UsageError(`--chains takes ids from 1 to ${CHAINS.length}`);
    if (values.tasks) throw new UsageError('--chains and --tasks are exclusive');
  }
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
    seed,
    tools: values.tools ?? null,
    disallowedTools: values['disallowed-tools'] ?? null,
    agent: values.agent ?? null,
    account: values.account ?? null,
    keepTranscripts: values['keep-transcripts'],
    chains,
  };
}

// Interleaves conditions so neither always runs first (warm caches, time of
// day). With a seed, the order of each task's pair is random (#37); without
// one, it alternates per rep, as 0.3.0 ran.
export function planRuns(tasks, conditions, reps, seed = null) {
  const rand = seed === null || seed === undefined ? null : mulberry32(seed);
  const plan = [];
  for (let rep = 1; rep <= reps; rep++) {
    for (const task of tasks) {
      const order = rand ? shuffle(conditions, rand) : rep % 2 === 1 ? conditions : [...conditions].reverse();
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
  // By the model the run used: `sonnet` meant Sonnet 5 before 5.5 (#21).
  const mine = history.filter((r) => (r.modelResolved || resolveModel(r.model)) === resolved);
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
  lines.push(`conditions: ${conditions.join(', ')} · reps: ${reps} · max turns: ${maxTurns}${options.seed !== undefined && options.seed !== null ? ` · order seed: ${options.seed}` : ''}`);
  const harness = [['--tools', options.tools], ['--disallowedTools', options.disallowedTools], ['--agent', options.agent]].filter(([, v]) => v);
  if (harness.length) lines.push(`both conditions: ${harness.map(([k, v]) => `${k} ${v}`).join(' ')}`);
  if (options.keepTranscripts) lines.push('transcripts: kept, scrubbed, next to the results (public repos only)');
  if (options.account === null) lines.push('no --account: the rows record no account label');
  lines.push(`results: ${relative(process.cwd(), outFile) || outFile}`);
  lines.push('');
  const w = Math.max(4, ...tasks.map((t) => t.id.length));
  lines.push(`${'task'.padEnd(w)}  ${'repo@commit'.padEnd(30)}  timeout  runs`);
  for (const t of tasks) {
    const runs = plan.filter((p) => p.task.id === t.id).length;
    lines.push(`${t.id.padEnd(w)}  ${`${repoLabel(t.repo)}@${t.commit.slice(0, 7)}`.padEnd(30)}  ${fmtMinutes(t.timeout).padStart(7)}  ${String(runs).padStart(4)}`);
  }
  lines.push('');
  const units = options.chains ? `${options.chains.length} chain${options.chains.length > 1 ? 's' : ''}` : `${tasks.length} task${tasks.length > 1 ? 's' : ''}`;
  lines.push(`total: ${units} × ${conditions.length} condition${conditions.length > 1 ? 's' : ''} × ${reps} rep${reps > 1 ? 's' : ''} = ${plan.length} run${plan.length === 1 ? '' : 's'}${options.chains ? ' (A and B each)' : ''}`);
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

// Every row of an invocation shares these: what ran, where, and how.
function invocationMeta(options) {
  return {
    claudeVersion: claudeVersion(options.claude.cmd, options.claude.prefixArgs),
    ...thinwindowMeta(),
    ...hostFingerprint({ account: options.account }),
    orderSeed: options.seed ?? null,
    toolList: options.tools ?? null,
    disallowedTools: options.disallowedTools ?? null,
    agent: options.agent ?? null,
  };
}

function pluginVersion() {
  return JSON.parse(readFileSync(join(ROOT_DIR, '.claude-plugin', 'plugin.json'), 'utf8')).version;
}

export function defaultOut(options, version = pluginVersion()) {
  return options.out || resultsPath(options.chains ? `${options.model}-chains` : options.model, { dir: versionDir(version) });
}

function thinwindowMeta() {
  const rev = runSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT_DIR, allowFail: true });
  const status = runSync('git', ['status', '--porcelain', '--', 'rules', 'hooks', 'skills', 'bin'], { cwd: ROOT_DIR, allowFail: true });
  return {
    thinwindowVersion: pluginVersion(),
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
    const args = buildClaudeArgs({
      prompt: task.prompt,
      model: options.model,
      condition,
      maxTurns: options.maxTurns,
      bare: options.bare,
      persist: Boolean(options.keepTranscripts),
      tools: options.tools ?? null,
      disallowedTools: options.disallowedTools ?? null,
      agent: options.agent ?? null,
    });
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
    // The model that did the work, not the alias table's guess (#21).
    if (record.modelsUsed?.length) record.modelResolved = resolveModel(record.modelsUsed[0]);
    // Effort isn't pinned (Claude Code's default for the model); recorded as
    // Claude Code reports it, or as the env override, or as "default".
    record.effort = parseInit(res.stdout)?.effort ?? agentEnv.CLAUDE_CODE_EFFORT_LEVEL ?? 'default';
    Object.assign(record, runFingerprint(res.stdout));
    record.trace = parseTrace(res.stdout);
    record.traceTails = parseTraceTails(res.stdout);
    // For the manual review of final messages (#38).
    record.finalMessage = record.resultText ? scrubber({ clone: dir })(record.resultText).slice(0, 8000) : null;
    if (options.keepTranscripts && isPublicRepo(task.repo) && options.out) {
      record.transcript = keepTranscript(record.sessionId, { outDir: dirname(options.out), clone: dir });
    }
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

// #32's chains under the harness: one job per chain, rep and condition, in a
// seeded random order per pair; resume.mjs runs each job and writes its A and
// B rows.
export async function runChains(options, { log = (s) => process.stdout.write(s) } = {}) {
  const outFile = defaultOut(options);
  const items = options.chains.map((chain) => ({ id: `chain-${chain}`, chain }));
  const plan = planRuns(items, options.conditions, options.reps, options.seed);
  const env = { ...invocationMeta(options), kind: 'chain', maxTurns: options.maxTurns, bare: options.bare };
  const budget = new Budget(options.maxCost);
  for (const [i, { task, condition, rep }] of plan.entries()) {
    log(`[${i + 1}/${plan.length}] ${task.id} · ${condition} · rep ${rep}\n`);
    const arm = condition === 'baseline' ? 'continue' : 'fresh';
    await runJob({ chain: task.chain, rep, model: options.model, budget, env, out: outFile, log, condition, arms: [arm], run: { ...options, harness: true } });
  }
  log(`spent $${budget.spent.toFixed(2)}; rows appended to ${outFile}\n`);
  return { outFile, spent: budget.spent };
}

export async function runBench(options, { log = (s) => process.stdout.write(s), env = process.env, tasks } = {}) {
  const list = tasks || loadTasks(options.taskIds);
  const plan = planRuns(list, options.conditions, options.reps, options.seed);
  const outFile = defaultOut(options);
  const meta = invocationMeta(options);
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
      record = await runOne({ ...run, options: { ...options, out: outFile, abortOnStartupFailure: i === 0 }, meta, env });
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
  let chainPlan = null;
  try {
    if (options.chains) {
      // The task-level plan of the chains, for the estimate: B is priced as a
      // fresh run, so a cold continue costs more than estimated.
      chainPlan = planRuns(options.chains.map((chain) => ({ id: `chain-${chain}`, chain })), options.conditions, options.reps, options.seed);
      tasks = [...new Set(options.chains.flatMap((c) => CHAINS[c - 1]))].map((id) => loadTask(id));
    } else tasks = loadTasks(options.taskIds);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exitCode = 2;
    return;
  }
  const outFile = defaultOut(options);
  if (options.dryRun) {
    const plan = chainPlan
      ? chainPlan.flatMap((p) => CHAINS[p.task.chain - 1].map((id) => ({ task: tasks.find((t) => t.id === id), condition: p.condition, rep: p.rep })))
      : planRuns(tasks, options.conditions, options.reps, options.seed);
    if (chainPlan) process.stdout.write(`chains, in run order (A then B per line): ${chainPlan.map((p) => `${p.task.id}/${p.condition}/rep ${p.rep}`).join(', ')}\n`);
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
  // --setting-sources project,local leaves user agents out, so a copied-in
  // agent is never loaded and every run fails with "not found" (#38).
  if (options.agent && existsSync(join(configDir(), 'agents', `${options.agent}.md`))) {
    console.error(`error: "${options.agent}" is a user agent, and the bench's --setting-sources project,local doesn't load user agents; pass its tools with --disallowed-tools instead`);
    process.exitCode = 2;
    return;
  }
  if (options.chains) {
    await runChains({ ...options, out: outFile });
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
