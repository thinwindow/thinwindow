// Well-known paths of the benchmark.
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BENCH_DIR = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ROOT_DIR = join(BENCH_DIR, '..');
export const TASKS_DIR = join(BENCH_DIR, 'tasks');
export const FIXTURES_DIR = join(BENCH_DIR, 'fixtures');
export const SOLUTIONS_DIR = join(BENCH_DIR, 'solutions');
export const RESULTS_DIR = join(BENCH_DIR, 'results');
