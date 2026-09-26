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
import { bootstrapDelta, median, pctDelta, spread } from './lib/stats.mjs';

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
        // Stopped by Claude Code at --max-turns: the run did not finish, so its
        // tokens are not comparable with a run that did.
        capped: condRuns.filter((r) => r.subtype === 'error_max_turns').length,
        tokens: sum(c, 'medianTokens'),
        cost: sum(c, 'medianCost'),
        turns: sum(c, 'medianTurns'),
      };
    }
    total.tokensDelta = pctDelta(total.baseline.tokens, total.thinwindow.tokens);
    total.costDelta = pctDelta(total.baseline.cost, total.thinwindow.cost);
    total.turnsDelta = pctDelta(total.baseline.turns, total.thinwindow.turns);
    // 95% bootstrap intervals over the tasks: with 8 tasks, a total whose
    // interval includes zero can't be told apart from no change.
    total.tokensCI = bootstrapDelta(paired.map((t) => [t.baseline.medianTokens, t.thinwindow.medianTokens]));
    total.costCI = bootstrapDelta(paired.filter((t) => t.costDelta !== null).map((t) => [t.baseline.medianCost, t.thinwindow.medianCost]));
    // The same total over runs that passed their hidden check only. A run that
    // fails or hits the turn cap can stop early and look cheap, so this is the
    // figure that doesn't reward failing; a task drops out when either
    // condition has no passing run.
    const passed = taskIds
      .map((task) => CONDS.map((c) => median(runs.filter((r) => r.task === task && r.condition === c && r.success === true).map((r) => r.totalTokens))))
      .filter(([b, k]) => b !== null && k !== null);
    total.successful = {
      pairedTasks: passed.length,
      tokensDelta: pctDelta(passed.reduce((a, [b]) => a + b, 0), passed.reduce((a, [, k]) => a + k, 0)),
      tokensCI: bootstrapDelta(passed),
    };
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

export function fmtUsd(n) {
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '–';
}

export function fmtPct(p) {
  if (!Number.isFinite(p)) return '–';
  const s = `${Math.abs(p).toFixed(1)}%`;
  return p < 0 ? `−${s}` : p > 0 ? `+${s}` : '0.0%';
}

export function fmtNum(n) {
  return Number.isFinite(n) ? (Number.isInteger(n) ? String(n) : n.toFixed(1)) : '–';
}

export function fmtSpread(s) {
  return s ? `${fmtTokens(s.min)}–${fmtTokens(s.max)}` : '–';
}

export function successCell(s) {
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
    if (T.tokensCI) lines.push(`Total tokens ${fmtPct(T.tokensDelta)} (95% CI ${fmtPct(T.tokensCI[0])} to ${fmtPct(T.tokensCI[1])}); cost ${fmtPct(T.costDelta)} (95% CI ${fmtPct(T.costCI[0])} to ${fmtPct(T.costCI[1])}).`, '');
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

// Per-task change, as diverging bars from a zero line: left of zero, the task
// took fewer tokens with ThinWindow; right of zero, more. Plotting the
// *change* rather than two absolute totals is what makes the effect visible;
// the absolute medians ride along as muted text so magnitude is not lost.
// Each bar carries a whisker over every pairing of a ThinWindow run with a
// baseline run of the same task: where it crosses zero, the two conditions'
// ranges overlap. The header gives the total's 95% interval and says so when
// it includes zero. Everything tunable lives in LAYOUT and in the CSS below.
const LAYOUT = {
  width: 780,
  labelW: 214, // left gutter for task names
  padL: 16,
  padR: 76, // the Δ column at the right edge
  rowH: 34,
  bottom: 44,
  barH: 15,
  radius: 4, // rounded data-end only, per the mark spec
  cap: 8, // height of a whisker's end cap
  maxPct: 100, // a whisker past +100% runs to the edge and ends in an arrow
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
  .whisk{stroke:var(--ink);stroke-width:1.25;fill:none}.arrow{fill:var(--ink)}
  .h1{font-size:16px;font-weight:650;letter-spacing:-.01em}
  .h2{font-size:12px}.lbl{font-size:12px}.val{font-size:11px}
  .delta{font-size:12px;font-weight:650}
`;

function niceStepPct(max) {
  for (const s of [5, 10, 20, 25, 50]) if (max / s <= 4) return s;
  return 100;
}

// The change between a ThinWindow run and a baseline run of the same task,
// over every pairing: [fewest ThinWindow / most baseline, most / fewest] - 1.
export function taskRange(t) {
  const b = t.baseline.tokenSpread;
  const k = t.thinwindow.tokenSpread;
  if (!b || !k || !(b.min > 0)) return null;
  return [100 * (k.min / b.max - 1), 100 * (k.max / b.min - 1)];
}

export const includesZero = (ci) => Array.isArray(ci) && ci[0] <= 0 && ci[1] >= 0;

// The header's second paragraph: the interval, and for a model whose runs
// failed or hit the turn cap, the figure over passing runs and both rates.
export function headerLines(s) {
  const T = s.total;
  const out = [];
  if (T.tokensCI) {
    out.push(
      `95% interval over the ${T.pairedTasks} tasks: ${fmtPct(T.tokensCI[0])} to ${fmtPct(T.tokensCI[1])}.` +
        (includesZero(T.tokensCI) ? ' It includes zero: on these tasks the change can’t be told apart from none.' : ''),
    );
  }
  const S = T.successful;
  const b = T.baseline;
  const k = T.thinwindow;
  const messy = b.capped + k.capped > 0 || b.successes < b.runs || k.successes < k.runs;
  if (S && messy) {
    out.push(
      `Passing runs only: ${fmtPct(S.tokensDelta)} over ${S.pairedTasks} tasks` +
        (S.tokensCI ? ` (95% interval ${fmtPct(S.tokensCI[0])} to ${fmtPct(S.tokensCI[1])}).` : '.'),
    );
    out.push(`Stopped by the turn cap: ${b.capped}/${b.runs} → ${k.capped}/${k.runs} · failed the hidden check: ${b.runs - b.successes}/${b.runs} → ${k.runs - k.successes}/${k.runs}.`);
  }
  return out;
}

export function svgChart(s) {
  const L = LAYOUT;
  // Deepest drop first, so the rows read as a ranking and the tasks that got
  // worse collect at the bottom instead of hiding mid-list.
  const tasks = s.tasks
    .filter((t) => Number.isFinite(t.tokensDelta))
    .slice()
    .sort((a, b) => a.tokensDelta - b.tokensDelta);
  const T = s.total;
  const lines = headerLines(s);
  const legendY = 96 + lines.length * 18;
  const top = legendY + 40;
  const plotX = L.labelW + L.padL;
  const plotW = L.width - L.labelW - L.padL - L.padR;
  const height = top + tasks.length * L.rowH + L.bottom;

  const ranges = tasks.map(taskRange);
  const lo = Math.min(0, ...tasks.map((t) => t.tokensDelta), ...ranges.filter(Boolean).map((r) => r[0]));
  const hi = Math.max(0, ...tasks.map((t) => t.tokensDelta), ...ranges.filter(Boolean).map((r) => Math.min(r[1], L.maxPct)));
  const step = niceStepPct(Math.max(-lo, hi));
  const axisLo = Math.floor(lo / step) * step;
  const axisHi = Math.ceil(hi / step) * step;
  const x = (v) => plotX + ((Math.min(Math.max(v, axisLo), axisHi) - axisLo) / (axisHi - axisLo)) * plotW;
  const zero = x(0);
  const axisY = height - L.bottom + 22;
  const f = (n) => n.toFixed(1);
  const o = [];

  o.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${height}" viewBox="0 0 ${L.width} ${height}" role="img" aria-labelledby="t d">`);
  o.push(`<title id="t">ThinWindow benchmark: change in total tokens per task, ${esc(s.model)}</title>`);
  o.push(
    `<desc id="d">One bar per task: the change in median total tokens with ThinWindow against plain Claude Code; left of zero is fewer tokens, right of zero more. ` +
      `Each whisker spans every pairing of a ThinWindow run with a baseline run of that task. Total ${esc(fmtTokens(T.baseline.tokens))} versus ${esc(fmtTokens(T.thinwindow.tokens))} (${esc(fmtPct(T.tokensDelta))}). ` +
      `${esc(lines.join(' '))} Success ${T.baseline.successes}/${T.baseline.runs} versus ${T.thinwindow.successes}/${T.thinwindow.runs}.</desc>`,
  );
  o.push(`<style>${THEME}</style>`);
  o.push(`<rect width="${L.width}" height="${height}" fill="var(--surface)"/>`);

  o.push(`<text class="ink h1" x="0" y="24">Change in total tokens per task</text>`);
  o.push(`<text class="ink2 h2" x="0" y="44">${esc(s.model)} · Claude Code ${esc(s.claudeVersions.join(', ') || '?')} · medians of up to ${s.reps} runs per task and condition</text>`);
  o.push(`<text class="ink" x="0" y="76" font-size="24" font-weight="680">${esc(fmtPct(T.tokensDelta))}</text>`);
  o.push(`<text class="ink2 h2" x="104" y="76">total tokens · ${esc(fmtTokens(T.baseline.tokens))} → ${esc(fmtTokens(T.thinwindow.tokens))} · success ${T.baseline.successes}/${T.baseline.runs} → ${T.thinwindow.successes}/${T.thinwindow.runs}</text>`);
  lines.forEach((line, i) => o.push(`<text class="ink h2" x="0" y="${98 + i * 18}">${esc(line)}</text>`));

  const legend = (cx, cls, label) =>
    `<rect class="${cls}" x="${cx}" y="${legendY}" width="11" height="11" rx="2"/><text class="ink lbl" x="${cx + 17}" y="${legendY + 10}">${esc(label)}</text>`;
  o.push(legend(0, 'win', 'fewer tokens with ThinWindow'));
  o.push(legend(206, 'lose', 'more tokens with ThinWindow'));
  const wy = legendY + 5.5;
  o.push(`<path class="whisk" d="M412,${wy - L.cap / 2}V${wy + L.cap / 2}M412,${wy}H440M440,${wy - L.cap / 2}V${wy + L.cap / 2}"/>`);
  o.push(`<text class="ink lbl" x="448" y="${legendY + 10}">range over every pair of runs</text>`);

  const rowsTop = top - L.rowH / 2;
  const rowsBottom = top + tasks.length * L.rowH - L.rowH / 2;
  for (let v = axisLo; v <= axisHi + 1e-9; v += step) {
    if (v === 0) continue;
    const gx = f(x(v));
    o.push(`<line class="grid" x1="${gx}" y1="${rowsTop}" x2="${gx}" y2="${rowsBottom}"/>`);
    o.push(`<text class="ink2 val" x="${gx}" y="${axisY}" text-anchor="middle">${v > 0 ? '+' : '−'}${Math.abs(v)}%</text>`);
  }
  o.push(`<line class="zero" x1="${f(zero)}" y1="${rowsTop}" x2="${f(zero)}" y2="${rowsBottom}"/>`);
  o.push(`<text class="ink2 val" x="${f(zero)}" y="${axisY}" text-anchor="middle">0</text>`);

  tasks.forEach((t, i) => {
    const y = top + i * L.rowH;
    const d = t.tokensDelta;
    const fewer = d < 0;
    const w = Math.max(1.5, Math.abs(x(d) - zero));
    const x0 = fewer ? zero - w : zero;
    const r = Math.min(L.radius, w);
    const barTop = y - L.barH / 2;
    const barBot = y + L.barH / 2;
    // Rounded on the data end only; the end that sits on zero stays square.
    const path = fewer
      ? `M${f(x0 + r)},${barTop}H${f(zero)}V${barBot}H${f(x0 + r)}A${r},${r} 0 0 1 ${f(x0)},${f(barBot - r)}V${f(barTop + r)}A${r},${r} 0 0 1 ${f(x0 + r)},${barTop}Z`
      : `M${f(zero)},${barTop}H${f(x0 + w - r)}A${r},${r} 0 0 1 ${f(x0 + w)},${f(barTop + r)}V${f(barBot - r)}A${r},${r} 0 0 1 ${f(x0 + w - r)},${barBot}H${f(zero)}Z`;
    const range = ranges[i];
    const tip = range ? `; over every pair of runs ${fmtPct(range[0])} to ${fmtPct(range[1])}` : '';
    o.push(`<text class="ink lbl" x="${L.labelW - 12}" y="${y - 1}" text-anchor="end">${esc(t.task)}</text>`);
    o.push(`<text class="ink2 val" x="${L.labelW - 12}" y="${y + 12}" text-anchor="end">${esc(fmtTokens(t.baseline.medianTokens))} → ${esc(fmtTokens(t.thinwindow.medianTokens))}</text>`);
    o.push(
      `<path class="${fewer ? 'win' : 'lose'}" d="${path}"><title>${esc(
        `${t.task}: ${fmtTokens(t.baseline.medianTokens)} → ${fmtTokens(t.thinwindow.medianTokens)} tokens (${fmtPct(d)})${tip}, success ${t.baseline.successes}/${t.baseline.runs} → ${t.thinwindow.successes}/${t.thinwindow.runs}`,
      )}</title></path>`,
    );
    if (range) {
      const [a, b] = [x(range[0]), x(range[1])];
      const c = L.cap / 2;
      const clipped = range[1] > axisHi;
      o.push(`<path class="whisk" d="M${f(a)},${y - c}V${y + c}M${f(a)},${y}H${f(b)}${clipped ? '' : `M${f(b)},${y - c}V${y + c}`}"/>`);
      if (clipped) o.push(`<path class="arrow" d="M${f(b)},${y}l-7,-4v8z"/>`);
    }
    o.push(`<text class="ink delta" x="${plotX + plotW + 18}" y="${y + 4}">${esc(fmtPct(d))}</text>`);
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
