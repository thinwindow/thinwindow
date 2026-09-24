// How the runner calls Claude Code, and how it reads the result.
// CLI flags: https://code.claude.com/docs/en/cli-reference
// JSON output: https://code.claude.com/docs/en/headless#get-structured-output
import { BENCH_DIR, ROOT_DIR } from './paths.mjs';
import { runSync } from './proc.mjs';

export const CONDITIONS = ['baseline', 'skinflint'];
export const DEFAULT_MAX_TURNS = 40;

// Hosts package managers need inside the sandbox.
export const SANDBOX_DOMAINS = [
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'github.com',
  'codeload.github.com',
  'objects.githubusercontent.com',
];

function posix(p) {
  return p.replace(/\\/g, '/');
}

// Absolute path in permission-rule syntax: `//path`, with Windows drives as
// `//c/...` (https://code.claude.com/docs/en/permissions#read-and-edit).
export function ruleAbsolute(p) {
  let s = posix(p);
  const drive = /^([A-Za-z]):\/(.*)$/.exec(s);
  if (drive) s = `/${drive[1].toLowerCase()}/${drive[2]}`;
  return `/${s}`;
}

// Settings for every run, both conditions alike. Edits are auto-approved
// only inside the working directory (--permission-mode acceptEdits), and Bash
// runs in the sandbox, which can only write to the working directory and the
// session temp dir; it refuses to start without a working sandbox. The agent
// can't read the benchmark's own files (hidden tests, reference solutions),
// and has no web tools, so runs don't depend on search results.
// Sandbox settings: https://code.claude.com/docs/en/sandboxing
export function benchSettings({ benchDir = BENCH_DIR } = {}) {
  const bench = posix(benchDir);
  return {
    sandbox: {
      enabled: true,
      failIfUnavailable: true,
      autoAllowBashIfSandboxed: true,
      allowUnsandboxedCommands: false,
      filesystem: { denyRead: [bench] },
      network: { allowedDomains: SANDBOX_DOMAINS, strictAllowlist: true },
    },
    permissions: {
      deny: ['WebFetch', 'WebSearch', `Read(${ruleAbsolute(benchDir)}/**)`],
    },
  };
}

export function buildClaudeArgs({
  prompt,
  model,
  condition,
  maxTurns = DEFAULT_MAX_TURNS,
  pluginDir = ROOT_DIR,
  benchDir = BENCH_DIR,
  bare = false,
}) {
  if (!CONDITIONS.includes(condition)) throw new Error(`unknown condition ${condition}`);
  const args = [
    '-p',
    prompt,
    '--output-format',
    'json',
    '--model',
    model,
    '--max-turns',
    String(maxTurns),
    '--permission-mode',
    'acceptEdits',
    '--settings',
    JSON.stringify(benchSettings({ benchDir })),
    // User settings can enable other plugins and hooks (or skinflint itself);
    // leave them out so both conditions start from the same place.
    '--setting-sources',
    'project,local',
    '--strict-mcp-config',
    '--no-session-persistence',
  ];
  if (bare) args.push('--bare');
  if (condition === 'skinflint') args.push('--plugin-dir', pluginDir);
  return args;
}

// Environment for the agent process. The baseline also sets SKINFLINT=off
// so a globally installed skinflint can't leak into it.
export function claudeEnv(condition, env = process.env) {
  const out = { ...env };
  delete out.SKINFLINT_DEBUG;
  if (condition === 'baseline') out.SKINFLINT = 'off';
  else delete out.SKINFLINT;
  return out;
}

const n = (v) => (Number.isFinite(v) ? v : 0);

// Parses `claude -p --output-format json` stdout into the fields the
// benchmark records. Token counts come from modelUsage when present, because
// it includes subagents; `usage` only covers the main loop.
export function parseResult(stdout) {
  const text = String(stdout || '').trim();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    // Some versions print one JSON object per line; take the last result.
    for (const line of text.split('\n').reverse()) {
      try {
        const obj = JSON.parse(line);
        if (obj && obj.type === 'result') {
          json = obj;
          break;
        }
      } catch {
        // Not JSON.
      }
    }
  }
  if (Array.isArray(json)) json = json.filter((m) => m && m.type === 'result').pop() || null;
  if (!json || typeof json !== 'object') return null;

  let tokens;
  const mu = json.modelUsage && typeof json.modelUsage === 'object' ? Object.values(json.modelUsage) : [];
  if (mu.length) {
    tokens = mu.reduce(
      (t, m) => ({
        input: t.input + n(m.inputTokens),
        cacheCreation: t.cacheCreation + n(m.cacheCreationInputTokens),
        cacheRead: t.cacheRead + n(m.cacheReadInputTokens),
        output: t.output + n(m.outputTokens),
      }),
      { input: 0, cacheCreation: 0, cacheRead: 0, output: 0 },
    );
  } else {
    const u = json.usage || {};
    tokens = {
      input: n(u.input_tokens),
      cacheCreation: n(u.cache_creation_input_tokens),
      cacheRead: n(u.cache_read_input_tokens),
      output: n(u.output_tokens),
    };
  }
  return {
    inputTokens: tokens.input,
    cacheCreationTokens: tokens.cacheCreation,
    cacheReadTokens: tokens.cacheRead,
    outputTokens: tokens.output,
    totalTokens: tokens.input + tokens.cacheCreation + tokens.cacheRead + tokens.output,
    costUsd: n(json.total_cost_usd),
    numTurns: n(json.num_turns),
    durationMs: n(json.duration_ms),
    isError: json.is_error === true,
    subtype: json.subtype || null,
    modelsUsed: json.modelUsage ? Object.keys(json.modelUsage) : [],
    sessionId: json.session_id || null,
  };
}

export function claudeVersion(cmd = 'claude', prefixArgs = []) {
  const res = runSync(cmd, [...prefixArgs, '--version'], { allowFail: true, timeoutMs: 30000 });
  if (res.status !== 0) return null;
  const m = /(\d+\.\d+\.\d+)/.exec(res.stdout || '');
  return m ? m[1] : (res.stdout || '').trim() || null;
}
