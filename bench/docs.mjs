#!/usr/bin/env node
// Generates bench/results/report.json, the machine-readable summary of the
// 0.3.0 benchmark rows (bench/results/*.jsonl), so none of its numbers is
// typed by hand. https://ivanluna.dev reads it straight from this repository,
// so its shape is a public contract: add fields, don't rename or remove them.
//
//   node bench/docs.mjs            write report.json
//   node bench/docs.mjs --check    exit 1 if it is out of date
//
// The READMEs and the site quote no benchmark numbers. 0.4.0's results are in
// bench/results/0.4.0/ (bench/report.mjs).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR, RESULTS_DIR } from './lib/paths.mjs';
import { priceOf } from './lib/pricing.mjs';
import { listResultFiles, readResultFile } from './lib/results.mjs';
import { summarize } from './report.mjs';

const REPORT_JSON = join(RESULTS_DIR, 'report.json');
// `surfaces` says what 0.3.0 said; the note says what 0.4.0 did instead.
const NOTE =
  'Measured with the 0.3.0 method, in Claude Code. Instead of measuring savings in Cowork and the Claude apps, ThinWindow 0.4.0 checked what works on each surface (#29, #39); no savings were measured outside Claude Code.';

// Opus before Sonnet before Haiku, newest version first: the order a reader
// expects, not the alphabetical order the raw files happen to have.
const FAMILY_RANK = { opus: 0, sonnet: 1, haiku: 2, fable: 3 };

// claude-opus-5-5 -> { family: 'opus', label: 'Opus 5.5' }
export function modelLabel(id) {
  const m = /^(?:claude-)?([a-z]+)((?:-\d+)*)/.exec(id);
  if (!m) return { family: id, label: id };
  const family = m[1];
  const version = m[2].replace(/^-/, '').replace(/-/g, '.');
  return { family, label: version ? `${family[0].toUpperCase()}${family.slice(1)} ${version}` : family };
}

function byModel(a, b) {
  const fa = FAMILY_RANK[a.family] ?? 9;
  const fb = FAMILY_RANK[b.family] ?? 9;
  return fa - fb || b.label.localeCompare(a.label, 'en', { numeric: true });
}

const KINDS = { input: 'inputTokens', cacheWrite: 'cacheCreationTokens', cacheRead: 'cacheReadTokens', output: 'outputTokens' };

function shares(runs, weight) {
  const parts = Object.fromEntries(Object.entries(KINDS).map(([k, f]) => [k, runs.reduce((a, r) => a + (r[f] || 0) * weight(r, k), 0)]));
  const total = Object.values(parts).reduce((a, b) => a + b, 0);
  return total ? Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, (100 * v) / total])) : null;
}

// Share of every billed token that was a cache read, a cache write or output,
// over the runs of one condition. Input is the remaining fraction of a percent.
export function tokenMix(runs) {
  return shares(runs, () => 1);
}

// The same split as a share of the cost: each kind of token at its list price
// (bench/lib/pricing.mjs). A cache read costs a tenth of an input token or
// less and output five times one, so this mix is nothing like tokenMix.
export function costMix(runs) {
  return shares(runs, (r, k) => priceOf(r.modelResolved || r.model)?.[k] ?? NaN);
}

// What the totals would be if no task had regressed: every task that cost
// more with ThinWindow clamped to its baseline, nothing else saved. It is the
// ceiling of "stop making short tasks worse", quoted on the site and in the
// READMEs, so it is derived here rather than recomputed by hand.
export function headroom(tasks) {
  const paired = tasks.filter((t) => t.baseline.medianTokens !== null && t.thinwindow.medianTokens !== null);
  const base = paired.reduce((a, t) => a + t.baseline.medianTokens, 0);
  const clamped = paired.reduce((a, t) => a + Math.min(t.thinwindow.medianTokens, t.baseline.medianTokens), 0);
  return {
    regressingTasks: paired.filter((t) => t.tokensDelta > 0).length,
    tokensDeltaNoRegressions: base ? (100 * (clamped - base)) / base : null,
  };
}

// The public summary. One entry per model, richest first.
export function buildReport(files = listResultFiles()) {
  const sources = new Map(); // model -> result files it came from
  const records = [];
  for (const file of files) {
    for (const r of readResultFile(file)) {
      records.push(r);
      const model = r.modelResolved || r.model;
      if (!sources.has(model)) sources.set(model, new Set());
      sources.get(model).add(relative(ROOT_DIR, file).replace(/\\/g, '/'));
    }
  }
  const models = summarize(records)
    .map((s) => {
      const { family, label } = modelLabel(s.model);
      const runs = records.filter((r) => (r.modelResolved || r.model) === s.model);
      return {
        id: s.model,
        family,
        label,
        requested: s.requested,
        claudeVersions: s.claudeVersions,
        thinwindow: s.thinwindow,
        date: s.firstDate === s.lastDate ? s.firstDate : `${s.firstDate} to ${s.lastDate}`,
        runs: s.runs,
        reps: s.reps,
        resultFiles: [...(sources.get(s.model) || [])].sort(),
        // Baseline only: the mix is the problem statement, not the result.
        tokenMix: tokenMix(runs.filter((r) => r.condition === 'baseline')),
        costMix: costMix(runs.filter((r) => r.condition === 'baseline')),
        tasks: s.tasks,
        total: { ...s.total, ...headroom(s.tasks) },
      };
    })
    .sort(byModel);
  return {
    generatedBy: 'bench/docs.mjs',
    schema: 1,
    surfaces: { measured: ['Claude Code'], notMeasuredYet: ['Cowork', 'Claude apps'] },
    note: NOTE,
    tasks: [...new Set(records.map((r) => r.task))].sort().length,
    runs: records.length,
    models,
  };
}

// True when report.json differs from what the committed runs give.
export function outOfDate() {
  let current = null;
  try {
    current = readFileSync(REPORT_JSON, 'utf8');
  } catch {}
  return current === `${JSON.stringify(buildReport(), null, 2)}\n` ? [] : [REPORT_JSON];
}

function main() {
  const json = `${JSON.stringify(buildReport(), null, 2)}\n`;
  let current = null;
  try {
    current = readFileSync(REPORT_JSON, 'utf8');
  } catch {}
  if (current === json) return console.log('report.json already up to date');
  if (process.argv.includes('--check')) {
    console.error('out of date: report.json (run npm run bench:docs)');
    process.exitCode = 1;
    return;
  }
  writeFileSync(REPORT_JSON, json);
  console.log(`updated ${relative(ROOT_DIR, REPORT_JSON)}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
