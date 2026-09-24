// Shared plumbing for skinflint's Claude Code hooks: read the JSON input from
// stdin, run the handler, print its JSON output, and fail open on any error.
//
// Hook input/output contract: https://code.claude.com/docs/en/hooks#hook-input-and-output
// - Input arrives as one JSON object on stdin.
// - Exit 0 with a JSON object on stdout is structured output; exit 0 with no
//   stdout means "no opinion", so the normal permission flow applies.
// - Stderr of a hook that exits 0 only goes to the debug log (claude --debug).

const STDIN_TIMEOUT_MS = 5000;

export function debugEnabled(env = process.env) {
  const v = String(env.SKINFLINT_DEBUG || '').toLowerCase();
  return v !== '' && v !== '0' && v !== 'false' && v !== 'off';
}

export function debug(message, env = process.env) {
  if (!debugEnabled(env)) return;
  try {
    process.stderr.write(`[skinflint] ${message}\n`);
  } catch {
    // Never let logging break a hook.
  }
}

async function readStdin() {
  let data = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

// Runs `handler(input)` and writes its return value as JSON. A handler that
// returns null/undefined prints nothing. Any error (bad JSON, a bug, a
// timeout) exits 0 without output: skinflint never blocks a tool call
// because of its own failure.
export async function runHook(name, handler) {
  const bail = setTimeout(() => {
    debug(`${name}: timed out, allowing`);
    process.exit(0);
  }, STDIN_TIMEOUT_MS);
  bail.unref();
  try {
    const raw = await readStdin();
    const input = JSON.parse(raw);
    const output = await handler(input);
    if (output) process.stdout.write(JSON.stringify(output));
  } catch (err) {
    debug(`${name}: error, allowing: ${err && err.stack ? err.stack : err}`);
  }
  process.exitCode = 0;
}
