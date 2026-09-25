#!/usr/bin/env node
// thinwindow benchmark report: reads bench/results/*.jsonl and prints a
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

const CONDS = ['baseline', 'thinwindow'];

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
      row.tokensDelta = pctDelta(row.baseline.medianTokens, row.thinwindow.medianTokens);
      row.costDelta = pctDelta(row.baseline.medianCost, row.thinwindow.medianCost);
      return row;
    });
    const paired = tasks.filter((t) => t.baseline.medianTokens !== null && t.thinwindow.medianTokens !== null);
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
    total.tokensDelta = pctDelta(total.baseline.tokens, total.thinwindow.tokens);
    total.costDelta = pctDelta(total.baseline.cost, total.thinwindow.cost);
    total.turnsDelta = pctDelta(total.baseline.turns, total.thinwindow.turns);
    const dates = runs.map((r) => r.startedAt).filter(Boolean).sort();
    out.push({
      model,
      requested: [...new Set(runs.map((r) => r.model))],
      claudeVersions: [...new Set(runs.map((r) => r.claudeVersion).filter(Boolean))],
      // Only the runs that actually loaded the plugin say which version was
      // measured; a baseline run carries the checkout it happened to run from.
      thinwindow: [...new Set(runs.filter((r) => r.condition === 'thinwindow').map((r) => (r.thinwindowCommit ? `${r.thinwindowVersion} (${r.thinwindowCommit}${r.thinwindowDirty ? ', modified' : ''})` : r.thinwindowVersion)).filter(Boolean))],
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
        `Claude Code ${s.claudeVersions.join(', ') || 'unknown'} · thinwindow ${s.thinwindow.join(', ') || 'unknown'} · ` +
        `${s.runs} runs, up to ${s.reps} per task and condition · ${s.firstDate === s.lastDate ? s.firstDate : `${s.firstDate} to ${s.lastDate}`}`,
    );
    lines.push('');
    lines.push('| Task | Tokens baseline (min–max) | Tokens thinwindow (min–max) | Δ tokens | Cost baseline | Cost thinwindow | Δ cost | Turns baseline | Turns thinwindow | Success baseline | Success thinwindow |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const t of s.tasks) {
      const b = t.baseline;
      const k = t.thinwindow;
      lines.push(
        `| ${t.task} | ${fmtTokens(b.medianTokens)} (${fmtSpread(b.tokenSpread)}) | ${fmtTokens(k.medianTokens)} (${fmtSpread(k.tokenSpread)}) | ${fmtPct(t.tokensDelta)} | ` +
          `${fmtUsd(b.medianCost)} | ${fmtUsd(k.medianCost)} | ${fmtPct(t.costDelta)} | ${fmtNum(b.medianTurns)} | ${fmtNum(k.medianTurns)} | ${successCell(b)} | ${successCell(k)} |`,
      );
    }
    const T = s.total;
    lines.push(
      `| **Total** | **${fmtTokens(T.baseline.tokens)}** | **${fmtTokens(T.thinwindow.tokens)}** | **${fmtPct(T.tokensDelta)}** | ` +
        `**${fmtUsd(T.baseline.cost)}** | **${fmtUsd(T.thinwindow.cost)}** | **${fmtPct(T.costDelta)}** | ${fmtNum(T.baseline.turns)} | ${fmtNum(T.thinwindow.turns)} | ` +
        `**${successCell(T.baseline)}** | **${successCell(T.thinwindow)}** |`,
    );
    lines.push('');
    const errors = T.baseline.errors + T.thinwindow.errors;
    lines.push(
      'Tokens are input + cache-creation + cache-read + output, summed over every model the run used. ' +
        'Per task: medians over all runs, failures included; min–max in parentheses. ' +
        `Total: sum of the per-task medians over the ${T.pairedTasks} tasks that have both conditions; success counts every run. ` +
        'Δ = (thinwindow − baseline) / baseline. Cost is Claude Code\'s own estimate (`total_cost_usd`), not a bill. ' +
        'Turns is Claude Code\'s `num_turns`: the top-level agent loop only. A run that delegates to a subagent ' +
        '(the Agent tool) can show few top-level turns while doing much more work inside it; Tokens and Cost already ' +
        'include that subagent work (via `modelUsage`), so they stay the fair comparison — Turns does not. ' +
        'The thinwindow rules and thresholds were tuned on these same tasks.' +
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

// Per-task change, as diverging bars from a zero line: bars to the left are
// tokens saved, bars to the right are tokens lost. Plotting the *change* rather
// than two absolute totals is what makes the effect visible — on an absolute
// axis the saving is a short segment between two nearly identical bars. The
// absolute medians ride along as muted text so magnitude is not lost.
// Everything tunable lives in LAYOUT and in the CSS variables below.
const LAYOUT = {
  width: 780,
  labelW: 214, // left gutter for task names
  padL: 62, // room for the % label at the end of a leftward bar
  padR: 74, // room for the % label at the end of a rightward bar
  rowH: 34,
  top: 132,
  bottom: 44,
  barH: 15,
  radius: 4, // rounded data-end only, per the mark spec
};

const THEME = `
  /* Edit these six lines to restyle every chart. Light values first, dark
     below; both are validated categorical slots 1 and 2. */
  svg{--surface:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--grid:#d1d9e0;--base:#2a78d6;--tw:#eb6834}
  @media (prefers-color-scheme: dark){
    svg{--surface:#1a1a19;--ink:#ffffff;--ink-2:#c3c2b7;--grid:#3d444d;--base:#3987e5;--tw:#d95926}
  }
  text{font-family:ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans",Helvetica,Arial,sans-serif;font-variant-numeric:tabular-nums}
  .ink{fill:var(--ink)}.ink2{fill:var(--ink-2)}
  .grid{stroke:var(--grid);stroke-width:1}
  .zero{stroke:var(--ink-2);stroke-width:1.5}
  .win{fill:var(--tw)}.lose{fill:var(--base)}
  .h1{font-size:16px;font-weight:650;letter-spacing:-.01em}
  .h2{font-size:12px}.lbl{font-size:12px}.val{font-size:11px}
  .delta{font-size:12px;font-weight:650}
`;

function niceStepPct(max) {
  for (const s of [5, 10, 20, 25, 50]) if (max / s <= 4) return s;
  return 100;
}

export function svgChart(s) {
  const L = LAYOUT;
  // Deepest saving first, so the rows read as a ranking and the tasks that got
  // worse collect at the bottom instead of hiding mid-list.
  const tasks = s.tasks
    .filter((t) => Number.isFinite(t.tokensDelta))
    .slice()
    .sort((a, b) => a.tokensDelta - b.tokensDelta);
  const plotX = L.labelW + L.padL;
  const plotW = L.width - L.labelW - L.padL - L.padR;
  const height = L.top + tasks.length * L.rowH + L.bottom;

  const lo = Math.min(0, ...tasks.map((t) => t.tokensDelta));
  const hi = Math.max(0, ...tasks.map((t) => t.tokensDelta));
  const step = niceStepPct(Math.max(-lo, hi));
  const axisLo = Math.floor(lo / step) * step;
  const axisHi = Math.ceil(hi / step) * step;
  const x = (v) => plotX + ((v - axisLo) / (axisHi - axisLo)) * plotW;
  const zero = x(0);
  const T = s.total;
  const axisY = height - L.bottom + 22;
  const o = [];

  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${height}" viewBox="0 0 ${L.width} ${height}" role="img" aria-labelledby="t d">`);
  o.push(`<title id="t">thinwindow benchmark: change in total tokens per task, ${esc(s.model)}</title>`);
  o.push(`<desc id="d">One bar per task, showing the change in median total tokens against plain Claude Code. Bars left of the zero line are tokens saved, bars to the right are tokens lost. Overall ${esc(fmtTokens(T.baseline.tokens))} versus ${esc(fmtTokens(T.thinwindow.tokens))} (${esc(fmtPct(T.tokensDelta))}); success ${T.baseline.successes}/${T.baseline.runs} versus ${T.thinwindow.successes}/${T.thinwindow.runs}.</desc>`);
  o.push(`<style>${THEME}</style>`);
  o.push(`<rect width="${L.width}" height="${height}" fill="var(--surface)"/>`);

  o.push(`<text class="ink h1" x="0" y="24">Change in total tokens per task</text>`);
  o.push(`<text class="ink2 h2" x="0" y="44">${esc(s.model)} · Claude Code ${esc(s.claudeVersions.join(', ') || '?')} · medians of up to ${s.reps} runs per task and condition</text>`);
  o.push(`<text class="ink" x="0" y="76" font-size="24" font-weight="680">${esc(fmtPct(T.tokensDelta))}</text>`);
  o.push(`<text class="ink2 h2" x="104" y="76">overall · ${esc(fmtTokens(T.baseline.tokens))} → ${esc(fmtTokens(T.thinwindow.tokens))} · success ${T.baseline.successes}/${T.baseline.runs} → ${T.thinwindow.successes}/${T.thinwindow.runs}</text>`);

  const legend = (cx, cls, label) =>
    `<rect class="${cls}" x="${cx}" y="94" width="11" height="11" rx="2"/><text class="ink lbl" x="${cx + 17}" y="104">${esc(label)}</text>`;
  o.push(legend(0, 'win', 'fewer tokens with ThinWindow'));
  o.push(legend(200, 'lose', 'fewer tokens without it'));

  const rowsTop = L.top - L.rowH / 2;
  const rowsBottom = L.top + tasks.length * L.rowH - L.rowH / 2;
  for (let v = axisLo; v <= axisHi + 1e-9; v += step) {
    if (v === 0) continue;
    const gx = x(v).toFixed(1);
    o.push(`<line class="grid" x1="${gx}" y1="${rowsTop}" x2="${gx}" y2="${rowsBottom}"/>`);
    o.push(`<text class="ink2 val" x="${gx}" y="${axisY}" text-anchor="middle">${v > 0 ? '+' : '−'}${Math.abs(v)}%</text>`);
  }
  o.push(`<line class="zero" x1="${zero.toFixed(1)}" y1="${rowsTop}" x2="${zero.toFixed(1)}" y2="${rowsBottom}"/>`);
  o.push(`<text class="ink2 val" x="${zero.toFixed(1)}" y="${axisY}" text-anchor="middle">0</text>`);

  tasks.forEach((t, i) => {
    const y = L.top + i * L.rowH;
    const d = t.tokensDelta;
    const saving = d < 0;
    const xEnd = x(d);
    const w = Math.max(1.5, Math.abs(xEnd - zero));
    const x0 = saving ? zero - w : zero;
    const r = Math.min(L.radius, w);
    const top = y - L.barH / 2;
    const bot = y + L.barH / 2;
    // Rounded on the data end only; the end that sits on zero stays square.
    const path = saving
      ? `M${(x0 + r).toFixed(1)},${top}H${zero.toFixed(1)}V${bot}H${(x0 + r).toFixed(1)}A${r},${r} 0 0 1 ${x0.toFixed(1)},${(bot - r).toFixed(1)}V${(top + r).toFixed(1)}A${r},${r} 0 0 1 ${(x0 + r).toFixed(1)},${top}Z`
      : `M${zero.toFixed(1)},${top}H${(x0 + w - r).toFixed(1)}A${r},${r} 0 0 1 ${(x0 + w).toFixed(1)},${(top + r).toFixed(1)}V${(bot - r).toFixed(1)}A${r},${r} 0 0 1 ${(x0 + w - r).toFixed(1)},${bot}H${zero.toFixed(1)}Z`;
    o.push(`<text class="ink lbl" x="${L.labelW - 12}" y="${y - 1}" text-anchor="end">${esc(t.task)}</text>`);
    o.push(`<text class="ink2 val" x="${L.labelW - 12}" y="${y + 12}" text-anchor="end">${esc(fmtTokens(t.baseline.medianTokens))} → ${esc(fmtTokens(t.thinwindow.medianTokens))}</text>`);
    o.push(
      `<path class="${saving ? 'win' : 'lose'}" d="${path}"><title>${esc(
        `${t.task}: ${fmtTokens(t.baseline.medianTokens)} → ${fmtTokens(t.thinwindow.medianTokens)} tokens (${fmtPct(t.tokensDelta)}), success ${t.baseline.successes}/${t.baseline.runs} → ${t.thinwindow.successes}/${t.thinwindow.runs}`,
      )}</title></path>`,
    );
    const lx = saving ? x0 - 8 : x0 + w + 8;
    o.push(`<text class="ink delta" x="${lx.toFixed(1)}" y="${y + 4}" text-anchor="${saving ? 'end' : 'start'}">${esc(fmtPct(d))}</text>`);
  });

  o.push('</svg>');
  return `${o.filter(Boolean).join('\n')}\n`;
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
    writeFileSync(join(values.out, 'report.md'), `# thinwindow benchmark\n\n${md}`);
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
