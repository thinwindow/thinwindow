// Fresh working copies of a task repo at its pinned commit, in the OS temp
// dir. Only the pinned commit is fetched and the remote is removed, so the
// agent can't read the repo's future history.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURES_DIR } from './paths.mjs';
import { runProcess, runSync, tail, which } from './proc.mjs';

export function makeWorkdir(label) {
  return mkdtempSync(join(tmpdir(), `thinwindow-bench-${label.replace(/[^A-Za-z0-9-]/g, '-')}-`));
}

export function removeWorkdir(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Best effort; it's in the temp dir.
  }
}

export function cloneAt(repo, commit, dir) {
  const git = (args, opts = {}) => runSync('git', args, { cwd: dir, ...opts });
  git(['init', '-q']);
  git(['config', 'user.email', 'bench@thinwindow.invalid']);
  git(['config', 'user.name', 'thinwindow bench']);
  git(['remote', 'add', 'origin', repo]);
  const shallow = git(['fetch', '-q', '--depth', '1', 'origin', commit], { allowFail: true });
  if (shallow.status !== 0) {
    // Some servers refuse fetching a bare SHA; fall back to a full fetch.
    git(['fetch', '-q', 'origin']);
  }
  git(['checkout', '-q', '--detach', shallow.status === 0 ? 'FETCH_HEAD' : commit]);
  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  if (head !== commit) throw new Error(`checked out ${head}, expected ${commit}`);
  git(['remote', 'remove', 'origin']);
  return head;
}

export function shellFor() {
  return which('bash') || 'sh';
}

// Runs the task's verify command in `cwd`. Resolves to
// { success, exitCode, durationMs, timedOut, tail }.
// The task's setup (dependency installs), run before the agent starts so
// neither condition spends turns installing packages. Not measured.
export async function runSetup(task, cwd, { timeoutMs = 20 * 60 * 1000, env = process.env } = {}) {
  const res = await runProcess(shellFor(), ['-c', task.setup], { cwd, timeoutMs, env: { ...env, CI: '1' } });
  return { success: res.code === 0 && !res.timedOut, tail: tail(`${res.stdout}\n${res.stderr}`) };
}

export async function runVerify(task, cwd, { timeoutMs = 20 * 60 * 1000, env = process.env } = {}) {
  const res = await runProcess(shellFor(), ['-c', task.verify], {
    cwd,
    timeoutMs,
    env: { ...env, THINWINDOW_BENCH_FIXTURES: FIXTURES_DIR, CI: '1' },
  });
  return {
    success: res.code === 0 && !res.timedOut,
    exitCode: res.code,
    durationMs: res.durationMs,
    timedOut: res.timedOut,
    tail: tail(`${res.stdout}\n${res.stderr}`),
  };
}
