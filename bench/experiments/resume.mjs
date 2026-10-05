#!/usr/bin/env node
// Resume experiment (#32): task A is done, then task B arrives on a cold
// cache. Three ways to do B, each from the same A:
//
//   continue  resume A's session (forked) and send B
//   compact   resume A's session (forked), /compact, then send B
//   brief     a fresh session: a short brief built from A's transcript, then B
//
//   node bench/experiments/resume.mjs --dry-run [--model m] [--reps n]
//   node bench/experiments/resume.mjs --check-solutions
//   node bench/experiments/resume.mjs --model claude-sonnet-5-5 --reps 2 [--parallel 3] [--max-cost 3.5]
//   node bench/experiments/resume.mjs --analyze bench/results/experiments/resume-<date>.jsonl
//
// Runs use the benchmark's settings (sandbox, no user settings, no MCP, no
// ThinWindow), except that sessions are kept so B can resume A. Nobody waits
// an hour: the cold penalty is computed as the first request of the resume
// event's cache reads × (1h cache write − cache read price). Claude Code
// reports a resumed session's cost cumulatively (A's cost included), so the
// analysis subtracts what was carried. Records keep
// usage, tool-call traces and check results, never raw transcripts (those
// carry account details; run.mjs --chains --keep-transcripts keeps scrubbed
// ones). See bench/results/experiments/resume.md.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { BRIEF_MAX_CHARS, buildBrief, latestBrief, relPath } from '../../hooks/lib/brief.mjs';
import { buildClaudeArgs, claudeEnv, claudeVersion, configDir, hostFingerprint, parseInit, parseResult, parseTrace, runFingerprint } from '../lib/claude.mjs';
import { RESULTS_DIR, ROOT_DIR, SOLUTIONS_DIR } from '../lib/paths.mjs';
import { priceOf, resolveModel } from '../lib/pricing.mjs';
import { runProcess, runSync } from '../lib/proc.mjs';
import { appendResult, localDate, readResultFile, readResults } from '../lib/results.mjs';
import { median } from '../lib/stats.mjs';
import { loadTask } from '../lib/tasks.mjs';
import { isPublicRepo, keepTranscript, scrubber, sessionRecords } from '../lib/transcripts.mjs';
import { cloneAt, makeWorkdir, removeWorkdir, runSetup, runVerify } from '../lib/workspace.mjs';

export const CHAINS = [
  ['commander-ci-config', 'commander-rename-display-width'],
  ['commander-rename-display-width', 'commander-extract-utils'],
  ['commander-extract-utils', 'commander-rename-display-width'],
];
export const ARMS = ['continue', 'compact', 'brief'];
const EXPERIMENTS_DIR = join(RESULTS_DIR, 'experiments');
const COMPACT_EST_USD = 0.03;

// --- The brief: hooks/lib/brief.mjs, shared with the Stop hook (#33) ---

export { BRIEF_MAX_CHARS, buildBrief, sessionRecords };

// --- Usage and costs ---

// Per-request usage from a stream-json run, one entry per message id.
export function requestsFromStream(stdout) {
  const byId = new Map();
  for (const line of String(stdout || '').split('\n')) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e?.type !== 'assistant' || !e.message?.usage) continue;
    const u = e.message.usage;
    byId.set(e.message.id || `n${byId.size}`, {
      input: u.input_tokens || 0,
      cacheRead: u.cache_read_input_tokens || 0,
      cacheWrite: u.cache_creation_input_tokens || 0,
      output: u.output_tokens || 0,
    });
  }
  return [...byId.values()];
}

// What a cold cache adds: the tokens read from cache would be written again.
export function coldPenaltyUsd(cacheReadTokens, price) {
  return (cacheReadTokens * (price.cacheWrite - price.cacheRead)) / 1e6;
}

export function readPaths(stdout, cwd = '') {
  const out = new Set();
  for (const line of String(stdout || '').split('\n')) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    for (const b of e?.type === 'assistant' && Array.isArray(e.message?.content) ? e.message.content : []) {
      if (b.type === 'tool_use' && b.name === 'Read' && b.input?.file_path) {
        const f = b.input.file_path;
        out.add(relPath(cwd, f));
      }
    }
  }
  return [...out];
}

// --- Running ---

// The benchmark's arguments, with the session kept: the baseline here, and
// either condition with the harness's tool settings when run.mjs --chains
// runs a chain (#37).
export function experimentArgs({ prompt, model, resume = null, fork = false, condition = 'baseline', maxTurns, tools = null, disallowedTools = null, agent = null }) {
  const args = buildClaudeArgs({ prompt, model, condition, maxTurns, tools, disallowedTools, agent, persist: true });
  if (resume) args.push('--resume', resume);
  if (fork) args.push('--fork-session');
  return args;
}

function git(dir, args) {
  return runSync('git', args, { cwd: dir, allowFail: true });
}

function saveDiff(dir) {
  git(dir, ['add', '-A']);
  const diff = git(dir, ['diff', '--cached', '--binary']).stdout || '';
  git(dir, ['reset', '-q']);
  return diff;
}

function restore(dir, diffFile, diff) {
  git(dir, ['checkout', '-q', '--', '.']);
  git(dir, ['clean', '-fdq']);
  if (diff.trim()) {
    const res = git(dir, ['apply', '--binary', diffFile]);
    if (res.status !== 0) throw new Error(`could not restore A's end state: ${res.stderr}`);
  }
}

export class Budget {
  constructor(max) {
    this.max = max;
    this.spent = 0;
  }

  ok() {
    return this.max === null || this.spent < this.max;
  }

  add(usd) {
    this.spent += Number.isFinite(usd) ? usd : 0;
  }
}

// `run`: the harness's options (claude executable, tool settings), or none.
async function claude(prompt, { dir, model, resume, fork, timeoutMs, budget, carried = 0, condition = 'baseline', run = {} }) {
  if (!budget.ok()) return { skipped: true };
  const { cmd, prefixArgs } = run.claude || { cmd: 'claude', prefixArgs: [] };
  const args = experimentArgs({ prompt, model, resume, fork, condition, maxTurns: run.maxTurns, tools: run.tools ?? null, disallowedTools: run.disallowedTools ?? null, agent: run.agent ?? null });
  const res = await runProcess(cmd, [...prefixArgs, ...args], {
    cwd: dir,
    env: claudeEnv(condition),
    timeoutMs,
  });
  const parsed = parseResult(res.stdout);
  budget.add((parsed?.costUsd ?? 0) - carried);
  return { res, parsed, init: parseInit(res.stdout), requests: requestsFromStream(res.stdout) };
}

function usageOf(run) {
  const p = run.parsed || {};
  return {
    costUsd: p.costUsd ?? null,
    numTurns: p.numTurns ?? null,
    inputTokens: p.inputTokens ?? null,
    cacheReadTokens: p.cacheReadTokens ?? null,
    cacheCreationTokens: p.cacheCreationTokens ?? null,
    outputTokens: p.outputTokens ?? null,
    isError: p.isError ?? true,
    subtype: p.subtype ?? 'unparsed_output',
  };
}

function rotate(list, k) {
  return list.map((_, i) => list[(i + k) % list.length]);
}

// Where ThinWindow keeps its data under the bench (--plugin-dir).
const pluginData = () => join(configDir(), 'plugins', 'data', 'thinwindow-inline');

// What every row of a harness run adds: the environment, the final message
// (for the manual review in #38) and, for public repos, the kept transcript.
function harnessFields(run, stdout, parsed, { dir, out, repo }) {
  if (!run.harness) return {};
  return {
    sessionId: parsed?.sessionId ?? null,
    ...runFingerprint(stdout),
    finalMessage: parsed?.resultText ? scrubber({ clone: dir })(parsed.resultText).slice(0, 8000) : null,
    transcript: run.keepTranscripts && isPublicRepo(repo) ? keepTranscript(parsed?.sessionId, { outDir: dirname(out), clone: dir }) : null,
  };
}

// One chain and repetition: A once, then B in every arm from A's end state.
// The harness (run.mjs --chains) runs one condition per job: A and B both
// under it, with one arm, `continue` for the baseline and `fresh` for
// ThinWindow: the user who accepts the fresh start, a new session with
// `/thinwindow:resume <B>` (no notice fires in -p, so the bench plays the user).
export async function runJob({ chain, rep, model, budget, env, out, log, condition = 'baseline', arms = ARMS, run = {}, tasks = CHAINS[chain - 1].map((id) => loadTask(id)) }) {
  const [taskA, taskB] = tasks;
  const price = priceOf(model);
  const dir = realpathSync(makeWorkdir(`resume-c${chain}-r${rep}`));
  let diffFile = null;
  const base = { v: 1, experiment: 'resume', chain, rep, taskA: taskA.id, taskB: taskB.id, model, modelResolved: resolveModel(model), ...env, condition };
  const call = (prompt, opts) => claude(prompt, { dir, model, budget, condition, run, ...opts });
  try {
    cloneAt(taskA.repo, taskA.commit, dir);
    const setup = taskA.setup ? await runSetup(taskA, dir) : { success: true };
    if (!setup.success) throw new Error(`setup failed: ${setup.tail}`);

    const a = await call(taskA.prompt, { timeoutMs: taskA.timeout * 1000 });
    if (a.skipped) return log(`c${chain} r${rep}: skipped, budget reached\n`);
    const aVerify = await runVerify(taskA, dir);
    const aSession = a.parsed?.sessionId;
    const aReads = readPaths(a.res.stdout, dir);
    appendResult(out, {
      ...base,
      phase: 'A',
      startedAt: new Date().toISOString(),
      effort: a.init?.effort ?? 'default',
      ...usageOf(a),
      requests: a.requests,
      aPass: aVerify.success,
      reads: aReads,
      trace: parseTrace(a.res.stdout),
      ...harnessFields(run, a.res.stdout, a.parsed, { dir, out, repo: taskA.repo }),
    });
    log(`c${chain} r${rep} A: ${aVerify.success ? 'pass' : 'FAIL'} $${(a.parsed?.costUsd ?? 0).toFixed(3)}\n`);
    if (!aSession) throw new Error('A returned no session id');

    const aCost = a.parsed?.costUsd ?? 0;
    const last = a.requests.at(-1) || {};
    const aContext = (last.input || 0) + (last.cacheRead || 0) + (last.cacheWrite || 0) + (last.output || 0);
    const diff = saveDiff(dir);
    diffFile = `${dir}-A.diff`;
    writeFileSync(diffFile, diff);
    const brief = arms.includes('brief') ? buildBrief(sessionRecords(aSession), { cwd: dir }) : null;
    // In -p, Stop doesn't fire on error_max_turns: A's brief can be missing.
    const briefFound = arms.includes('fresh') ? latestBrief(pluginData(), dir) !== null : null;

    for (const arm of rotate(arms, chain + rep)) {
      restore(dir, diffFile, diff);
      const timeoutMs = taskB.timeout * 1000;
      const invocations = [];
      let b;
      let coldReads = 0;
      if (arm === 'continue') {
        b = await call(taskB.prompt, { resume: aSession, fork: true, timeoutMs, carried: aCost });
        coldReads = b.requests?.[0]?.cacheRead ?? 0;
      } else if (arm === 'compact') {
        const c = await call('/compact', { resume: aSession, fork: true, timeoutMs, carried: aCost });
        if (!c.skipped) {
          invocations.push({ kind: 'compact', ...usageOf(c) });
          // /compact can make more than one request; a cold cache re-writes
          // at most A's context, so its cache reads are capped there.
          coldReads = Math.min(c.parsed?.cacheReadTokens ?? 0, aContext);
          const cSession = c.parsed?.sessionId;
          b = cSession ? await call(taskB.prompt, { resume: cSession, timeoutMs, carried: c.parsed?.costUsd ?? 0 }) : { skipped: true, error: 'compact returned no session id' };
        } else b = c;
      } else if (arm === 'fresh') {
        b = await call(`/thinwindow:resume ${taskB.prompt}`, { timeoutMs });
        coldReads = b.requests?.[0]?.cacheRead ?? 0;
      } else {
        b = await call(`${brief}\n\nNew request:\n${taskB.prompt}`, { timeoutMs });
        coldReads = b.requests?.[0]?.cacheRead ?? 0;
      }
      if (b.skipped) {
        appendResult(out, { ...base, phase: 'B', arm, skipped: true, error: b.error || 'budget reached' });
        log(`c${chain} r${rep} ${arm}: skipped\n`);
        continue;
      }
      invocations.push({ kind: 'task', ...usageOf(b) });
      const bVerify = await runVerify(taskB, dir);
      const aAfter = await runVerify(taskA, dir);
      const row = { arm, invocations };
      const warm = ownWarmUsd(row, aCost);
      const penalty = coldPenaltyUsd(coldReads, price);
      const bReads = readPaths(b.res.stdout, dir);
      appendResult(out, {
        ...base,
        phase: 'B',
        arm,
        startedAt: new Date().toISOString(),
        effort: b.init?.effort ?? 'default',
        invocations,
        requests: b.requests,
        numTurns: b.parsed?.numTurns ?? null,
        coldReadTokens: coldReads,
        coldPenaltyUsd: penalty,
        bPass: bVerify.success,
        aPass: aAfter.success,
        reReads: bReads.filter((f) => aReads.includes(f)),
        reads: bReads,
        briefChars: arm === 'brief' ? brief.length : null,
        brief: arm === 'brief' ? brief : null,
        ...(arm === 'fresh' ? { briefFound } : {}),
        trace: parseTrace(b.res.stdout),
        ...harnessFields(run, b.res.stdout, b.parsed, { dir, out, repo: taskB.repo }),
      });
      log(`c${chain} r${rep} ${arm}: B ${bVerify.success ? 'pass' : 'FAIL'}, A ${aAfter.success ? 'pass' : 'FAIL'}, $${warm.toFixed(3)} warm, $${(warm + penalty).toFixed(3)} cold\n`);
    }
  } catch (err) {
    appendResult(out, { ...base, phase: 'error', error: String(err.message || err) });
    log(`c${chain} r${rep}: error: ${err.message}\n`);
  } finally {
    removeWorkdir(dir);
    if (diffFile) removeWorkdir(diffFile);
  }
}

export function planJobs(reps, chains = [1, 2, 3]) {
  const jobs = [];
  for (let rep = 1; rep <= reps; rep++) for (const chain of chains) jobs.push({ chain, rep });
  return jobs;
}

function fingerprint(model) {
  const rev = runSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT_DIR, allowFail: true });
  return {
    claudeVersion: claudeVersion(),
    thinwindowCommit: rev.status === 0 ? rev.stdout.trim() : null,
    condition: 'baseline',
    ...hostFingerprint(),
    model,
  };
}

export async function runExperiment({ model, reps, parallel, maxCost, chains, log = (s) => process.stdout.write(s) }) {
  const out = join(EXPERIMENTS_DIR, `resume-${localDate()}.jsonl`);
  const env = fingerprint(model);
  const budget = new Budget(maxCost);
  const queue = planJobs(reps, chains);
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) await runJob({ ...job, model, budget, env, out, log });
  };
  await Promise.all(Array.from({ length: Math.max(1, parallel) }, worker));
  log(`spent $${budget.spent.toFixed(2)}; results in ${relative(process.cwd(), out)}\n`);
  return out;
}

// --- Reference solutions: both checks must pass with A's and B's patches ---

export async function checkSolutions({ log = (s) => process.stdout.write(s) } = {}) {
  let ok = true;
  for (const [i, ids] of CHAINS.entries()) {
    const [taskA, taskB] = ids.map((id) => loadTask(id));
    const dir = makeWorkdir(`resume-solutions-${i + 1}`);
    try {
      cloneAt(taskA.repo, taskA.commit, dir);
      const setup = await runSetup(taskA, dir);
      if (!setup.success) throw new Error(`setup failed: ${setup.tail}`);
      for (const t of [taskA, taskB]) {
        const res = git(dir, ['apply', join(SOLUTIONS_DIR, `${t.id}.patch`)]);
        if (res.status !== 0) throw new Error(`${t.id}.patch does not apply: ${res.stderr.trim()}`);
      }
      const a = await runVerify(taskA, dir);
      const b = await runVerify(taskB, dir);
      ok &&= a.success && b.success;
      log(`chain ${i + 1} (${taskA.id} → ${taskB.id}): A check ${a.success ? 'pass' : 'FAIL'}, B check ${b.success ? 'pass' : 'FAIL'}\n`);
    } catch (err) {
      ok = false;
      log(`chain ${i + 1}: ${err.message}\n`);
    } finally {
      removeWorkdir(dir);
    }
  }
  return ok;
}

// --- Dry run ---

export function estimate({ model, reps, chains = [1, 2, 3], history = readResults() }) {
  const resolved = resolveModel(model);
  const cost = (id) => median(history.filter((r) => r.task === id && r.condition === 'baseline' && (r.modelResolved || resolveModel(r.model)) === resolved).map((r) => r.costUsd));
  let total = 0;
  const lines = [];
  for (const c of chains) {
    const [a, b] = CHAINS[c - 1];
    const ca = cost(a);
    const cb = cost(b);
    if (ca === null || cb === null) return { total: null, lines: [`no ${resolved} baseline runs of ${a} or ${b} to estimate from`] };
    const chainUsd = reps * (ca + 3 * cb + COMPACT_EST_USD);
    total += chainUsd;
    lines.push(`chain ${c}: ${reps} × (A $${ca.toFixed(3)} + 3 B × $${cb.toFixed(3)} + compact ~$${COMPACT_EST_USD}) = $${chainUsd.toFixed(2)}`);
  }
  return { total, lines };
}

export function formatDryRun({ model, reps, parallel, maxCost, chains = [1, 2, 3] }) {
  const q = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`);
  const show = (args) => `claude ${args.map((a) => (a.startsWith('{') ? '<bench settings>' : a.length > 60 ? `${q(a.slice(0, 57))}…` : q(a))).join(' ')}`;
  const lines = [`resume experiment: dry run (nothing is cloned or run)`, `model: ${model} · reps: ${reps} · parallel jobs: ${parallel} · max cost: ${maxCost === null ? 'none' : `$${maxCost}`}`, ''];
  for (const { chain, rep } of planJobs(reps, chains)) {
    const [a, b] = CHAINS[chain - 1].map((id) => loadTask(id));
    lines.push(`chain ${chain} rep ${rep}: fresh clone of ${a.repo} @ ${a.commit.slice(0, 7)}, \`${a.setup}\``);
    lines.push(`  A  ${show(experimentArgs({ prompt: a.prompt, model }))}`);
    lines.push(`     then A's check; save A's diff; build the brief from A's transcript`);
    for (const arm of rotate(ARMS, chain + rep)) {
      lines.push(`  ${arm}: restore A's end state (git checkout -- . && git clean -fd && git apply A.diff)`);
      if (arm === 'continue') lines.push(`     ${show(experimentArgs({ prompt: b.prompt, model, resume: '<A>', fork: true }))}`);
      if (arm === 'compact') {
        lines.push(`     ${show(experimentArgs({ prompt: '/compact', model, resume: '<A>', fork: true }))}`);
        lines.push(`     ${show(experimentArgs({ prompt: b.prompt, model, resume: '<compacted>' }))}`);
      }
      if (arm === 'brief') lines.push(`     ${show(experimentArgs({ prompt: `<brief ≤ ${BRIEF_MAX_CHARS} chars>\n\nNew request:\n${b.prompt}`, model }))}`);
      lines.push(`     then B's check and A's check`);
    }
  }
  lines.push('', `<bench settings> = ${JSON.stringify(buildClaudeArgs({ prompt: '', model, condition: 'baseline' })[buildClaudeArgs({ prompt: '', model, condition: 'baseline' }).indexOf('--settings') + 1])}`);
  const est = estimate({ model, reps, chains });
  lines.push('', ...est.lines, est.total === null ? 'cost estimate: n/a' : `cost estimate: ~$${est.total.toFixed(2)} (medians of earlier baseline runs; compact assumed)`);
  return `${lines.join('\n')}\n`;
}

// --- Analysis ---

const sum = (a) => a.reduce((s, x) => s + x, 0);
const passBoth = (r) => r.bPass && r.aPass;

// Claude Code's total_cost_usd for a resumed session includes what the
// session had already cost (A's run, and the /compact call for the compacted
// session). The B phase's own cost: the last invocation's reported cost minus
// A's, except in the brief arm, which starts fresh.
export function ownWarmUsd(row, aCost) {
  const last = row.invocations.at(-1)?.costUsd ?? 0;
  return row.arm === 'brief' ? last : last - aCost;
}

// B rows with their own warm and cold costs.
export function costed(rows) {
  const aCost = new Map(rows.filter((r) => r.phase === 'A').map((r) => [`${r.chain}/${r.rep}`, r.costUsd ?? 0]));
  return rows
    .filter((r) => r.phase === 'B' && !r.skipped)
    .map((r) => {
      const warmUsd = ownWarmUsd(r, aCost.get(`${r.chain}/${r.rep}`) ?? 0);
      return { ...r, warmUsd, coldUsd: warmUsd + r.coldPenaltyUsd };
    });
}

export function summarize(rows) {
  const b = costed(rows);
  const arms = Object.fromEntries(
    ARMS.map((arm) => {
      const rs = b.filter((r) => r.arm === arm);
      return [
        arm,
        {
          runs: rs.length,
          passBoth: rs.filter(passBoth).length,
          bPass: rs.filter((r) => r.bPass).length,
          aPass: rs.filter((r) => r.aPass).length,
          warmUsd: sum(rs.map((r) => r.warmUsd)),
          coldUsd: sum(rs.map((r) => r.coldUsd)),
          firstColdUsd: sum(rs.map((r) => r.coldPenaltyUsd)),
          turns: median(rs.map((r) => r.numTurns ?? 0)),
          reReads: sum(rs.map((r) => r.reReads.length)),
        },
      ];
    }),
  );
  return { arms, errors: rows.filter((r) => r.phase === 'error').length, skipped: rows.filter((r) => r.skipped).length };
}

// The G2 outcome, by the criteria written in #32 before running. "Cost at the
// resume event" is the whole B phase (the /compact call included), cold
// penalty included.
export function outcome({ arms }) {
  const { continue: cont, compact, brief } = arms;
  const saving = cont.coldUsd ? 1 - brief.coldUsd / cont.coldUsd : 0;
  const compactGap = brief.coldUsd ? Math.abs(compact.coldUsd - brief.coldUsd) / brief.coldUsd : Infinity;
  const result = { saving, compactGap };
  if (brief.passBoth < cont.passBoth || saving < 0.1) return { ...result, verdict: 'stop' };
  if (compact.passBoth === brief.passBoth && compactGap <= 0.1) return { ...result, verdict: 'compact' };
  if (saving >= 0.25) return { ...result, verdict: 'go' };
  return { ...result, verdict: 'none' };
}

const VERDICT = {
  go: 'Go: build #33 and #34.',
  compact: 'Compact is enough: #34 recommends /compact; #33 shrinks to the optional /thinwindow:brief, or closes.',
  stop: 'Stop: close #33; #34 becomes an informational notice, or closes.',
  none: 'No outcome matched: the brief keeps success but saves between 10% and 25%.',
};

export function formatAnalysis(rows) {
  const usd = (x) => `$${x.toFixed(3)}`;
  const out = [];
  const env = rows.find((r) => r.claudeVersion) || {};
  out.push(`Claude Code ${env.claudeVersion} · ${env.modelResolved} · effort ${rows.find((r) => r.effort)?.effort ?? '?'} · profile ${env.profile} · ${env.os} · ThinWindow commit ${env.thinwindowCommit} (not loaded: baseline)`, '');
  out.push('| Chain | Rep | A | A check | Arm | B check | A check after | Turns | Warm | Cold penalty | Cold | Re-reads |');
  out.push('| ---: | ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |');
  const aRows = new Map(rows.filter((r) => r.phase === 'A').map((r) => [`${r.chain}/${r.rep}`, r]));
  for (const r of [...costed(rows), ...rows.filter((x) => x.phase === 'B' && x.skipped)].sort((x, y) => x.chain - y.chain || x.rep - y.rep || ARMS.indexOf(x.arm) - ARMS.indexOf(y.arm))) {
    const a = aRows.get(`${r.chain}/${r.rep}`) || {};
    if (r.skipped) {
      out.push(`| ${r.chain} | ${r.rep} | | | ${r.arm} | skipped | | | | | | |`);
      continue;
    }
    out.push(`| ${r.chain} | ${r.rep} | ${usd(a.costUsd ?? 0)} | ${a.aPass ? 'pass' : 'FAIL'} | ${r.arm} | ${r.bPass ? 'pass' : 'FAIL'} | ${r.aPass ? 'pass' : 'FAIL'} | ${r.numTurns} | ${usd(r.warmUsd)} | ${usd(r.coldPenaltyUsd)} | ${usd(r.coldUsd)} | ${r.reReads.length} |`);
  }
  const perChain = (chain) => summarize(rows.filter((r) => r.chain === chain)).arms;
  out.push('', '| Chain | Arm | Both checks | Warm total | Cold total | Median turns | Re-reads |', '| ---: | --- | ---: | ---: | ---: | ---: | ---: |');
  for (const chain of [...new Set(rows.map((r) => r.chain))].sort()) {
    const arms = perChain(chain);
    for (const arm of ARMS) out.push(`| ${chain} | ${arm} | ${arms[arm].passBoth}/${arms[arm].runs} | ${usd(arms[arm].warmUsd)} | ${usd(arms[arm].coldUsd)} | ${arms[arm].turns ?? ''} | ${arms[arm].reReads} |`);
  }
  const s = summarize(rows);
  out.push('', '| Overall | Both checks | B check | A check after | Warm total | Cold total | First-request cold penalty | Median turns | Re-reads |', '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const arm of ARMS) {
    const a = s.arms[arm];
    out.push(`| ${arm} | ${a.passBoth}/${a.runs} | ${a.bPass}/${a.runs} | ${a.aPass}/${a.runs} | ${usd(a.warmUsd)} | ${usd(a.coldUsd)} | ${usd(a.firstColdUsd)} | ${a.turns ?? ''} | ${a.reReads} |`);
  }
  const o = outcome(s);
  out.push('', `Brief vs continue, cold, whole B phase: ${(o.saving * 100).toFixed(1)}% less. Compact vs brief, cold: ${(o.compactGap * 100).toFixed(1)}% apart.`);
  out.push(`G2: ${VERDICT[o.verdict]}`);
  if (s.errors || s.skipped) out.push(`Errors: ${s.errors}; skipped: ${s.skipped}.`);
  return `${out.join('\n')}\n`;
}

// --- CLI ---

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: 'string', default: 'claude-sonnet-5-5' },
      reps: { type: 'string', default: '2' },
      parallel: { type: 'string', default: '3' },
      'max-cost': { type: 'string', default: '3.5' },
      chains: { type: 'string', default: '1,2,3' },
      'dry-run': { type: 'boolean', default: false },
      'check-solutions': { type: 'boolean', default: false },
      analyze: { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    process.stdout.write(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 13).map((l) => l.replace(/^\/\/ ?/, '')).join('\n') + '\n');
    return;
  }
  if (values.analyze) {
    process.stdout.write(formatAnalysis(readResultFile(values.analyze)));
    return;
  }
  if (values['check-solutions']) {
    process.exitCode = (await checkSolutions()) ? 0 : 1;
    return;
  }
  const opts = {
    model: values.model,
    reps: Number(values.reps),
    parallel: Number(values.parallel),
    maxCost: values['max-cost'] === 'none' ? null : Number(values['max-cost']),
    chains: values.chains.split(',').map(Number),
  };
  if (values['dry-run']) {
    process.stdout.write(formatDryRun(opts));
    return;
  }
  await runExperiment(opts);
}

function isMain() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) main();
