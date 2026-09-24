// Child-process helpers with timeouts that kill the whole process tree.
import { spawn, spawnSync } from 'node:child_process';

// Runs a command. Resolves to { code, signal, stdout, stderr, timedOut, durationMs }.
export function runProcess(cmd, args, { cwd, env = process.env, timeoutMs = 0, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    const started = Date.now();
    const posix = process.platform !== 'win32';
    let child;
    try {
      child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: posix, windowsHide: true });
    } catch (err) {
      resolve({ code: 127, signal: null, stdout: '', stderr: String(err.message), timedOut: false, durationMs: 0 });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let done = false;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d) => {
      if (stdout.length < maxBuffer) stdout += d;
    });
    child.stderr.on('data', (d) => {
      if (stderr.length < maxBuffer) stderr += d;
    });
    const kill = () => {
      try {
        if (posix) process.kill(-child.pid, 'SIGKILL');
        else spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F']);
      } catch {
        try {
          child.kill('SIGKILL');
        } catch {
          // Already gone.
        }
      }
    };
    const timer = timeoutMs > 0 ? setTimeout(() => {
      timedOut = true;
      kill();
    }, timeoutMs) : null;
    // The child has its own process group, so Ctrl-C doesn't reach it: kill
    // it before exiting, or an agent would keep running (and spending).
    const onSignal = (sig) => {
      kill();
      process.exit(sig === 'SIGINT' ? 130 : 143);
    };
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
    const finish = (code, signal, extraErr) => {
      if (done) return;
      done = true;
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      if (timer) clearTimeout(timer);
      resolve({
        code: code ?? (timedOut ? 124 : 1),
        signal,
        stdout,
        stderr: extraErr ? `${stderr}${extraErr}` : stderr,
        timedOut,
        durationMs: Date.now() - started,
      });
    };
    child.on('error', (err) => finish(127, null, String(err.message)));
    child.on('close', (code, signal) => finish(code, signal));
  });
}

// Synchronous helper for short commands (git, --version). Throws on failure
// unless `allowFail`.
export function runSync(cmd, args, { cwd, env = process.env, allowFail = false, timeoutMs = 300000 } = {}) {
  const res = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', timeout: timeoutMs, windowsHide: true });
  if (!allowFail && (res.error || res.status !== 0)) {
    const why = res.error ? res.error.message : (res.stderr || res.stdout || '').trim().split('\n').slice(-3).join(' | ');
    throw new Error(`${cmd} ${args.join(' ')} failed: ${why}`);
  }
  return res;
}

export function which(cmd) {
  const probe = process.platform === 'win32' ? spawnSync('where', [cmd], { encoding: 'utf8' }) : spawnSync('sh', ['-c', `command -v "${cmd}"`], { encoding: 'utf8' });
  return probe.status === 0 ? probe.stdout.trim().split(/\r?\n/)[0] : null;
}

export function tail(text, lines = 20, chars = 2000) {
  const t = String(text || '').trimEnd().split('\n').slice(-lines).join('\n');
  return t.length > chars ? t.slice(-chars) : t;
}
