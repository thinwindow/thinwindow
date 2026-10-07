// How the runner calls Claude Code, and how it reads the result.
// CLI flags: https://code.claude.com/docs/en/cli-reference
// JSON output: https://code.claude.com/docs/en/headless#get-structured-output
import { createHash } from 'node:crypto';
import { homedir, platform, release } from 'node:os';
import { basename, join } from 'node:path';
import { BENCH_DIR, ROOT_DIR } from './paths.mjs';
import { runSync } from './proc.mjs';

export const CONDITIONS = ['baseline', 'thinwindow'];
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
  // 0.4.0 harness (#37), the same for both conditions. `persist` keeps the
  // session (kept transcripts, chains).
  persist = false,
  tools = null,
  disallowedTools = null,
  agent = null,
}) {
  if (!CONDITIONS.includes(condition)) throw new Error(`unknown condition ${condition}`);
  const args = [
    '-p',
    prompt,
    // stream-json (which needs --verbose) so the tool calls can be traced;
    // parseResult reads the final result line either way.
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    model,
    '--max-turns',
    String(maxTurns),
    '--permission-mode',
    'acceptEdits',
    '--settings',
    JSON.stringify(benchSettings({ benchDir })),
    // User settings can enable other plugins and hooks (or thinwindow itself);
    // leave them out so both conditions start from the same place.
    '--setting-sources',
    'project,local',
    '--strict-mcp-config',
  ];
  if (!persist) args.push('--no-session-persistence');
  if (tools !== null) args.push('--tools', tools);
  if (disallowedTools !== null) args.push('--disallowedTools', disallowedTools);
  if (agent !== null) args.push('--agent', agent);
  if (bare) args.push('--bare');
  if (condition === 'thinwindow') args.push('--plugin-dir', pluginDir);
  return args;
}

// Environment for the agent process. The baseline also sets THINWINDOW=off
// so a globally installed thinwindow can't leak into it.
export function claudeEnv(condition, env = process.env) {
  const out = { ...env };
  delete out.THINWINDOW_DEBUG;
  if (condition === 'baseline') out.THINWINDOW = 'off';
  else delete out.THINWINDOW;
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
    // Most tokens first: the main loop's model, then subagents and fallbacks.
    modelsUsed: json.modelUsage
      ? Object.entries(json.modelUsage)
          .map(([id, m]) => [id, n(m.inputTokens) + n(m.cacheCreationInputTokens) + n(m.cacheReadInputTokens) + n(m.outputTokens)])
          .sort((a, b) => b[1] - a[1])
          .map(([id]) => id)
      : [],
    sessionId: json.session_id || null,
    resultText: typeof json.result === 'string' ? json.result : null,
  };
}

// The stream's system/init event: the model and Claude Code version the run
// started with, and the effort level when Claude Code publishes it.
export function parseInit(stdout) {
  for (const line of String(stdout || '').split('\n')) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (e && e.type === 'system' && e.subtype === 'init') return e;
  }
  return null;
}

// The agent's tool calls, one short line each, so a run can be compared with
// its twin after the temp clone and the session are gone. `scrub` runs before
// the cut, so a path is never left half replaced.
export function parseTrace(stdout, { maxSteps = 80, scrub = (s) => s } = {}) {
  const steps = [];
  for (const line of String(stdout || '').split('\n')) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const content = e && e.type === 'assistant' && Array.isArray(e.message?.content) ? e.message.content : [];
    for (const c of content) {
      if (c.type !== 'tool_use' || steps.length >= maxSteps) continue;
      const i = c.input || {};
      const range = i.offset != null || i.limit != null ? ` [${i.offset ?? 1}+${i.limit ?? ''}]` : '';
      const arg = String(i.file_path ?? i.command ?? i.pattern ?? i.description ?? '').replace(/\s+/g, ' ');
      // A call cut short ends with "…": its length alone doesn't say so once
      // a scrub has shortened its paths.
      const step = scrub(`${c.name}${range} ${arg}`);
      steps.push(step.length > 140 ? `${step.slice(0, 139)}…` : step);
    }
  }
  return steps;
}

// The last `chars` characters of each traced call's result, aligned with
// parseTrace by index (null when the stream has no result for it), so a
// repeated attempt can be told apart from a retry after an error (#7).
export function parseTraceTails(stdout, { maxSteps = 80, chars = 200, scrub = (s) => s } = {}) {
  const ids = [];
  const tails = [];
  for (const line of String(stdout || '').split('\n')) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const content = Array.isArray(e?.message?.content) ? e.message.content : [];
    for (const c of content) {
      if (e.type === 'assistant' && c.type === 'tool_use' && ids.length < maxSteps) {
        ids.push(c.id);
        tails.push(null);
      } else if (e.type === 'user' && c.type === 'tool_result') {
        const i = c.tool_use_id ? ids.indexOf(c.tool_use_id) : -1;
        if (i === -1) continue;
        const text = typeof c.content === 'string' ? c.content : (c.content || []).map((p) => p.text || '').join(' ');
        const flat = scrub(text.replace(/\s+/g, ' ').trim());
        tails[i] = `${c.is_error ? '[error] ' : ''}${flat.slice(-chars)}`;
      }
    }
  }
  return tails;
}

// The first API request's usage in a stream-json run.
export function firstUsage(stdout) {
  for (const line of String(stdout || '').split('\n')) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    const u = e?.type === 'assistant' && e.message?.usage;
    if (!u) continue;
    const r = { input: u.input_tokens || 0, cacheRead: u.cache_read_input_tokens || 0, cacheWrite: u.cache_creation_input_tokens || 0, output: u.output_tokens || 0 };
    if (r.input + r.cacheRead + r.cacheWrite > 0) return { ...r, context: r.input + r.cacheRead + r.cacheWrite };
  }
  return null;
}

export function configDir(env = process.env) {
  return env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
}

export const shortHash = (s) => createHash('sha256').update(String(s)).digest('hex').slice(0, 12);

// The Claude Code profile a run used: its config folder's name, hashed, so a
// row doesn't carry the operator's folder names.
export const profileLabel = (env = process.env) => (env.CLAUDE_CONFIG_DIR ? shortHash(basename(env.CLAUDE_CONFIG_DIR)) : 'default');

// The machine and profile a run used. `account` is a label the operator
// passes (--account), stored hashed: two profiles can share an account, and
// one profile can be logged into another later.
export function hostFingerprint({ account = null, env = process.env } = {}) {
  return {
    profile: profileLabel(env),
    account: account ? shortHash(account) : null,
    os: `${platform()} ${release()}`,
    node: process.version,
  };
}

const names = (list) => (Array.isArray(list) ? list.map((x) => (typeof x === 'string' ? x : x?.name)).filter(Boolean) : []);
const OWN_SKILL = 'thinwindow:';

// What can change between two runs' environments, from the stream: tool,
// skill and agent counts from the init event (names hashed: account tools and
// skills say which account ran), and the first request's tokens. ThinWindow's
// own skills are counted apart, so both conditions can share a fingerprint.
// A first request that reads nothing from the prompt cache started cold.
export function runFingerprint(stdout) {
  const found = parseInit(stdout);
  const init = found || {};
  const tools = names(init.tools).sort();
  const skills = names(Array.isArray(init.skills) ? init.skills : init.slash_commands);
  const other = skills.filter((s) => !s.startsWith(OWN_SKILL)).sort();
  const first = firstUsage(stdout);
  return {
    toolCount: found ? tools.length : null,
    toolsHash: tools.length ? shortHash(tools.join('\n')) : null,
    skillCount: found ? other.length : null,
    skillsHash: other.length ? shortHash(other.join('\n')) : null,
    pluginSkillCount: skills.length - other.length,
    agentCount: Array.isArray(init.agents) ? init.agents.length : null,
    firstRequest: first,
    cacheState: first ? (first.cacheRead > 0 ? 'warm' : 'cold') : null,
  };
}

export function claudeVersion(cmd = 'claude', prefixArgs = []) {
  const res = runSync(cmd, [...prefixArgs, '--version'], { allowFail: true, timeoutMs: 30000 });
  if (res.status !== 0) return null;
  const m = /(\d+\.\d+\.\d+)/.exec(res.stdout || '');
  return m ? m[1] : (res.stdout || '').trim() || null;
}
