// Small statistics helpers for the report.

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
  let s = seed >>> 0;
  const rand = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
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
