#!/usr/bin/env node
// How often the recorded benchmark runs followed each rule in
// rules/thinwindow.md, by model, ThinWindow release and condition (#36). No
// new runs: it reads bench/results/*.jsonl and bench/results/archive/*.jsonl
// (not experiments/, whose rows have another shape) and prints markdown.
//
//   node bench/compliance.mjs
//
// - Runs are grouped by their own thinwindowCommit and modelResolved, never
//   by file name: the archive files mix commits, and some runs appear in two
//   files (same sessionId). Each run counts once.
// - The thinwindow condition is the rules and the hooks together, so a
//   difference from the baseline can come from either.
// - A trace keeps 140 characters per call. In a call that long, only the
//   commands before the cut are read. Only 0.3.0 keeps the last 200
//   characters of each result (traceTails).
// - The rules named are the ones the runs had, not the current file.
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipelineCapped } from '../hooks/lib/bash-guard.mjs';
import { DEFAULT_NOISY_COMMANDS } from '../hooks/lib/config.mjs';
import { baseName, commandWords, parseShell } from '../hooks/lib/shell.mjs';
import { modelLabel } from './docs.mjs';
import { parseStep } from './input-size.mjs';
import { RESULTS_DIR } from './lib/paths.mjs';
import { listResultFiles, readResultFile } from './lib/results.mjs';
import { median } from './lib/stats.mjs';

// The release each measured commit belongs to. The rules file is
// byte-identical from 528598a to 6546385; ce45cd1 is the variant 05cc89d
// reverted, so its runs are neither 0.2.2 nor 0.3.0.
const RELEASES = {
  'a5329a7': '0.1.0',
  '1896071': '0.1.0',
  '528598a': '0.2.2',
  'a6ebe93': '0.2.2',
  '05cc89d': '0.2.2',
  '30e9c6b': '0.2.2',
  'ce45cd1': 'ce45cd1',
  '6546385': '0.3.0',
};
const ORDER = ['0.1.0', '0.2.2', 'ce45cd1', '0.3.0'];
// The early batches count only where no trace is needed: one has no traces,
// the other has them in 32 of its 48 runs.
const UNTRACED = new Set(['a5329a7', '1896071']);

export function loadRuns(dirs = [RESULTS_DIR, join(RESULTS_DIR, 'archive')]) {
  const seen = new Set();
  return dirs.flatMap((d) => listResultFiles(d)).flatMap(readResultFile).filter((r) => {
    const key = r.sessionId ?? `${r.startedAt} ${r.task} ${r.condition}`;
    return !seen.has(key) && seen.add(key);
  });
}

const steps = (r) => (Array.isArray(r.trace) && !UNTRACED.has(r.thinwindowCommit) ? r.trace.map(parseStep) : null);
const argvOf = (stage) => commandWords(stage).words.map((w) => w.text);
const files = (argv) => argv.slice(1).filter((a) => !a.startsWith('-'));
const writesStdout = (p) => p.stages.some((s) => s.redirects.some((r) => /^&?>/.test(r.op) && r.fd !== '2'));

// The complete pipelines of the Bash calls: a call cut short loses its last one.
function pipelines(list) {
  return list.flatMap((s) => {
    if (s?.tool !== 'Bash') return [];
    const parsed = parseShell(s.arg);
    if (!parsed.ok) return [];
    return parsed.pipelines.slice(0, s.cut ? -1 : undefined).filter((p) => !p.background);
  });
}

// Every read of a file: true when it asked for a range. A cat capped by a
// later stage (| head, | grep) counts as a range.
export function reads(list) {
  const out = list.filter((s) => s?.tool === 'Read').map((s) => s.offset !== undefined);
  for (const p of pipelines(list)) {
    const argv = argvOf(p.stages[0]);
    const name = baseName(argv[0] || '');
    if (['cat', 'nl', 'bat'].includes(name) && files(argv).length && !writesStdout(p)) out.push(pipelineCapped(p));
    else if ((name === 'sed' && argv.includes('-n') && files(argv).length > 1) || (['head', 'tail'].includes(name) && files(argv).length)) out.push(true);
  }
  return out;
}

const NOISY = DEFAULT_NOISY_COMMANDS.map((s) => new RegExp(s));
// As in hooks/lib/bash-guard.mjs.
const QUIET = /^(-q+|--quiet|--silent|--reporter=(dot|dots|silent|min|summary)|--(log-?level)=(error|silent|quiet))$/;

// Each install, build or test the agent ran: true when capped, quiet or
// through thinwindow-run.
export function noisy(list) {
  const out = [];
  for (const p of pipelines(list)) {
    let argv = argvOf(p.stages[0]);
    const runner = baseName(argv[0] || '') === 'thinwindow-run' || /thinwindow-run\.mjs$/.test(argv[1] || '');
    if (runner) argv = argv.slice(baseName(argv[0]) === 'node' ? 2 : 1);
    if (NOISY.some((re) => re.test(argv.join(' ')))) out.push(runner || pipelineCapped(p) || argv.some((a) => QUIET.test(a)));
  }
  return out;
}

// Each git log (or git diff) call: true when limited by -n, a date or a range
// (or summarized by --stat or a path after --), or capped by a later stage.
function git(list, sub) {
  const out = [];
  for (const p of pipelines(list)) {
    const argv = argvOf(p.stages[0]);
    if (baseName(argv[0] || '') !== 'git') continue;
    let k = 1;
    while (k < argv.length && argv[k].startsWith('-')) k += argv[k] === '-C' || argv[k] === '-c' ? 2 : 1;
    if (argv[k] !== sub) continue;
    const args = argv.slice(k + 1);
    const dash = args.indexOf('--');
    const ok = sub === 'log'
      ? args.some((a) => /^-n\d*$|^-\d+$|^--max-count|^--(since|after|until|before)/.test(a) || (!a.startsWith('-') && a.includes('..')))
      : args.some((a) => /^--(stat|shortstat|numstat|name-only|name-status|compact-summary|summary)/.test(a)) || (dash !== -1 && dash < args.length - 1);
    out.push(ok || pipelineCapped(p));
  }
  return out;
}

// The last line number a Read result shows: the last n whose n − 1 comes
// before it (line numbers run in order; other numbers rarely do).
export function lastLine(tail) {
  const nums = String(tail || '').split(' ').filter((t) => /^\d+$/.test(t)).map(Number);
  for (let i = nums.length - 1; i > 0; i--) if (nums.slice(0, i).includes(nums[i] - 1)) return nums[i];
  return null;
}

const rel = (arg) => /thinwindow-bench-[A-Za-z0-9-]+?-[A-Za-z0-9]{6}\/(.*)$/.exec(arg)?.[1] ?? arg;
// The trace may cut either path short.
const samePath = (a, b) => a.startsWith(b) || b.startsWith(a);
const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
// Claude Code's own answer to an unchanged re-read, or the hook's refusal.
const REREAD = /file unchanged since|already in your context and has not changed/i;
const share = (list) => [list.filter(Boolean).length, list.length];

// kind: 'share' pools [hits, of] over the runs; 'median' and 'mean' take one
// number per run. better: the way the rule asks the number to move. A run
// gives null when its record can't answer.
const METRICS = [
  {
    rule: 'Locate before reading; read only the range',
    measure: 'reads that asked for a range (Read, cat, sed -n, head, tail)',
    kind: 'share',
    better: 1,
    run: (r, s) => s && share(reads(s)),
  },
  {
    rule: "Don't read whole files over ~300 lines",
    measure: 'whole-file Reads of over 300 lines, per run (needs tails)',
    kind: 'mean',
    better: -1,
    // The hook cut the ones over 400 lines to 120 lines, and counted them.
    run: (r, s) => s && Array.isArray(r.traceTails)
      ? (r.thinwindow?.['Read.rewrite'] ?? 0) + s.filter((x, i) => x?.tool === 'Read' && x.offset === undefined && lastLine(r.traceTails[i]) > 300).length
      : null,
  },
  {
    rule: "Don't re-read what is already in context",
    measure: 'Reads answered "unchanged since you read it", per run (needs tails)',
    kind: 'mean',
    better: -1,
    run: (r, s) => (s && Array.isArray(r.traceTails) ? r.traceTails.filter((t) => REREAD.test(t || '')).length : null),
  },
  {
    rule: 'Batch independent lookups into one call',
    measure: 'tool calls per turn (median)',
    kind: 'median',
    better: 1,
    run: (r, s) => s && s.length / Math.max(1, r.numTurns),
  },
  {
    rule: 'Stop exploring once you have enough to act',
    measure: 'calls before the first Edit or Write (median)',
    kind: 'median',
    better: -1,
    run: (r, s) => {
      const i = s ? s.findIndex((x) => EDITS.has(x?.tool)) : -1;
      return i === -1 ? null : i;
    },
  },
  {
    rule: "Don't send a subagent to explore what one grep answers",
    measure: 'subagent calls, per run',
    kind: 'mean',
    better: -1,
    run: (r, s) => s && s.filter((x) => x?.tool === 'Agent' || x?.tool === 'Task').length,
  },
  {
    rule: 'Cap command output',
    measure: 'installs, builds and tests capped, quiet or through thinwindow-run',
    kind: 'share',
    better: 1,
    run: (r, s) => s && share(noisy(s)),
  },
  { rule: 'Summaries first: `git log -n 10 --oneline`', measure: 'git log calls with a limit', kind: 'share', better: 1, run: (r, s) => s && share(git(s, 'log')) },
  { rule: 'Summaries first: `git diff --stat`', measure: 'git diff calls with a summary flag or a path', kind: 'share', better: 1, run: (r, s) => s && share(git(s, 'diff')) },
  {
    rule: 'Make the smallest change that works',
    measure: 'Writes over a file the run had Read, per run',
    kind: 'mean',
    better: -1,
    run: (r, s) => {
      if (!s) return null;
      const read = [];
      let n = 0;
      for (const x of s) {
        if (x?.tool === 'Read') read.push(rel(x.arg));
        else if (x?.tool === 'Write' && read.some((f) => samePath(f, rel(x.arg)))) n++;
      }
      return n;
    },
  },
  { rule: 'Say less, write less', measure: 'output tokens per run (median)', kind: 'median', better: -1, run: (r) => r.outputTokens },
  { rule: 'Say less, write less', measure: 'output tokens per turn (median)', kind: 'median', better: -1, run: (r) => r.outputTokens / Math.max(1, r.numTurns) },
  { rule: 'Never cut validation, error handling, security or tests', measure: 'runs that passed the hidden check', kind: 'share', better: 1, run: (r) => [r.success ? 1 : 0, 1] },
];

// Rules with nothing to measure: the runner keeps no message text, and a
// trace keeps no edit content.
const UNMEASURED = [
  'To count, search or summarize across many files, run one command that prints only the answer.',
  'Before adding code, check that it needs to exist, that the codebase does not have it, and that the platform does not do it.',
  "Don't add comments or docstrings that restate the code.",
  "Don't narrate between tool calls (only output tokens show it).",
  'End with at most three lines; no preamble, no restating the task, no recap (only output tokens show it).',
  'Cite `file:line` instead of pasting code back.',
];

function aggregate(m, values) {
  const v = values.filter((x) => x !== null && x !== undefined);
  if (m.kind === 'share') {
    const [hit, of] = v.reduce(([a, b], [c, d]) => [a + c, b + d], [0, 0]);
    return of ? { value: hit / of, text: `${Math.round((100 * hit) / of)}% (${hit}/${of})` } : null;
  }
  if (!v.length) return null;
  const value = m.kind === 'median' ? median(v) : v.reduce((a, b) => a + b, 0) / v.length;
  return { value, text: value >= 100 ? Math.round(value).toLocaleString('en-US') : value.toFixed(2) };
}

// Model, release, then condition: the cell of each metric, and how many tasks
// moved the way the rule asks (better / worse / same).
export function compliance(runs = loadRuns()) {
  const groups = new Map();
  for (const r of runs) {
    const release = RELEASES[r.thinwindowCommit] ?? r.thinwindowCommit;
    const key = `${r.modelResolved} ${release}`;
    if (!groups.has(key)) groups.set(key, { model: r.modelResolved, ...modelLabel(r.modelResolved), release, runs: [] });
    groups.get(key).runs.push({ r, s: steps(r) });
  }
  const rank = { opus: 0, sonnet: 1, haiku: 2 };
  const sorted = [...groups.values()].sort((a, b) => (rank[a.family] ?? 9) - (rank[b.family] ?? 9) || a.label.localeCompare(b.label, 'en', { numeric: true }) || ORDER.indexOf(a.release) - ORDER.indexOf(b.release));
  return sorted.map((g) => {
    const of = (cond) => g.runs.filter((x) => x.r.condition === cond);
    const rows = METRICS.map((m) => {
      const cell = (list) => aggregate(m, list.map(({ r, s }) => m.run(r, s)));
      const base = cell(of('baseline'));
      const tw = cell(of('thinwindow'));
      const tally = [0, 0, 0];
      for (const task of new Set(g.runs.map((x) => x.r.task))) {
        const b = cell(of('baseline').filter((x) => x.r.task === task));
        const t = cell(of('thinwindow').filter((x) => x.r.task === task));
        if (b && t) tally[t.value === b.value ? 2 : Math.sign(t.value - b.value) === m.better ? 0 : 1]++;
      }
      return { metric: m, base, tw, tally: base && tw ? tally : null };
    });
    const commits = [...new Set(g.runs.map((x) => x.r.thinwindowCommit))];
    const versions = [...new Set(g.runs.map((x) => x.r.claudeVersion))];
    const rules = [...new Set(g.runs.map((x) => x.r.rulesChars))];
    return { ...g, commits, versions, rules, n: { baseline: of('baseline').length, thinwindow: of('thinwindow').length }, rows };
  });
}

function markdown(groups) {
  const out = [
    '| Model | Release | Commits | Claude Code | Rules (chars) | Runs, baseline / ThinWindow | Traced |',
    '| --- | --- | --- | --- | ---: | ---: | --- |',
    ...groups.map((g) =>
      `| ${g.label} | ${g.release} | ${g.commits.join(', ')} | ${g.versions.join(', ')} | ${g.rules.join(', ')} | ${g.n.baseline} / ${g.n.thinwindow} | ` +
      `${g.runs.some((x) => x.s) ? (g.runs.some((x) => Array.isArray(x.r.traceTails)) ? 'calls and result tails' : 'calls') : 'no'} |`),
    '',
    '| Rule | Measure | Model | Release | Baseline | ThinWindow | Tasks: better / worse / same |',
    '| --- | --- | --- | --- | ---: | ---: | :---: |',
  ];
  for (const m of METRICS) {
    let first = true;
    for (const g of groups) {
      const row = g.rows.find((x) => x.metric === m);
      if (!row.base && !row.tw) continue;
      out.push(`| ${first ? m.rule : ''} | ${first ? m.measure : ''} | ${g.label} | ${g.release} | ${row.base?.text ?? '–'} | ${row.tw?.text ?? '–'} | ${row.tally ? row.tally.join(' / ') : '–'} |`);
      first = false;
    }
  }
  out.push(
    '',
    'Tasks: among the tasks with both conditions, how many moved the way the rule asks, the other way, or not at all.',
    "Baseline runs don't load ThinWindow. ce45cd1 on Sonnet 5 has none of its own: it was measured against 0.2.2's baseline, the same runs (labeled 528598a).",
    '',
    'Not in the records:',
    '',
    ...UNMEASURED.map((u) => `- ${u}`),
  );
  return `${out.join('\n')}\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.stdout.write(markdown(compliance()));
