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
import { priceOf } from './lib/pricing.mjs';
import { listResultFiles, readResultFile, readResults } from './lib/results.mjs';
import { median, pctDelta } from './lib/stats.mjs';
import { fmtNum, fmtPct, fmtSpread, fmtTokens, fmtUsd, successCell, summarize } from './report.mjs';

const REPORT_JSON = join(RESULTS_DIR, 'report.json');
// Opus before Sonnet before Haiku, newest version first: the order a reader
// expects, not the alphabetical order the raw files happen to have.
const FAMILY_RANK = { opus: 0, sonnet: 1, haiku: 2, fable: 3 };
const CONDS = ['baseline', 'thinwindow'];
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
    tasks: [...new Set(records.map((r) => r.task))].sort().length,
    runs: records.length,
    models,
  };
}

// --- README blocks -------------------------------------------------------

const pct1 = (n, dec) => (dec === ',' ? fmtPct(n).replace('.', ',') : fmtPct(n));
const mix1 = (n, dec) => `${n.toFixed(1).replace('.', dec)}%`;
const word = (n) => WORDS[n] || String(n);
const names = (ms, and) => ms.map((m) => m.label).join(', ').replace(/, ([^,]*)$/, ` ${and} $1`);
const allPassed = (m) => CONDS.every((c) => m.total[c].successes === m.total[c].runs);

// Where the tagline's token range comes from, for every model whose
// passing-runs figure differs from the all-runs one in the table above it.
function passedNote(report, L) {
  const [t0, t1] = ranges(report).tokens;
  const moved = report.models.filter((m) => fmtPct(m.total.successful.tokensDelta) !== fmtPct(m.total.tokensDelta));
  const clean = report.models.filter(allPassed);
  return [
    L.passedIntro(t0, t1),
    ...moved.map((m) => L.passedModel(m, pct1(m.total.successful.tokensDelta, L.dec), pct1(m.total.tokensDelta, L.dec))),
    clean.length ? L.passedAll(names(clean, L.and)) : '',
  ]
    .filter(Boolean)
    .join(' ');
}

// Rounded headline ranges, so the prose can never disagree with the table.
// The token range counts runs that passed their hidden check only, so a model
// can't look thrifty by failing (see summarize in report.mjs). The bill range
// is what context costs: cache writes plus cache reads, as a share of cost.
export function ranges(report) {
  const saved = report.models.map((m) => -m.total.successful.tokensDelta);
  const read = report.models.map((m) => m.tokenMix.cacheRead);
  const context = report.models.map((m) => m.costMix.cacheWrite + m.costMix.cacheRead);
  const out = report.models.map((m) => m.tokenMix.output);
  const r = (xs, f) => [f(Math.min(...xs)), f(Math.max(...xs))];
  return {
    tokens: r(saved, (x) => Math.round(x)),
    cacheRead: r(read, (x) => Math.round(x)),
    contextCost: r(context, (x) => Math.round(x)),
    outputCost: r(report.models.map((m) => m.costMix.output), (x) => Math.round(x)),
    output: r(out, (x) => x),
  };
}

const LOCALES = {
  en: {
    dec: '.',
    results: ['Model', 'Tokens (95% CI)', 'Tokens, passing runs', 'Cost (95% CI)', 'Success baseline → ThinWindow', 'Stopped by the turn cap', 'Runs'],
    cache: ['Model', 'Share of', 'Cache reads', 'Cache writes', 'Output'],
    shareOf: ['tokens', 'cost'],
    to: 'to',
    ciNote:
      "95% CI: bootstrap over the tasks. Where it includes zero, the change can't be told apart from none on this task set. " +
      "A run stopped by the turn cap ended at the limit before the agent finished; its tokens aren't comparable with a finished run's.",
    failed: (m, b, k) => `On ${m.label}, ThinWindow runs failed the hidden check more often than baseline runs: ${k.runs - k.successes} of ${k.runs} against ${b.runs - b.successes} of ${b.runs}.`,
    resultsNote: (r) =>
      `Same ${r.tasks} tasks, ${r.runs} runs, one agent per run, no cherry-picking:\n` +
      'every run recorded is in the table, except runs superseded by a later version\n' +
      'of the code on the same task, which are kept in\n' +
      '[`bench/results/archive/`](bench/results/archive). Per-task figures, the\n' +
      'spread and the raw data are in [Benchmark](#benchmark) below.',
    and: 'and',
    passedIntro: (t0, t1) => `The ${t0}–${t1}% at the top counts only runs that passed their hidden check.`,
    passedModel: (m, passed, all) =>
      `On ${m.label} that is ${passed} over the ${m.total.successful.pairedTasks} tasks where both conditions have a passing run, against ${all} over all ${m.total.pairedTasks}.`,
    passedAll: (list) => `${list} passed every run.`,
    benchIntro: (r) =>
      `${word(r.models.length)[0].toUpperCase()}${word(r.models.length).slice(1)} models, ${r.tasks} tasks, ${r.runs} runs. Charts and tables are generated by\n` +
      '[`bench/report.mjs`](bench/report.mjs) from the raw run files.',
    alt: (m) => `Change in total tokens per task, ${m.label}: bars left of zero mean fewer tokens with ThinWindow; whiskers span every pair of runs`,
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
      '95% CI: percentile bootstrap over the tasks (100,000 resamples) of the sum of the per-task medians. ' +
      "The chart's whiskers span every pairing of a ThinWindow run with a baseline run of the same task; where one crosses zero, the two conditions' ranges overlap. " +
      'The ThinWindow rules and thresholds were tuned on these same tasks.',
  },
  es: {
    dec: ',',
    results: ['Modelo', 'Tokens (IC 95%)', 'Tokens, corridas aprobadas', 'Costo (IC 95%)', 'Éxito base → ThinWindow', 'Cortadas por el tope de turnos', 'Corridas'],
    cache: ['Modelo', 'Proporción de', 'Lecturas de caché', 'Escrituras de caché', 'Salida'],
    shareOf: ['tokens', 'costo'],
    to: 'a',
    ciNote:
      'IC 95%: bootstrap sobre las tareas. Donde incluye el cero, el cambio no se distingue de ninguno en este conjunto de tareas. ' +
      'Una corrida cortada por el tope de turnos terminó en el límite antes de que el agente acabara; sus tokens no son comparables con los de una corrida terminada.',
    failed: (m, b, k) => `En ${m.label}, las corridas con ThinWindow fallaron la verificación oculta más veces que las base: ${k.runs - k.successes} de ${k.runs} frente a ${b.runs - b.successes} de ${b.runs}.`,
    resultsNote: (r) =>
      `Las mismas ${r.tasks} tareas, ${r.runs} corridas, un agente por corrida, sin descartar\n` +
      'ninguna: todas las que se registraron están en la tabla, salvo las que reemplazó\n' +
      'una versión posterior del código en la misma tarea, que se guardan en\n' +
      '[`bench/results/archive/`](bench/results/archive). El detalle por tarea y los\n' +
      'datos crudos están en [Benchmark](#benchmark).',
    and: 'y',
    passedIntro: (t0, t1) => `La cifra de arriba, entre un ${t0}% y un ${t1}%, cuenta solo las corridas que pasaron su verificación oculta.`,
    passedModel: (m, passed, all) =>
      `En ${m.label} eso da ${passed} sobre las ${m.total.successful.pairedTasks} tareas en las que ambas condiciones tienen una corrida aprobada, frente a ${all} sobre las ${m.total.pairedTasks}.`,
    passedAll: (list) => `${list} pasaron todas las corridas.`,
    benchIntro: (r) =>
      `${word(r.models.length)[0].toUpperCase()}${word(r.models.length).slice(1)}`,
    alt: (m) => `Cambio en tokens totales por tarea, ${m.label}: a la izquierda del cero, menos tokens con ThinWindow; los bigotes cubren cada par de corridas`,
  },
  'pt-BR': {
    dec: ',',
    results: ['Modelo', 'Tokens (IC 95%)', 'Tokens, execuções aprovadas', 'Custo (IC 95%)', 'Sucesso base → ThinWindow', 'Interrompidas pelo limite de turnos', 'Execuções'],
    cache: ['Modelo', 'Parcela de', 'Leituras de cache', 'Escritas de cache', 'Saída'],
    shareOf: ['tokens', 'custo'],
    to: 'a',
    ciNote:
      'IC 95%: bootstrap sobre as tarefas. Onde inclui o zero, a mudança não se distingue de nenhuma neste conjunto de tarefas. ' +
      'Uma execução interrompida pelo limite de turnos terminou no limite antes de o agente acabar; seus tokens não são comparáveis com os de uma execução concluída.',
    failed: (m, b, k) => `No ${m.label}, as execuções com ThinWindow falharam na verificação oculta mais vezes que as de base: ${k.runs - k.successes} de ${k.runs} contra ${b.runs - b.successes} de ${b.runs}.`,
    resultsNote: (r) =>
      `As mesmas ${r.tasks} tarefas, ${r.runs} execuções, um agente por execução, sem descartar\n` +
      'nenhuma: tudo o que foi registrado está na tabela, exceto as execuções que uma\n' +
      'versão posterior do código substituiu na mesma tarefa, guardadas em\n' +
      '[`bench/results/archive/`](bench/results/archive). O detalhe por tarefa e os\n' +
      'dados brutos estão em [Benchmark](#benchmark).',
    and: 'e',
    passedIntro: (t0, t1) => `A faixa de ${t0}% a ${t1}% no topo conta só as execuções que passaram na verificação oculta.`,
    passedModel: (m, passed, all) =>
      `No ${m.label}, isso dá ${passed} nas ${m.total.successful.pairedTasks} tarefas em que as duas condições têm uma execução aprovada, contra ${all} nas ${m.total.pairedTasks}.`,
    passedAll: (list) => `${list} passaram em todas as execuções.`,
    alt: (m) => `Mudança em tokens totais por tarefa, ${m.label}: à esquerda do zero, menos tokens com ThinWindow; as barras de erro cobrem cada par de execuções`,
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
  const ci = (d, range) => (range ? `${pct1(d, L.dec)} (${pct1(range[0], L.dec)} ${L.to} ${pct1(range[1], L.dec)})` : pct1(d, L.dec));
  const rows = report.models.map((m) => {
    const T = m.total;
    return [
      m.label,
      ci(T.tokensDelta, T.tokensCI),
      pct1(T.successful.tokensDelta, L.dec),
      ci(T.costDelta, T.costCI),
      `${successCell(T.baseline)} → ${successCell(T.thinwindow)}`,
      `${T.baseline.capped}/${T.baseline.runs} → ${T.thinwindow.capped}/${T.thinwindow.runs}`,
      String(m.runs),
    ];
  });
  const worse = report.models
    .filter((m) => m.total.thinwindow.runs - m.total.thinwindow.successes > m.total.baseline.runs - m.total.baseline.successes)
    .map((m) => L.failed(m, m.total.baseline, m.total.thinwindow));
  return [
    table(L.results, ['---', '---:', '---:', '---:', ':---:', ':---:', '---:'], rows),
    L.resultsNote(report),
    [passedNote(report, L), ...worse, L.ciNote].join(' '),
  ].join('\n\n');
}

export function cacheBlock(report, lang) {
  const L = LOCALES[lang];
  const rows = report.models.flatMap((m) =>
    [m.tokenMix, m.costMix].map((mix, i) => [
      i === 0 ? m.label : '',
      L.shareOf[i],
      mix1(mix.cacheRead, L.dec),
      mix1(mix.cacheWrite, L.dec),
      mix1(mix.output, L.dec),
    ]),
  );
  return table(L.cache, ['---', '---', '---:', '---:', '---:'], rows);
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
    `success counts every run. ${passedNote(report, LOCALES.en)}</p>`
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
// Each phrase carries its quantity (of tokens, of the bill), so a sentence
// can't drift into quoting a token share as a share of cost.
export function rangeClaims(report) {
  const r = ranges(report);
  const [t0, t1] = r.tokens;
  const [c0, c1] = r.cacheRead;
  const [x0, x1] = r.contextCost;
  const [p0, p1] = r.outputCost;
  const o0 = r.output[0].toFixed(1);
  const o1 = r.output[1].toFixed(1);
  const es = (x) => x.replace('.', ',');
  const tagline = [`${c0}–${c1}% of tokens`, `${x0}–${x1}% of the bill`, `${t0}–${t1}% fewer tokens`];
  return [
    ['README.md', [...tagline, `${c0}% to ${c1}%`, `${o0}% to ${o1}%`, `${p0}–${p1}% of the cost`]],
    [
      'README.es.md',
      [
        `entre el ${c0}% y el ${c1}% de los tokens`,
        `entre el ${x0}% y el ${x1}% de la factura`,
        `entre un ${t0}% y un ${t1}% menos de tokens`,
        `entre el ${es(o0)}% y el ${es(o1)}%`,
        `entre el ${p0}% y el ${p1}% del costo`,
      ],
    ],
    [
      'README.pt-BR.md',
      [`de ${c0}% a ${c1}% dos tokens`, `de ${x0}% a ${x1}% da conta`, `de ${t0}% a ${t1}% menos tokens`, `${es(o0)}% a ${es(o1)}%`, `de ${p0}% a ${p1}% do custo`],
    ],
    ['package.json', tagline],
    ['.claude-plugin/plugin.json', tagline],
    ['.claude-plugin/marketplace.json', tagline],
    [SITE, [...tagline, `${c0}% to ${c1}%`, `under ${Math.ceil(r.output[1])}% of tokens`, `${p0}–${p1}% of the cost`]],
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

// --- Tier 1: tool output replayed without a model ----------------------------

const INPUT_SIZE = join(RESULTS_DIR, 'input-size.json');

export function readTier1(file = INPUT_SIZE) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

const TIER1 = {
  en: {
    head: ['Model', 'Calls in the baseline traces', 'Replayed', 'Changed by the hooks', 'Tool output of the replayed calls (characters)', 'Change'],
    mechHead: ['What the hook did', 'Calls', 'Before', 'After', 'Calls that grew'],
    num: (n) => n.toLocaleString('en-US'),
    skipped: (cut, other, lost) =>
      `Not replayed: ${cut} calls the trace cut short (it keeps 140 characters of each), ${other} that write files, run a script or change the repository, and ${lost} whose file could not be matched.`,
    model: (m, t, cost) =>
      `${m.label}: the hooks change ${t.changed} of ${t.calls} calls and ${t.delta < 0 ? 'cut the replayed tool output by' : 'add'} ${fmtPct(Math.abs(t.delta)).replace(/^[+−]/, '')}${t.delta < 0 ? '' : ' to the replayed tool output'}; ` +
      `in the benchmark they acted in ${t.acted} of ${t.runs} ThinWindow runs, and the measured change in cost is ${cost}.`,
    close:
      'Where the hooks barely act, the measured change comes from the rules, which change what the agent does, or from run-to-run noise, not from trimming tool output.',
    costLead: 'The change in the bill is a different quantity, measured in [Benchmark](#benchmark), and not the same size:',
  },
  es: {
    head: ['Modelo', 'Llamadas en las trazas base', 'Repetidas', 'Cambiadas por los hooks', 'Salida de las llamadas repetidas (caracteres)', 'Cambio'],
    num: (n) => n.toLocaleString('es-ES'),
    skipped: (cut, other, lost) =>
      `Sin repetir: ${cut} llamadas que la traza cortó (guarda 140 caracteres de cada una), ${other} que escriben archivos, corren un script o cambian el repositorio, y ${lost} cuyo archivo no se pudo identificar.`,
    model: (m, t, cost) =>
      `${m.label}: los hooks cambian ${t.changed} de ${t.calls} llamadas y ${t.delta < 0 ? 'recortan' : 'agrandan'} la salida repetida un ${fmtPct(Math.abs(t.delta)).replace(/^[+−]/, '').replace('.', ',')}; ` +
      `en el benchmark actuaron en ${t.acted} de ${t.runs} corridas con ThinWindow, y el cambio medido en el costo es ${cost}.`,
    close:
      'Donde los hooks casi no actúan, el cambio medido viene de las reglas, que cambian lo que hace el agente, o del ruido entre corridas, no de recortar la salida de las herramientas.',
    costLead: 'El cambio en la factura es otra magnitud, medida en [Benchmark](#benchmark), y no del mismo tamaño:',
  },
  'pt-BR': {
    head: ['Modelo', 'Chamadas nos rastros base', 'Repetidas', 'Alteradas pelos hooks', 'Saída das chamadas repetidas (caracteres)', 'Mudança'],
    num: (n) => n.toLocaleString('pt-BR'),
    skipped: (cut, other, lost) =>
      `Não repetidas: ${cut} chamadas que o rastro cortou (ele guarda 140 caracteres de cada), ${other} que escrevem arquivos, rodam um script ou mudam o repositório, e ${lost} cujo arquivo não pôde ser identificado.`,
    model: (m, t, cost) =>
      `${m.label}: os hooks alteram ${t.changed} de ${t.calls} chamadas e ${t.delta < 0 ? 'reduzem' : 'aumentam'} a saída repetida em ${fmtPct(Math.abs(t.delta)).replace(/^[+−]/, '').replace('.', ',')}; ` +
      `no benchmark agiram em ${t.acted} de ${t.runs} execuções com ThinWindow, e a mudança medida no custo é ${cost}.`,
    close:
      'Onde os hooks quase não agem, a mudança medida vem das regras, que mudam o que o agente faz, ou do ruído entre execuções, não de cortar a saída das ferramentas.',
    costLead: 'A mudança na conta é outra grandeza, medida em [Benchmark](#benchmark), e não do mesmo tamanho:',
  },
};

// Per model: calls, replayed calls, calls the hooks change, and the replayed
// output before and after; plus how often the hooks acted in the real runs.
function tier1Models(report, records, tier1) {
  return report.models.map((m) => {
    const rows = tier1.calls.filter((c) => c.model === m.id);
    const replayed = rows.filter((c) => Number.isFinite(c.before));
    const before = replayed.reduce((a, c) => a + c.before, 0);
    const after = replayed.reduce((a, c) => a + c.after, 0);
    const tw = records.filter((r) => (r.modelResolved || r.model) === m.id && r.condition === 'thinwindow');
    return {
      m,
      calls: rows.length,
      replayed: replayed.length,
      changed: rows.filter((c) => c.hook && c.hook !== 'none').length,
      before,
      after,
      delta: pctDelta(before, after),
      acted: tw.filter((r) => Object.values(r.thinwindow || {}).some((v) => v > 0)).length,
      runs: tw.length,
    };
  });
}

export function tier1Block(report, records, tier1, lang) {
  const L = TIER1[lang];
  const dec = lang === 'en' ? '.' : ',';
  const models = tier1Models(report, records, tier1);
  const parts = [
    table(
      L.head,
      ['---', '---:', '---:', '---:', '---:', '---:'],
      models.map((t) => [t.m.label, String(t.calls), String(t.replayed), String(t.changed), `${L.num(t.before)} → ${L.num(t.after)}`, pct1(t.delta, dec)]),
    ),
  ];
  if (L.mechHead) {
    const groups = new Map();
    for (const c of tier1.calls.filter((x) => x.hook && x.hook !== 'none' && Number.isFinite(x.before))) {
      const key = (c.why && c.why[0]) || c.hook;
      const g = groups.get(key) || { n: 0, before: 0, after: 0, grew: 0 };
      g.n++;
      g.before += c.before;
      g.after += c.after;
      if (c.after > c.before) g.grew++;
      groups.set(key, g);
    }
    parts.push(
      table(
        L.mechHead,
        ['---', '---:', '---:', '---:', '---:'],
        [...groups.entries()].sort((a, b) => b[1].before - a[1].before).map(([k, g]) => [k[0].toUpperCase() + k.slice(1), String(g.n), L.num(g.before), L.num(g.after), String(g.grew)]),
      ),
    );
  }
  const count = (re) => tier1.calls.filter((c) => c.skipped && re.test(c.skipped)).length;
  parts.push(L.skipped(count(/cut short/), count(/writes|runs code|heredoc|changes the repository|unparsed|background/), count(/path not found/)));
  const cost = (m) => `${pct1(m.total.costDelta, dec)} (${lang === 'en' ? '95% CI' : 'IC 95%'} ${pct1(m.total.costCI[0], dec)} ${LOCALES[lang].to} ${pct1(m.total.costCI[1], dec)})`;
  parts.push([L.costLead, ...models.map((t) => `- ${L.model(t.m, t, cost(t.m))}`)].join('\n'));
  parts.push(L.close);
  return parts.join('\n\n');
}

// --- docs/WHERE-THE-TOKENS-GO.md ----------------------------------------------

const WHERE = 'docs/WHERE-THE-TOKENS-GO.md';
const pct = (n) => mix1(n, '.');
const share = (n, d) => (d ? pct((100 * n) / d) : '–');
const byModelRuns = (report, records) =>
  report.models.map((m) => ({ m, runs: records.filter((r) => (r.modelResolved || r.model) === m.id) }));
const cond = (runs, c) => runs.filter((r) => r.condition === c);
const sources = (m) => `Raw runs: ${m.resultFiles.map((f) => `[\`${f}\`](../${f})`).join(', ')}.`;

function mixBlock(report, records) {
  const rows = byModelRuns(report, records).flatMap(({ m, runs }) =>
    CONDS.flatMap((c) =>
      [tokenMix(cond(runs, c)), costMix(cond(runs, c))].map((mix, i) => [
        i === 0 && c === 'baseline' ? m.label : '',
        i === 0 ? c : '',
        i === 0 ? 'tokens' : 'cost',
        pct(mix.input),
        pct(mix.cacheWrite),
        pct(mix.cacheRead),
        pct(mix.output),
      ]),
    ),
  );
  return table(['Model', 'Condition', 'Share of', 'Input', 'Cache writes', 'Cache reads', 'Output'], ['---', '---', '---', '---:', '---:', '---:', '---:'], rows);
}

function pricesBlock(report, records) {
  const rows = byModelRuns(report, records).map(({ m, runs }) => {
    const p = priceOf(m.id);
    const cost = (r) => (r.inputTokens * p.input + r.cacheCreationTokens * p.cacheWrite + r.cacheReadTokens * p.cacheRead + r.outputTokens * p.output) / 1e6;
    const recorded = runs.reduce((a, r) => a + r.costUsd, 0);
    const priced = runs.reduce((a, r) => a + cost(r), 0);
    const gap = Math.max(...runs.map((r) => Math.abs(cost(r) - r.costUsd)));
    return [m.label, `$${p.input}`, `$${p.cacheWrite}`, `$${p.cacheRead}`, `$${p.output}`, String(runs.length), `$${recorded.toFixed(4)}`, `$${priced.toFixed(4)}`, `$${gap.toFixed(6)}`];
  });
  return table(
    ['Model', 'Input', 'Cache write (1 hour)', 'Cache read', 'Output', 'Runs', '`total_cost_usd`, sum', 'Tokens × prices, sum', 'Largest gap, one run'],
    ['---', ...Array(8).fill('---:')],
    rows,
  );
}

function twiceBlock(report, records) {
  const rows = byModelRuns(report, records).map(({ m, runs }) => {
    const p = priceOf(m.id);
    const turns = median(cond(runs, 'baseline').map((r) => r.numTurns));
    return [m.label, fmtNum(turns), `$${p.cacheWrite}`, `$${p.cacheRead}`, `${fmtNum(p.cacheWrite / p.cacheRead)}×`, pct((100 * p.cacheWrite) / (p.cacheWrite + p.cacheRead * (turns - 1)))];
  });
  return table(
    ['Model', 'Median turns, baseline run', 'Cache write', 'Cache read', 'Write ÷ read', 'Write share of a turn-1 token'],
    ['---', '---:', '---:', '---:', '---:', '---:'],
    rows,
  );
}

const TOOL_COLUMNS = ['Bash', 'Read', 'Edit', 'Write', 'Grep', 'Glob'];

function toolsBlock(report, records) {
  const rows = byModelRuns(report, records).flatMap(({ m, runs }) =>
    CONDS.map((c) => {
      const calls = cond(runs, c).flatMap((r) => (r.trace || []).map((s) => s.split(/[ []/)[0]));
      // A few calls are sent as `bash`; Claude Code runs them as Bash.
      const n = (tool) => calls.filter((t) => t.toLowerCase() === tool.toLowerCase()).length;
      const other = calls.length - TOOL_COLUMNS.reduce((a, t) => a + n(t), 0);
      return [c === 'baseline' ? m.label : '', c, String(calls.length), ...TOOL_COLUMNS.map((t) => share(n(t), calls.length)), share(other, calls.length)];
    }),
  );
  return table(['Model', 'Condition', 'Tool calls', ...TOOL_COLUMNS, 'Other'], ['---', '---', ...Array(8).fill('---:')], rows);
}

function hooksBlock(report, records) {
  const rows = byModelRuns(report, records).map(({ m, runs }) => {
    const tw = cond(runs, 'thinwindow');
    const stats = tw.map((r) => r.thinwindow || {});
    const sum = (re) => stats.reduce((a, s) => a + Object.entries(s).filter(([k]) => re.test(k)).reduce((b, [, v]) => b + v, 0), 0);
    const acted = stats.filter((s) => Object.values(s).some((v) => v > 0)).length;
    return [m.label, String(tw.length), String(acted), String(sum(/\.rewrite$/)), String(sum(/\.deny$/))];
  });
  return table(['Model', 'ThinWindow runs', 'Runs where a hook acted', 'Rewrites', 'Refusals'], ['---', '---:', '---:', '---:', '---:'], rows);
}

// Total token change over a subset of runs: sum of per-task medians over the
// tasks where both conditions keep at least one run.
function subsetDelta(runs, keep, tasks = null) {
  const ids = [...new Set(runs.map((r) => r.task))].filter((t) => !tasks || tasks.includes(t));
  const pairs = ids
    .map((t) => CONDS.map((c) => median(runs.filter((r) => r.task === t && r.condition === c && keep(r)).map((r) => r.totalTokens))))
    .filter(([b, k]) => b !== null && k !== null);
  return { tasks: pairs.length, ids, delta: pctDelta(pairs.reduce((a, [b]) => a + b, 0), pairs.reduce((a, [, k]) => a + k, 0)), pairs };
}

function qualityBlock(report, records) {
  const rows = byModelRuns(report, records).map(({ m, runs }) => {
    const T = m.total;
    const passTasks = [...new Set(runs.map((r) => r.task))].filter((t) => CONDS.every((c) => runs.some((r) => r.task === t && r.condition === c && r.success === true)));
    const same = subsetDelta(runs, () => true, passTasks);
    const finished = subsetDelta(runs, (r) => r.subtype !== 'error_max_turns');
    const cell = (x) => `${fmtPct(x.delta)} (${x.tasks})`;
    const capPassed = cond(runs, 'baseline').filter((r) => r.subtype === 'error_max_turns' && r.success === true).length;
    return [
      m.label,
      `${T.baseline.capped}/${T.baseline.runs} → ${T.thinwindow.capped}/${T.thinwindow.runs}`,
      T.baseline.capped ? `${capPassed}/${T.baseline.capped}` : '–',
      `${T.baseline.runs - T.baseline.successes}/${T.baseline.runs} → ${T.thinwindow.runs - T.thinwindow.successes}/${T.thinwindow.runs}`,
      `${fmtPct(T.tokensDelta)} (${T.pairedTasks})`,
      `${fmtPct(T.successful.tokensDelta)} (${T.successful.pairedTasks})`,
      cell(same),
      cell(finished),
    ];
  });
  return table(
    ['Model', 'Stopped by the turn cap', 'Of those, baseline runs that passed', 'Failed the hidden check', 'Tokens, all runs (tasks)', 'Passing runs only', 'All runs, same tasks as passing', 'Finished runs only'],
    ['---', ':---:', ':---:', ':---:', '---:', '---:', '---:', '---:'],
    rows,
  );
}

function sourcesBlock(report) {
  return report.models.map((m) => `- ${m.label}: ${sources(m)}`).join('\n');
}

export function renderedWhere(text, report, records) {
  const blocks = {
    MIX: mixBlock(report, records),
    PRICES: pricesBlock(report, records),
    TWICE: twiceBlock(report, records),
    TOOLS: toolsBlock(report, records),
    HOOKS: hooksBlock(report, records),
    QUALITY: qualityBlock(report, records),
    SOURCES: sourcesBlock(report),
  };
  return Object.entries(blocks).reduce((out, [name, body]) => replaceBlock(out, name, body, WHERE), text);
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

export function renderedReadme(text, report, lang, file, records = readResults(), tier1 = readTier1()) {
  let out = replaceBlock(text, 'RESULTS', resultsBlock(report, lang), file);
  out = replaceBlock(out, 'CACHE', cacheBlock(report, lang), file);
  out = replaceBlock(out, 'TIER1', tier1Block(report, records, tier1, lang), file);
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
  const where = join(root, WHERE);
  const whereText = readFileSync(where, 'utf8');
  if (renderedWhere(whereText, report, readResults()) !== whereText) stale.push(where);
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
  const where = join(ROOT_DIR, WHERE);
  write(where, renderedWhere(readFileSync(where, 'utf8'), report, readResults()));
  for (const problem of staleRanges()) {
    stale++;
    console.error(`range out of date: ${problem}`);
  }
  if (check && stale) process.exitCode = 1;
  if (!check && !stale) console.log('benchmark docs already up to date');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
