// Loads and validates bench/tasks/<id>.json.
// Task format (docs/SPEC.md): { repo, commit, prompt, verify, timeout }
//   repo     public git URL
//   commit   full SHA the repo is pinned to
//   prompt   what the agent is asked to do
//   verify   shell command, run in the clone after the agent; exit 0 = success.
//            $THINWINDOW_BENCH_FIXTURES points at bench/fixtures/.
//   timeout  seconds the agent gets
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { validateTask } from '../../scripts/check.mjs';
import { TASKS_DIR } from './paths.mjs';

export function listTaskIds(dir = TASKS_DIR) {
  return readdirSync(dir)
    .filter((n) => n.endsWith('.json'))
    .map((n) => n.slice(0, -5))
    .sort();
}

export function loadTask(id, dir = TASKS_DIR) {
  const file = join(dir, `${id}.json`);
  if (!existsSync(file)) throw new Error(`unknown task "${id}" (no ${file})`);
  const task = JSON.parse(readFileSync(file, 'utf8'));
  const errors = validateTask(task);
  if (errors.length) throw new Error(`invalid task ${id}: ${errors.join('; ')}`);
  return { id, ...task };
}

// ids: array of task ids, or empty/undefined for every task.
export function loadTasks(ids, dir = TASKS_DIR) {
  const wanted = ids && ids.length ? ids : listTaskIds(dir);
  return wanted.map((id) => loadTask(id, dir));
}

// "https://github.com/tj/commander.js.git" -> "tj/commander.js"
export function repoLabel(url) {
  const m = /github\.com[/:]([^/]+\/[^/]+?)(\.git)?\/?$/.exec(url);
  return m ? m[1] : url.replace(/^https?:\/\//, '').replace(/\.git$/, '');
}
