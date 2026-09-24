#!/usr/bin/env node
// Checks that every benchmark task is well formed and fair, without running
// an agent: in a fresh clone at the pinned commit, `verify` must fail, and
// after applying bench/solutions/<id>.patch (a reference solution) it must
// pass. Needs network, git, bash, Node.js and Python 3; it installs each
// repo's dependencies, so it takes a few minutes. Not part of CI.
//
//   node bench/validate-tasks.mjs [--tasks id1,id2] [--keep]
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { SOLUTIONS_DIR } from './lib/paths.mjs';
import { runSync } from './lib/proc.mjs';
import { loadTasks } from './lib/tasks.mjs';
import { cloneAt, makeWorkdir, removeWorkdir, runVerify } from './lib/workspace.mjs';

async function validate(task, { keep }) {
  const solution = join(SOLUTIONS_DIR, `${task.id}.patch`);
  if (!existsSync(solution)) return { ok: false, why: `missing ${solution}` };
  const dir = makeWorkdir(`validate-${task.id}`);
  try {
    cloneAt(task.repo, task.commit, dir);
    const timeoutMs = 20 * 60 * 1000;
    const before = await runVerify(task, dir, { timeoutMs });
    if (before.success) return { ok: false, why: 'verify passes before any change', dir };
    runSync('git', ['apply', '--whitespace=nowarn', solution], { cwd: dir });
    const after = await runVerify(task, dir, { timeoutMs });
    if (!after.success) return { ok: false, why: `verify fails with the reference solution:\n${after.tail}`, dir };
    return { ok: true, why: `fails before (exit ${before.exitCode}), passes after (${Math.round(after.durationMs / 1000)}s)`, dir };
  } catch (err) {
    return { ok: false, why: err.message, dir };
  } finally {
    if (!keep) removeWorkdir(dir);
  }
}

async function main() {
  const { values } = parseArgs({ options: { tasks: { type: 'string' }, keep: { type: 'boolean', default: false } } });
  const tasks = loadTasks(values.tasks ? values.tasks.split(',').map((s) => s.trim()).filter(Boolean) : []);
  let failed = 0;
  for (const task of tasks) {
    process.stdout.write(`${task.id} ... `);
    const r = await validate(task, values);
    if (!r.ok) failed++;
    console.log(`${r.ok ? 'ok' : 'FAIL'}: ${r.why}${values.keep && r.dir ? ` [${r.dir}]` : ''}`);
  }
  console.log(`${tasks.length - failed}/${tasks.length} tasks valid`);
  process.exitCode = failed ? 1 : 0;
}

main();
