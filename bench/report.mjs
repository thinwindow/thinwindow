#!/usr/bin/env node
// skinflint benchmark report: reads bench/results/*.jsonl and prints a
// markdown table per model (per task and in total: median tokens, cost,
// turns, success rate, Δ%), and writes an SVG bar chart per model.
//
//   node bench/report.mjs [results.jsonl ...] [--model <m>] [--out <dir>] [--no-write]
//
// Medians and min–max spread over all runs, failures included. Runs that
// produced no usage (an error before or inside claude) count toward the
// success rate only.
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { RESULTS_DIR } from './lib/paths.mjs';
import { listResultFiles, readResults } from './lib/results.mjs';
import { median, pctDelta, spread } from './lib/stats.mjs';

const CONDS = ['baseline', 'skinflint'];

function condStats(runs) {
  const withUsage = runs.filter((r) => Number.isFinite(r.totalTokens));
  const tokens = withUsage.map((r) => r.totalTokens);
  return {
    runs: runs.length,
    successes: runs.filter((r) => r.success === true).length,
    errors: runs.length - withUsage.length,
    medianTokens: median(tokens),
    tokenSpread: spread(tokens),
    medianCost: median(withUsage.map((r) => r.costUsd)),
    medianTurns: median(withUsage.map((r) => r.numTurns)),
  };
}

// Groups records by model (resolved id when present), then task and condition.
export function summarize(records) {
  const byModel = new Map();
  for (const r of records) {
    const model = r.modelResolved || r.model;
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model).push(r);
  }
  const out = [];
  for (const [model, runs] of [...byModel.entries()].sort()) {
    const taskIds = [...new Set(runs.map((r) => r.task))].sort();
    const tasks = taskIds.map((task) => {
      const row = { task };
      for (const c of CONDS) row[c] = condStats(runs.filter((r) => r.task === task && r.condition === c));
      row.tokensDelta = pctDelta(row.baseline.medianTokens, row.skinflint.medianTokens);
      row.costDelta = pctDelta(row.baseline.medianCost, row.skinflint.medianCost);
      return row;
    });
    const paired = tasks.filter((t) => t.baseline.medianTokens !== null && t.skinflint.medianTokens !== null);
    const sum = (c, k) => paired.reduce((a, t) => a + (t[c][k] ?? 0), 0);
    const total = { pairedTasks: paired.length };
    for (const c of CONDS) {
      const condRuns = runs.filter((r) => r.condition === c);
      total[c] = {
        runs: condRuns.length,
        successes: condRuns.filter((r) => r.success === true).length,
        errors: condRuns.filter((r) => !Number.isFinite(r.totalTokens)).length,
        tokens: sum(c, 'medianTokens'),
        cost: sum(c, 'medianCost'),
        turns: sum(c, 'medianTurns'),
      };
    }
    total.tokensDelta = pctDelta(total.baseline.tokens, total.skinflint.tokens);
    total.costDelta = pctDelta(total.baseline.cost, total.skinflint.cost);
    total.turnsDelta = pctDelta(total.baseline.turns, total.skinflint.turns);
    const dates = runs.map((r) => r.startedAt).filter(Boolean).sort();
    out.push({
      model,
      requested: [...new Set(runs.map((r) => r.model))],
      claudeVersions: [...new Set(runs.map((r) => r.claudeVersion).filter(Boolean))],
      skinflint: [...new Set(runs.map((r) => (r.skinflintCommit ? `${r.skinflintVersion} (${r.skinflintCommit}${r.skinflintDirty ? ', modified' : ''})` : r.skinflintVersion)).filter(Boolean))],
      firstDate: dates[0] ? dates[0].slice(0, 10) : null,
      lastDate: dates.length ? dates[dates.length - 1].slice(0, 10) : null,
      reps: Math.max(0, ...tasks.flatMap((t) => CONDS.map((c) => t[c].runs))),
      runs: runs.length,
      tasks,
      total,
    });
  }
  return out;
}

export function fmtTokens(n) {
  if (!Number.isFinite(n)) return '–';
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(Math.round(n));
}

function fmtUsd(n) {
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '–';
}

export function fmtPct(p) {
  if (!Number.isFinite(p)) return '–';
  const s = `${Math.abs(p).toFixed(1)}%`;
  return p < 0 ? `−${s}` : p > 0 ? `+${s}` : '0.0%';
}

function fmtNum(n) {
  return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(1)) : '–';
}

function fmtSpread(s) {
  return s ? `${fmtTokens(s.min)}–${fmtTokens(s.max)}` : '–';
}

function successCell(s) {
  return s.runs ? `${s.successes}/${s.runs}` : '–';
}

export function markdownReport(summaries) {
  const lines = [];
  for (const s of summaries) {
    lines.push(`## ${s.model}`);
    lines.push('');
    lines.push(
      `Model \`${s.model}\`${s.requested.some((m) => m !== s.model) ? ` (requested as ${s.requested.map((m) => `\`${m}\``).join(', ')})` : ''} · ` +
        `Claude Code ${s.claudeVersions.join(', ') || 'unknown'} · skinflint ${s.skinflint.join(', ') || 'unknown'} · ` +
        `${s.runs} runs, up to ${s.reps} per task and condition · ${s.firstDate === s.lastDate ? s.firstDate : `${s.firstDate} to ${s.lastDate}`}`,
    );
    lines.push('');
    lines.push('| Task | Tokens baseline (min–max) | Tokens skinflint (min–max) | Δ tokens | Cost baseline | Cost skinflint | Δ cost | Turns baseline | Turns skinflint | Success baseline | Success skinflint |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const t of s.tasks) {
      const b = t.baseline;
      const k = t.skinflint;
      lines.push(
        `| ${t.task} | ${fmtTokens(b.medianTokens)} (${fmtSpread(b.tokenSpread)}) | ${fmtTokens(k.medianTokens)} (${fmtSpread(k.tokenSpread)}) | ${fmtPct(t.tokensDelta)} | ` +
          `${fmtUsd(b.medianCost)} | ${fmtUsd(k.medianCost)} | ${fmtPct(t.costDelta)} | ${fmtNum(b.medianTurns)} | ${fmtNum(k.medianTurns)} | ${successCell(b)} | ${successCell(k)} |`,
      );
    }
    const T = s.total;
    lines.push(
      `| **Total** | **${fmtTokens(T.baseline.tokens)}** | **${fmtTokens(T.skinflint.tokens)}** | **${fmtPct(T.tokensDelta)}** | ` +
        `**${fmtUsd(T.baseline.cost)}** | **${fmtUsd(T.skinflint.cost)}** | **${fmtPct(T.costDelta)}** | ${fmtNum(T.baseline.turns)} | ${fmtNum(T.skinflint.turns)} | ` +
        `**${successCell(T.baseline)}** | **${successCell(T.skinflint)}** |`,
    );
    lines.push('');
    const errors = T.baseline.errors + T.skinflint.errors;
    lines.push(
      'Tokens are input + cache-creation + cache-read + output, summed over every model the run used. ' +
        'Per task: medians over all runs, failures included; min–max in parentheses. ' +
        `Total: sum of the per-task medians over the ${T.pairedTasks} tasks that have both conditions; success counts every run. ` +
        'Δ = (skinflint − baseline) / baseline. Cost is Claude Code\'s own estimate (`total_cost_usd`), not a bill. ' +
        'The skinflint rules and thresholds were tuned on these same tasks.' +
        (errors ? ` ${errors} run(s) ended without usage data and count as failures.` : ''),
    );
    lines.push('');
  }
  return lines.join('\n');
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function niceStep(max) {
  const raw = max / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * pow >= raw) return m * pow;
  return 10 * pow;
}

// Grouped horizontal bars: per task, median total tokens for baseline and
// skinflint, with the Δ next to each pair. Colors follow GitHub's light and
// dark themes through prefers-color-scheme; the table in the report is the
// accessible view of the same numbers.
export function svgChart(s) {
  const tasks = s.tasks.filter((t) => t.baseline.medianTokens !== null || t.skinflint.medianTokens !== null);
  const width = 760;
  const labelW = 230;
  const deltaW = 70;
  const plotX = labelW;
  const plotW = width - labelW - deltaW - 56;
  const barH = 10;
  const gap = 2;
  const groupH = barH * 2 + gap;
  const groupGap = 16;
  const top = 108;
  const height = top + tasks.length * (groupH + groupGap) + 34;
  const max = Math.max(1, ...tasks.flatMap((t) => [t.baseline.medianTokens || 0, t.skinflint.medianTokens || 0]));
  const step = niceStep(max);
  const axisMax = Math.ceil(max / step) * step;
  const x = (v) => plotX + (v / axisMax) * plotW;
  const T = s.total;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="t d">`);
  out.push(`<title id="t">skinflint benchmark: median total tokens per task, ${esc(s.model)}</title>`);
  out.push(
    `<desc id="d">Baseline versus skinflint, median total tokens per task. Total ${esc(fmtTokens(T.baseline.tokens))} versus ${esc(fmtTokens(T.skinflint.tokens))} (${esc(fmtPct(T.tokensDelta))}); success ${T.baseline.successes}/${T.baseline.runs} versus ${T.skinflint.successes}/${T.skinflint.runs}.</desc>`,
  );
  out.push(`<style>
  .t1{fill:#1f2328}.t2{fill:#59636e}.grid{stroke:#d1d9e0}.base{fill:#2a78d6}.skin{fill:#eb6834}
  text{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif}
  @media (prefers-color-scheme: dark){.t1{fill:#e6edf3}.t2{fill:#9198a1}.grid{stroke:#3d444d}.base{fill:#3987e5}.skin{fill:#d95926}}
</style>`);
  out.push(`<text class="t1" x="0" y="20" font-size="16" font-weight="600">Median total tokens per task (lower is better)</text>`);
  out.push(
    `<text class="t2" x="0" y="40" font-size="12">${esc(s.model)} · Claude Code ${esc(s.claudeVersions.join(', ') || '?')} · up to ${s.reps} runs per task and condition · medians</text>`,
  );
  out.push(
    `<text class="t2" x="0" y="58" font-size="12">Total ${esc(fmtTokens(T.baseline.tokens))} → ${esc(fmtTokens(T.skinflint.tokens))} (${esc(fmtPct(T.tokensDelta))}) · ` +
      `success ${T.baseline.successes}/${T.baseline.runs} → ${T.skinflint.successes}/${T.skinflint.runs}</text>`,
  );
  // Legend.
  out.push(`<rect class="base" x="0" y="72" width="12" height="12" rx="2"/><text class="t1" x="18" y="82" font-size="12">baseline</text>`);
  out.push(`<rect class="skin" x="90" y="72" width="12" height="12" rx="2"/><text class="t1" x="108" y="82" font-size="12">skinflint</text>`);
  out.push(`<text class="t2" x="${width - 4}" y="82" font-size="12" text-anchor="end">Δ tokens</text>`);
  // Grid and axis labels.
  const axisY = height - 20;
  for (let v = 0; v <= axisMax + 1e-9; v += step) {
    const gx = x(v).toFixed(1);
    out.push(`<line class="grid" x1="${gx}" y1="${top - 8}" x2="${gx}" y2="${axisY - 10}" stroke-width="1"/>`);
    out.push(`<text class="t2" x="${gx}" y="${axisY}" font-size="11" text-anchor="middle">${esc(fmtTokens(v))}</text>`);
  }
  // Bars: flat at the baseline (x = 0), 4px rounding only at the data end.
  const bar = (cls, v, y, label) => {
    if (!Number.isFinite(v) || v <= 0) return '';
    const w = Math.max(1, x(v) - plotX);
    const r = Math.min(4, w / 2, barH / 2);
    const x0 = plotX;
    const x1 = plotX + w;
    const d = `M${x0},${y}H${(x1 - r).toFixed(1)}Q${x1.toFixed(1)},${y} ${x1.toFixed(1)},${y + r}V${y + barH - r}Q${x1.toFixed(1)},${y + barH} ${(x1 - r).toFixed(1)},${y + barH}H${x0}Z`;
    return `<path class="${cls}" d="${d}"><title>${esc(label)}</title></path>` +
      `<text class="t2" x="${(x1 + 4).toFixed(1)}" y="${y + barH - 1}" font-size="10">${esc(fmtTokens(v))}</text>`;
  };
  tasks.forEach((t, i) => {
    const y = top + i * (groupH + groupGap);
    out.push(`<text class="t1" x="${labelW - 10}" y="${y + groupH / 2 + 4}" font-size="12" text-anchor="end">${esc(t.task)}</text>`);
    out.push(bar('base', t.baseline.medianTokens, y, `${t.task}, baseline: ${fmtTokens(t.baseline.medianTokens)} tokens (median of ${t.baseline.runs}), success ${t.baseline.successes}/${t.baseline.runs}`));
    out.push(bar('skin', t.skinflint.medianTokens, y + barH + gap, `${t.task}, skinflint: ${fmtTokens(t.skinflint.medianTokens)} tokens (median of ${t.skinflint.runs}), success ${t.skinflint.successes}/${t.skinflint.runs}`));
    out.push(`<text class="t1" x="${width - 4}" y="${y + groupH / 2 + 4}" font-size="12" font-weight="600" text-anchor="end">${esc(fmtPct(t.tokensDelta))}</text>`);
  });
  out.push('</svg>');
  return `${out.filter(Boolean).join('\n')}\n`;
}

function slug(s) {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, '_');
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      model: { type: 'string' },
      out: { type: 'string', default: RESULTS_DIR },
      'no-write': { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
  if (values.help) {
    console.log('usage: node bench/report.mjs [results.jsonl ...] [--model <m>] [--out <dir>] [--no-write]');
    return;
  }
  const files = positionals.length ? positionals : listResultFiles();
  let records = readResults(files);
  if (values.model) records = records.filter((r) => r.model === values.model || r.modelResolved === values.model);
  if (records.length === 0) {
    console.error(`no results${values.model ? ` for ${values.model}` : ''} in ${files.length ? files.join(', ') : RESULTS_DIR}`);
    process.exitCode = 1;
    return;
  }
  const summaries = summarize(records);
  const md = markdownReport(summaries);
  process.stdout.write(md);
  if (!values['no-write']) {
    mkdirSync(values.out, { recursive: true });
    writeFileSync(join(values.out, 'report.md'), `# skinflint benchmark\n\n${md}`);
    for (const s of summaries) {
      const file = join(values.out, `chart-${slug(s.model)}.svg`);
      writeFileSync(file, svgChart(s));
      console.error(`wrote ${file}`);
    }
    console.error(`wrote ${join(values.out, 'report.md')}`);
  }
}

function isMain() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) main();
