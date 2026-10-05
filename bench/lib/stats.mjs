// Small statistics helpers for the report.

// Seeded uniform numbers in [0, 1), so intervals and run orders can be
// reproduced.
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rand) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function median(values) {
  const v = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function spread(values) {
  const v = values.filter(Number.isFinite);
  if (v.length === 0) return null;
  return { min: Math.min(...v), max: Math.max(...v) };
}

// Relative change from `before` to `after`, in percent.
export function pctDelta(before, after) {
  if (!Number.isFinite(before) || !Number.isFinite(after) || before === 0) return null;
  return ((after - before) / before) * 100;
}

// 95% percentile-bootstrap interval of the relative change of a sum, over
// [before, after] pairs (one per task): resample the pairs with replacement
// and recompute (Σ after − Σ before) / Σ before. Seeded, so the interval in
// the docs can be reproduced. Only the tasks are resampled; the run-to-run
// noise inside a task is already folded into its median.
export function bootstrapDelta(pairs, { reps = 100000, seed = 1 } = {}) {
  if (pairs.length < 2) return null;
  const rand = mulberry32(seed);
  const deltas = new Float64Array(reps);
  for (let i = 0; i < reps; i++) {
    let before = 0;
    let after = 0;
    for (let j = 0; j < pairs.length; j++) {
      const [b, a] = pairs[Math.floor(rand() * pairs.length)];
      before += b;
      after += a;
    }
    deltas[i] = (100 * (after - before)) / before;
  }
  deltas.sort();
  return [deltas[Math.floor(0.025 * reps)], deltas[Math.ceil(0.975 * reps) - 1]];
}

// --- 0.4.0 and later (#37): runs within a task vary too -------------------

// 95% hierarchical bootstrap of a statistic over tasks: resample the tasks
// with replacement, then the runs within each sampled task and condition.
// `groups` holds one { baseline: [runs], thinwindow: [runs] } per task, and
// `stat(groups)` returns a log-ratio (thinwindow over baseline). Resamples
// where the statistic is undefined (no passing run in a condition) are
// dropped and counted. `mde` is the smallest effect, on the log scale, that a
// 5% two-sided test detects with 80% power: (1.96 + 0.84) × standard error.
export function hierarchicalBootstrap(groups, stat, { reps = 20000, seed = 1 } = {}) {
  if (groups.length < 2) return null;
  const rand = mulberry32(seed);
  const pick = (a) => a[Math.floor(rand() * a.length)];
  const draws = [];
  for (let i = 0; i < reps; i++) {
    const sample = groups.map(() => {
      const g = pick(groups);
      return { baseline: g.baseline.map(() => pick(g.baseline)), thinwindow: g.thinwindow.map(() => pick(g.thinwindow)) };
    });
    const v = stat(sample);
    if (Number.isFinite(v)) draws.push(v);
  }
  if (draws.length < 2) return null;
  draws.sort((a, b) => a - b);
  const mean = draws.reduce((a, v) => a + v, 0) / draws.length;
  const se = Math.sqrt(draws.reduce((a, v) => a + (v - mean) ** 2, 0) / (draws.length - 1));
  const q = (p) => draws[Math.min(draws.length - 1, Math.floor(p * draws.length))];
  return { point: stat(groups), ci: [q(0.025), q(0.975)], se, mde: 2.8 * se, dropped: reps - draws.length };
}

// log(Σ per-task medians, thinwindow / baseline) for one metric.
export function sumOfMedians(key) {
  return (groups) => {
    let b = 0;
    let k = 0;
    for (const g of groups) {
      b += median(g.baseline.map((r) => r[key])) ?? 0;
      k += median(g.thinwindow.map((r) => r[key])) ?? 0;
    }
    return Math.log(k / b);
  };
}

// log(cost per completed task, thinwindow / baseline). A condition's cost per
// completed task is everything its runs cost, failures included, over the
// runs that passed: a failure is paid for by the tasks that did complete.
export function costPerCompleted(groups) {
  const per = (c) => {
    let usd = 0;
    let done = 0;
    for (const g of groups) {
      for (const r of g[c]) {
        usd += Number.isFinite(r.costUsd) ? r.costUsd : 0;
        if (r.success === true) done++;
      }
    }
    return usd / done;
  };
  return Math.log(per('thinwindow') / per('baseline'));
}
