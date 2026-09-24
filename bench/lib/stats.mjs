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
