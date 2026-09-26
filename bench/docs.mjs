#!/usr/bin/env node
// Generates every benchmark number that appears outside bench/results/, so
// none of them is typed by hand:
//
//   - bench/results/report.json  a stable, machine-readable summary. The
//     README blocks below are rendered from it, and so is the benchmark
//     section of https://ivanluna.dev, which fetches it straight from this
//     repository. Treat its shape as a public contract.
//   - the <!-- RESULTS -->, <!-- CACHE --> and <!-- BENCH --> blocks of
//     README.md, README.es.md and README.pt-BR.md.
//   - the <!-- ROWS -->, <!-- FOOTNOTE -->, <!-- HEADROOM --> and
//     <!-- MEASURED --> blocks of website/index.html.
//
// The rounded ranges quoted in prose ("87-96% of tokens billed") are not
// rewritten - a regex that edits a sentence is a regex that can corrupt one.
// They are checked instead: RANGE_CLAIMS lists the phrase each file must
// contain, and a mismatch names the file and the phrase it should now carry.
//
//   node bench/docs.mjs            write report.json and update the READMEs
//   node bench/docs.mjs --check    exit 1 if either is out of date
//
// The cache-mix table describes the *baseline* runs on purpose: it states the
// problem ThinWindow addresses, not the result of applying it.
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT_DIR, RESULTS_DIR } from './lib/paths.mjs';
import { listResultFiles, readResultFile } from './lib/results.mjs';
import { fmtNum, fmtPct, fmtSpread, fmtTokens, fmtUsd, successCell, summarize } from './report.mjs';

const REPORT_JSON = join(RESULTS_DIR, 'report.json');
// Opus before Sonnet before Haiku, newest version first: the order a reader
// expects, not the alphabetical order the raw files happen to have.
const FAMILY_RANK = { opus: 0, sonnet: 1, haiku: 2, fable: 3 };
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

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

// Share of every billed token that was a cache read, a cache write or output,
// over the runs of one condition. Input is the remaining fraction of a percent.
export function tokenMix(runs) {
  const sum = (k) => runs.reduce((a, r) => a + (r[k] || 0), 0);
  const parts = {
    input: sum('inputTokens'),
    cacheWrite: sum('cacheCreationTokens'),
    cacheRead: sum('cacheReadTokens'),
    output: sum('outputTokens'),
  };
  const total = parts.input + parts.cacheWrite + parts.cacheRead + parts.output;
  if (!total) return null;
  return Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, (100 * v) / total]));
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
        tasks: s.tasks,
        total: { ...s.total, ...headroom(s.tasks) },
      };
    })
    .sort(byModel);
  return {
    generatedBy: 'bench/docs.mjs',
    schema: 1,
    tasks: [...new Set(records.map((r) => r.task))].sort().length,
    runs: records.length,
    models,
  };
}

// --- README blocks -------------------------------------------------------

const pct1 = (n, dec) => (dec === ',' ? fmtPct(n).replace('.', ',') : fmtPct(n));
const mix1 = (n, dec) => `${n.toFixed(1).replace('.', dec)}%`;
const word = (n) => WORDS[n] || String(n);

// Rounded headline ranges, so the prose can never disagree with the table.
export function ranges(report) {
  const saved = report.models.map((m) => -m.total.tokensDelta);
  const read = report.models.map((m) => m.tokenMix.cacheRead);
  const out = report.models.map((m) => m.tokenMix.output);
  const r = (xs, f) => [f(Math.min(...xs)), f(Math.max(...xs))];
  return {
    tokens: r(saved, (x) => Math.round(x)),
    cacheRead: r(read, (x) => Math.round(x)),
    output: r(out, (x) => x),
  };
}

const LOCALES = {
  en: {
    dec: '.',
    results: ['Model', 'Tokens', 'Cost', 'Success baseline → ThinWindow', 'Runs'],
    cache: ['Model', 'Cache reads', 'Cache writes', 'Output'],
    resultsNote: (r) =>
      `Same ${r.tasks} tasks, ${r.runs} runs, one agent per run, no cherry-picking:\n` +
      'every run recorded is in the table, except runs superseded by a later version\n' +
      'of the code on the same task, which are kept in\n' +
      '[`bench/results/archive/`](bench/results/archive). Per-task figures, the\n' +
      'spread and the raw data are in [Benchmark](#benchmark) below.',
    benchIntro: (r) =>
      `${word(r.models.length)[0].toUpperCase()}${word(r.models.length).slice(1)} models, ${r.tasks} tasks, ${r.runs} runs. Charts and tables are generated by\n` +
      '[`bench/report.mjs`](bench/report.mjs) from the raw run files.',
    alt: (m) => `Change in total tokens per task, ${m.label}: bars left of zero are tokens saved with ThinWindow`,
    meta: (m) =>
      `\`${m.id}\`${m.requested.some((x) => x !== m.id) ? ` (requested as ${m.requested.map((x) => `\`${x}\``).join(', ')})` : ''} · ` +
      `Claude Code ${m.claudeVersions.join(', ') || 'unknown'} · ThinWindow ${m.thinwindow.join(', ') || 'unknown'} · ` +
      `${m.runs} runs, up to ${m.reps} per task and condition · ${m.date}`,
    taskTable: ['Task', 'Tokens baseline (min–max)', 'Tokens ThinWindow (min–max)', 'Δ tokens', 'Cost baseline', 'Cost ThinWindow', 'Δ cost', 'Turns baseline', 'Turns ThinWindow', 'Success baseline', 'Success ThinWindow'],
    details: 'Per-task table',
    rawRuns: 'Raw runs',
    notes: (r) =>
      'Tokens are input + cache-creation + cache-read + output, summed over every model the run used. ' +
      'Per task: medians over all runs, failures included; min–max in parentheses. ' +
      `Total: sum of the per-task medians over the ${r.models[0].total.pairedTasks} tasks that have both conditions; success counts every run. ` +
      "Δ = (ThinWindow − baseline) / baseline. Cost is Claude Code's own estimate (`total_cost_usd`), not a bill. " +
      "Turns is Claude Code's `num_turns`: the top-level agent loop only. A run that delegates to a subagent " +
      '(the Agent tool) can show few top-level turns while doing much more work inside it; Tokens and Cost already ' +
      'include that subagent work (via `modelUsage`), so they stay the fair comparison — Turns does not. ' +
      'The ThinWindow rules and thresholds were tuned on these same tasks.',
  },
  es: {
    dec: ',',
    results: ['Modelo', 'Tokens', 'Costo', 'Éxito base → ThinWindow', 'Corridas'],
    cache: ['Modelo', 'Lecturas de caché', 'Escrituras de caché', 'Salida'],
    resultsNote: (r) =>
      `Las mismas ${r.tasks} tareas, ${r.runs} corridas, un agente por corrida, sin descartar\n` +
      'ninguna: todas las que se registraron están en la tabla, salvo las que reemplazó\n' +
      'una versión posterior del código en la misma tarea, que se guardan en\n' +
      '[`bench/results/archive/`](bench/results/archive). El detalle por tarea y los\n' +
      'datos crudos están en [Benchmark](#benchmark).',
    benchIntro: (r) =>
      `${word(r.models.length)[0].toUpperCase()}${word(r.models.length).slice(1)}`,
    alt: (m) => `Cambio en tokens totales por tarea, ${m.label}: las barras a la izquierda del cero son tokens ahorrados`,
  },
  'pt-BR': {
    dec: ',',
    results: ['Modelo', 'Tokens', 'Custo', 'Sucesso base → ThinWindow', 'Execuções'],
    cache: ['Modelo', 'Leituras de cache', 'Escritas de cache', 'Saída'],
    resultsNote: (r) =>
      `As mesmas ${r.tasks} tarefas, ${r.runs} execuções, um agente por execução, sem descartar\n` +
      'nenhuma: tudo o que foi registrado está na tabela, exceto as execuções que uma\n' +
      'versão posterior do código substituiu na mesma tarefa, guardadas em\n' +
      '[`bench/results/archive/`](bench/results/archive). O detalhe por tarefa e os\n' +
      'dados brutos estão em [Benchmark](#benchmark).',
    alt: (m) => `Mudança em tokens totais por tarefa, ${m.label}: barras à esquerda do zero são tokens economizados`,
  },
};

// Spanish and Portuguese only carry the charts; the per-task tables are
// generated in English and linked, so a translation can never go stale.
const CHART_ONLY = {
  es: (r) =>
    `Tres modelos, ${r.tasks} tareas, ${r.runs} corridas. Los gráficos y las tablas los genera\n` +
    '[`bench/report.mjs`](bench/report.mjs) a partir de los archivos crudos.',
  'pt-BR': (r) =>
    `Três modelos, ${r.tasks} tarefas, ${r.runs} execuções. Os gráficos e as tabelas são gerados por\n` +
    '[`bench/report.mjs`](bench/report.mjs) a partir dos arquivos brutos.',
};

function table(head, align, rows) {
  return [`| ${head.join(' | ')} |`, `| ${align.join(' | ')} |`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

export function resultsBlock(report, lang) {
  const L = LOCALES[lang];
  const rows = report.models.map((m) => [
    m.label,
    `**${pct1(m.total.tokensDelta, L.dec)}**`,
    `**${pct1(m.total.costDelta, L.dec)}**`,
    `**${successCell(m.total.baseline)}** → **${successCell(m.total.thinwindow)}**`,
    String(m.runs),
  ]);
  return `${table(L.results, ['---', '---:', '---:', ':---:', '---:'], rows)}\n\n${L.resultsNote(report)}`;
}

export function cacheBlock(report, lang) {
  const L = LOCALES[lang];
  const rows = report.models.map((m) => [
    m.label,
    mix1(m.tokenMix.cacheRead, L.dec),
    mix1(m.tokenMix.cacheWrite, L.dec),
    mix1(m.tokenMix.output, L.dec),
  ]);
  return table(L.cache, ['---', '---:', '---:', '---:'], rows);
}

export function benchBlock(report, lang) {
  const L = LOCALES[lang];
  if (lang !== 'en') {
    const parts = [CHART_ONLY[lang](report)];
    for (const m of report.models) parts.push(`### ${m.label}`, `![${L.alt(m)}](bench/results/chart-${m.id.replace(/[^A-Za-z0-9._-]+/g, '_')}.svg)`);
    return parts.join('\n\n');
  }
  const parts = [L.benchIntro(report)];
  for (const m of report.models) {
    const rows = m.tasks.map((t) => [
      t.task,
      `${fmtTokens(t.baseline.medianTokens)} (${fmtSpread(t.baseline.tokenSpread)})`,
      `${fmtTokens(t.thinwindow.medianTokens)} (${fmtSpread(t.thinwindow.tokenSpread)})`,
      fmtPct(t.tokensDelta),
      fmtUsd(t.baseline.medianCost),
      fmtUsd(t.thinwindow.medianCost),
      fmtPct(t.costDelta),
      fmtNum(t.baseline.medianTurns),
      fmtNum(t.thinwindow.medianTurns),
      successCell(t.baseline),
      successCell(t.thinwindow),
    ]);
    const T = m.total;
    rows.push([
      '**Total**',
      `**${fmtTokens(T.baseline.tokens)}**`,
      `**${fmtTokens(T.thinwindow.tokens)}**`,
      `**${fmtPct(T.tokensDelta)}**`,
      `**${fmtUsd(T.baseline.cost)}**`,
      `**${fmtUsd(T.thinwindow.cost)}**`,
      `**${fmtPct(T.costDelta)}**`,
      fmtNum(T.baseline.turns),
      fmtNum(T.thinwindow.turns),
      `**${successCell(T.baseline)}**`,
      `**${successCell(T.thinwindow)}**`,
    ]);
    parts.push(
      `### ${m.label}`,
      L.meta(m),
      `![${L.alt(m)}](bench/results/chart-${m.id.replace(/[^A-Za-z0-9._-]+/g, '_')}.svg)`,
      '<details><summary>' + L.details + '</summary>',
      table(L.taskTable, ['---', ...Array(10).fill('---:')], rows),
      '</details>',
      `${L.rawRuns}: ${m.resultFiles.map((f) => `[\`${f}\`](${f})`).join(', ')}`,
    );
  }
  parts.push(L.notes(report));
  return parts.join('\n\n');
}

// --- website/index.html ---------------------------------------------------

const SITE = 'website/index.html';

// Highest capability first, as the table reads.
const winClass = (d) => (d < 0 ? 'n win' : 'n');

export function siteRows(report) {
  return report.models
    .map((m) => {
      const T = m.total;
      return (
        `            <tr><td>${m.label}</td>` +
        `<td class="${winClass(T.tokensDelta)}">${fmtPct(T.tokensDelta)}</td>` +
        `<td class="${winClass(T.costDelta)}">${fmtPct(T.costDelta)}</td>` +
        `<td class="n">${fmtNum(T.baseline.turns)} → ${fmtNum(T.thinwindow.turns)}</td>` +
        `<td class="n">${successCell(T.baseline)} → ${successCell(T.thinwindow)}</td>` +
        `<td class="n">${m.runs}</td></tr>`
      );
    })
    .join('\n');
}

export function siteFootnote(report) {
  const versions = report.models.map((m) => `${m.thinwindow.join(', ') || 'unknown'} on ${m.label}`).join('; ');
  const claude = [...new Set(report.models.flatMap((m) => m.claudeVersions))].join(', ') || 'unknown';
  const days = report.models.flatMap((m) => m.date.split(' to ')).sort();
  const dates = days[0] === days[days.length - 1] ? days[0] : `${days[0]} to ${days[days.length - 1]}`;
  return (
    `        <p class="small muted">Same ${report.tasks} tasks, ${report.runs} runs, one agent per run. ` +
    `Claude Code ${claude}, ${dates}. ThinWindow ${versions}. ` +
    'Tokens and cost are the sum of the per-task medians; turns are the sum of per-task median top-level turns; ' +
    'success counts every run.</p>'
  );
}

export function siteHeadroom(report) {
  // The two models with the most to gain from removing their own regressions.
  const gap = (m) => m.total.tokensDelta - m.total.tokensDeltaNoRegressions;
  const [a, b] = [...report.models].sort((x, y) => gap(y) - gap(x));
  const worst = [...report.models].sort((x, y) => y.total.turnsDelta - x.total.turnsDelta)[0];
  const best = [...report.models].sort((x, y) => x.total.turnsDelta - y.total.turnsDelta)[0];
  const abs = (p) => `${Math.abs(p).toFixed(1)}%`;
  const turns = (p) => (abs(p) === '0.0%' ? 'as many turns as without it' : `${abs(p)} ${p < 0 ? 'fewer' : 'more'} turns`);
  const cost = (p) => `${p < 0 ? 'cut' : 'raised'} cost by ${abs(p)}`;
  return [
    `          <li><strong>Not every task improves.</strong> On ${a.label}, ${word(a.total.regressingTasks)} of the ` +
      `${word(a.total.pairedTasks)} tasks cost more with ThinWindow. Just neutralising those regressions, without saving ` +
      `a token anywhere else, would take ${a.label} from ${fmtPct(a.total.tokensDelta)} to about ` +
      `${fmtPct(a.total.tokensDeltaNoRegressions)}, and ${b.label} from ${fmtPct(b.total.tokensDelta)} to about ` +
      `${fmtPct(b.total.tokensDeltaNoRegressions)}. Most of the near-term headroom is in not making short tasks worse.</li>`,
    `          <li><strong>Turns are the untapped factor.</strong> ${best.label} took ${turns(best.total.turnsDelta)} ` +
      `and ${cost(best.total.costDelta)}; ${worst.label} took ${turns(worst.total.turnsDelta)} and ` +
      `${cost(worst.total.costDelta)}. An earlier attempt at explicit "use fewer turns" rules made Sonnet measurably worse, and it was ` +
      'reverted rather than kept and quietly excluded. That experiment is still in the history.</li>',
  ].join('\n');
}

// The launch target from bench/README.md, and whether the data meets it yet.
export const TARGET_TOKENS_PCT = 25;

export function siteMeasured(report) {
  const met = report.models.every(
    (m) =>
      m.total.tokensDelta <= -TARGET_TOKENS_PCT &&
      m.total.thinwindow.successes >= m.total.baseline.successes,
  );
  return (
    `            <tr><td>Measured</td><td>${word(report.models.length)[0].toUpperCase()}${word(report.models.length).slice(1)} ` +
    `models, ${report.runs} runs, as above. The launch target (≥${TARGET_TOKENS_PCT}% fewer tokens at equal success) ` +
    `is ${met ? 'met' : 'not met yet'}.</td></tr>`
  );
}

export function renderedSite(text, report) {
  let out = replaceBlock(text, 'ROWS', siteRows(report), SITE);
  out = replaceBlock(out, 'FOOTNOTE', siteFootnote(report), SITE);
  out = replaceBlock(out, 'HEADROOM', siteHeadroom(report), SITE);
  return replaceBlock(out, 'MEASURED', siteMeasured(report), SITE);
}

// --- prose ranges ---------------------------------------------------------

// Phrases that quote a rounded range. Checked, never rewritten: whitespace is
// collapsed first, so re-wrapping a paragraph can't produce a false alarm.
export function rangeClaims(report) {
  const r = ranges(report);
  const [t0, t1] = r.tokens;
  const [c0, c1] = r.cacheRead;
  const o0 = r.output[0].toFixed(1);
  const o1 = r.output[1].toFixed(1);
  const es = (x) => x.replace('.', ',');
  return [
    ['README.md', [`${c0}–${c1}%`, `${t0}–${t1}%`, `${c0}% to ${c1}%`, `${o0}% to ${o1}%`]],
    ['README.es.md', [`entre el ${c0}% y el ${c1}%`, `entre un ${t0}% y un ${t1}%`, `entre el ${es(o0)}% y el ${es(o1)}%`]],
    ['README.pt-BR.md', [`de ${c0}% a ${c1}%`, `de ${t0}% a ${t1}%`, `${es(o0)}% a ${es(o1)}%`]],
    ['package.json', [`${c0}–${c1}%`, `${t0}–${t1}%`]],
    ['.claude-plugin/plugin.json', [`${c0}–${c1}%`, `${t0}–${t1}%`]],
    ['.claude-plugin/marketplace.json', [`${c0}–${c1}%`, `${t0}–${t1}%`]],
    [SITE, [`${c0}–${c1}%`, `${t0}–${t1}%`, `${c0}% to ${c1}%`, `under ${Math.ceil(r.output[1])}%`]],
  ];
}

// Files whose prose quotes a range the data no longer supports.
export function staleRanges(root = ROOT_DIR) {
  const report = buildReport();
  const out = [];
  for (const [name, phrases] of rangeClaims(report)) {
    const flat = readFileSync(join(root, name), 'utf8').replace(/\s+/g, ' ');
    for (const phrase of phrases) if (!flat.includes(phrase)) out.push(`${name}: should say "${phrase}"`);
  }
  return out;
}

// --- marker replacement --------------------------------------------------

const README = { en: 'README.md', es: 'README.es.md', 'pt-BR': 'README.pt-BR.md' };

function replaceBlock(text, name, body, file) {
  // The END marker keeps the indentation the START marker was written with,
  // so a generated block does not reflow the HTML around it.
  const re = new RegExp(`([ \\t]*)(<!-- ${name}:START -->\\n)[\\s\\S]*?(<!-- ${name}:END -->)`);
  if (!re.test(text)) throw new Error(`${file}: missing <!-- ${name}:START --> ... <!-- ${name}:END --> markers`);
  return text.replace(re, (_, indent, open, close) => `${indent}${open}${body}\n${indent}${close}`);
}

export function renderedReadme(text, report, lang, file) {
  let out = replaceBlock(text, 'RESULTS', resultsBlock(report, lang), file);
  out = replaceBlock(out, 'CACHE', cacheBlock(report, lang), file);
  return replaceBlock(out, 'BENCH', benchBlock(report, lang), file);
}

// Files whose generated content differs from what is on disk.
export function outOfDate(root = ROOT_DIR) {
  const report = buildReport();
  const stale = [];
  const json = `${JSON.stringify(report, null, 2)}\n`;
  let current = null;
  try {
    current = readFileSync(REPORT_JSON, 'utf8');
  } catch {}
  if (current !== json) stale.push(REPORT_JSON);
  for (const [lang, name] of Object.entries(README)) {
    const file = join(root, name);
    const text = readFileSync(file, 'utf8');
    if (renderedReadme(text, report, lang, name) !== text) stale.push(file);
  }
  const site = join(root, SITE);
  const siteText = readFileSync(site, 'utf8');
  if (renderedSite(siteText, report) !== siteText) stale.push(site);
  return stale;
}

function main() {
  const check = process.argv.includes('--check');
  const report = buildReport();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  let stale = 0;
  const write = (file, next) => {
    let current = null;
    try {
      current = readFileSync(file, 'utf8');
    } catch {}
    if (current === next) return;
    stale++;
    if (check) console.error(`out of date: ${basename(file)} (run npm run bench:docs)`);
    else {
      writeFileSync(file, next);
      console.log(`updated ${relative(ROOT_DIR, file)}`);
    }
  };
  write(REPORT_JSON, json);
  for (const [lang, name] of Object.entries(README)) {
    const file = join(ROOT_DIR, name);
    write(file, renderedReadme(readFileSync(file, 'utf8'), report, lang, name));
  }
  const site = join(ROOT_DIR, SITE);
  write(site, renderedSite(readFileSync(site, 'utf8'), report));
  for (const problem of staleRanges()) {
    stale++;
    console.error(`range out of date: ${problem}`);
  }
  if (check && stale) process.exitCode = 1;
  if (!check && !stale) console.log('benchmark docs already up to date');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
