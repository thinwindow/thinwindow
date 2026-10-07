// bench/results/<date>-<model>.jsonl: one JSON object per run, appended as
// runs finish. Raw files are committed; the report is derived from them.
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RESULTS_DIR } from './paths.mjs';

export function localDate(d = new Date()) {
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function resultsPath(model, { date = localDate(), dir = RESULTS_DIR } = {}) {
  return join(dir, `${date}-${String(model).replace(/[^A-Za-z0-9._-]+/g, '_')}.jsonl`);
}

export function appendResult(file, record) {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(record)}\n`);
}

export function readResultFile(file) {
  const out = [];
  for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      throw new Error(`${file}:${i + 1}: not valid JSON`);
    }
  }
  return out;
}

export function listResultFiles(dir = RESULTS_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.jsonl'))
    .sort()
    .map((n) => join(dir, n));
}

// A run found in two files counts once (the archive repeats runs, #36).
export function dedupeRuns(records) {
  const seen = new Set();
  return records.filter((r) => !r.sessionId || (!seen.has(r.sessionId) && seen.add(r.sessionId)));
}

export function readResults(files = listResultFiles()) {
  return dedupeRuns(files.flatMap(readResultFile));
}

// Where a release's rows live: bench/results/<version>/ (a prerelease such as
// 0.4.0-dev goes with 0.4.0). listResultFiles() doesn't descend into it, so
// the published 0.3.0 blocks, built from bench/results/*.jsonl, can't change.
export function versionDir(version, dir = RESULTS_DIR) {
  return join(dir, String(version).split('-')[0]);
}
