#!/usr/bin/env node
// thinwindow-report: where your Claude Code sessions' context cost went.
//
//   thinwindow-report           a short text report
//   thinwindow-report --json    a short summary you can choose to share
//
// Reads the transcripts under $CLAUDE_CONFIG_DIR/projects (default
// ~/.claude/projects), one line at a time, and ThinWindow's own per-session
// counts in the OS temp dir. Prints aggregate numbers only. Every string it
// prints is one of its own labels: never prompt, file, command or path
// content, project names, session ids, or names of tools, models or MCP
// servers. Sends nothing. No dependencies; Node >= 18.
//
// Definitions: a request is an assistant message with usage, counted once per
// message id; sub-agent requests (sidechains) are counted apart; context =
// input + cache read + cache write tokens; a cold re-write is a request sent
// more than 60 minutes after the previous one that writes over 20k tokens to
// the cache; tool output is chars/4 tokens, an image ~1.6k, a document ~3k.
import { createReadStream, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// USD per million tokens, Anthropic API list prices. Kept in sync with
// bench/lib/pricing.mjs (a test compares the two).
export const PRICES = {
  'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 20, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheWrite: 20, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 8, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 10, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 10, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheWrite: 10, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheWrite: 10, cacheRead: 0.5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheWrite: 4, cacheRead: 0.2 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 4, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 6, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 2, cacheRead: 0.1 },
};
export const PRICING = "each request at its own model's Anthropic API list price (Sep 2026)";

export const COLD_GAP_MS = 60 * 60 * 1000;
export const COLD_MIN_WRITE = 20000;
const IMAGE_TOKENS = 1600;
const DOCUMENT_TOKENS = 3000;
const MIN_REQUESTS = 3; // sessions shorter than this are left out of per-session figures
const LONG_SESSION = 50;
// More unreadable request records than this and the report refuses to print numbers.
const MAX_UNRECOGNIZED = 0.05;
// The newest Claude Code release whose transcripts the fixtures were checked against.
export const CHECKED_UP_TO = [2, 1];

// Labels for first-request attachments, by attachment type. The setup-cost
// notice (hooks/lib/setup-notice.mjs) uses them too, so both agree.
export const SETUP = {
  skill_listing: 'skillListing',
  deferred_tools_delta: 'deferredTools',
  deferred_tools_record: 'deferredTools',
  mcp_instructions_delta: 'mcpInstructions',
  instructions: 'claudeMd',
  nested_memory: 'claudeMd',
  agent_listing_delta: 'agentListing',
};
export const SETUP_LABEL = {
  skillListing: 'skill listing',
  deferredTools: 'deferred tools',
  mcpInstructions: 'MCP instructions',
  claudeMd: 'CLAUDE.md files',
  agentListing: 'agent listing',
};
const TOOL_LABEL = { bash: 'Bash', read: 'Read', mcp: 'MCP tools', search: 'Grep and Glob', web: 'web', agent: 'sub-agents', other: 'other tools' };
const SIZE_LABEL = { under2k: 'under 2k chars', to8k: '2-8k', to32k: '8-32k', over32k: 'over 32k' };
// ThinWindow's own per-session counts (hooks/lib/handlers.mjs and
// hooks/lib/cold-resume.mjs, hooks/lib/setup-notice.mjs), by key.
const ACTION_LABEL = {
  'Read.deny': 'reads cut or refused',
  'Bash.rewrite': 'commands rewritten',
  'Bash.deny': 'commands refused',
  'Grep.rewrite': 'searches capped',
  'ColdResume.notice': 'cold-resume notices',
  'ColdResume.continue': 'sent again after a notice',
  'Setup.notice': 'setup-cost notices',
};

export function resolveModel(model) {
  const base = String(model).toLowerCase().replace(/\[1m\]$/, '');
  const noDate = base.replace(/-\d{8}$/, '');
  return PRICES[noDate] ? noDate : null;
}

function family(model) {
  const m = /^claude-(opus|sonnet|haiku|fable)-/.exec(model || '');
  return m ? m[1] : 'other';
}

function toolKind(name) {
  if (typeof name !== 'string') return 'other';
  if (name.startsWith('mcp__')) return 'mcp';
  return { Bash: 'bash', Read: 'read', Grep: 'search', Glob: 'search', WebFetch: 'web', WebSearch: 'web', Agent: 'agent', Task: 'agent' }[name] || 'other';
}

function sizeBand(tokens) {
  const chars = tokens * 4;
  return chars < 2000 ? 'under2k' : chars < 8000 ? 'to8k' : chars < 32000 ? 'to32k' : 'over32k';
}

function resultTokens(content) {
  if (!Array.isArray(content)) return String(content ?? '').length / 4;
  let t = 0;
  for (const b of content) {
    if (b?.type === 'image') t += IMAGE_TOKENS;
    else if (b?.type === 'document') t += DOCUMENT_TOKENS;
    else t += JSON.stringify(b).length / 4;
  }
  return t;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// [major, minor, patch] from a version string, or null. Only numbers leave here.
function parseVersion(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(typeof v === 'string' ? v : '');
  return m ? m.slice(1).map(Number) : null;
}
const cmpVersion = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

// Every .jsonl under dir; files in a `subagents` directory are sidechains.
export function transcriptFiles(dir, sidechain = false) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return transcriptFiles(p, sidechain || e.name === 'subagents');
    return e.name.endsWith('.jsonl') ? [{ path: p, sidechain }] : [];
  });
}

function newTotals() {
  return {
    files: 0,
    badLines: 0,
    usageRecords: 0,
    unrecognized: 0,
    unpriced: 0,
    firstTs: Infinity,
    lastTs: -Infinity,
    oldest: null,
    newest: null,
    main: { requests: 0, ctx: 0, out: 0, cost: 0, cacheWrite: 0 },
    side: { requests: 0, cost: 0 },
    costByFamily: {},
    sessions: [],
    cold: { count: 0, sessions: 0, cost: 0, cacheWrite: 0, contexts: [] },
    tools: { total: 0, byKind: {}, bySize: {} },
    resent: 0,
    setup: {},
    setupSessions: 0,
  };
}

const add = (o, k, n) => (o[k] = (o[k] || 0) + n);

// Reads one transcript, a line at a time, into the running totals.
export async function scanFile({ path, sidechain }, t) {
  t.files++;
  const seen = new Set();
  const toolNames = new Map();
  const events = []; // main thread only: requests, tool results, compactions
  const setup = {};
  let sawRequest = false;
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      t.badLines++;
      continue;
    }
    if (!o || typeof o !== 'object') continue;
    const v = parseVersion(o.version);
    if (v) {
      if (!t.oldest || cmpVersion(v, t.oldest) < 0) t.oldest = v;
      if (!t.newest || cmpVersion(v, t.newest) > 0) t.newest = v;
    }
    const side = sidechain || o.isSidechain === true;
    if (o.type === 'assistant') {
      const msg = o.message;
      if (!msg || typeof msg !== 'object') continue;
      for (const c of Array.isArray(msg.content) ? msg.content : []) {
        if (c?.type === 'tool_use') toolNames.set(c.id, c.name);
      }
      if (!msg.usage) continue;
      t.usageRecords++;
      const u = msg.usage;
      const input = num(u.input_tokens);
      const out = num(u.output_tokens);
      const read = num(u.cache_read_input_tokens ?? 0);
      const write = num(u.cache_creation_input_tokens ?? 0);
      const ts = Date.parse(o.timestamp);
      if (input === null || out === null || read === null || write === null || Number.isNaN(ts)) {
        t.unrecognized++;
        continue;
      }
      const id = msg.id || o.requestId;
      if (id) {
        if (seen.has(id)) continue;
        seen.add(id);
      }
      const ctx = input + read + write;
      if (ctx === 0 && out === 0) continue; // a local error message, not a request
      const model = resolveModel(msg.model);
      const p = model ? PRICES[model] : null;
      if (!p) t.unpriced++;
      const cost = p ? (input * p.input + read * p.cacheRead + write * p.cacheWrite + out * p.output) / 1e6 : 0;
      if (side) {
        t.side.requests++;
        t.side.cost += cost;
        continue;
      }
      t.firstTs = Math.min(t.firstTs, ts);
      t.lastTs = Math.max(t.lastTs, ts);
      add(t.costByFamily, family(model), cost);
      events.push({ req: true, ctx, out, write, ts, cost, writeCost: p ? (write * p.cacheWrite) / 1e6 : 0 });
      sawRequest = true;
      continue;
    }
    if (side) continue;
    if (o.type === 'attachment' && !sawRequest) {
      const key = SETUP[o.attachment?.type];
      if (key) add(setup, key, JSON.stringify(o.attachment).length / 4);
    } else if (o.type === 'system' && /compact/i.test(o.subtype || '')) {
      events.push({ compact: true });
    } else if (o.type === 'user' && Array.isArray(o.message?.content)) {
      for (const c of o.message.content) {
        if (c?.type === 'tool_result') events.push({ kind: toolKind(toolNames.get(c.tool_use_id)), tokens: resultTokens(c.content) });
      }
    }
  }
  finishSession(events, setup, t);
}

function finishSession(events, setup, t) {
  const reqs = events.filter((e) => e.req);
  if (reqs.length === 0) return;
  t.setupSessions++;
  for (const [k, v] of Object.entries(setup)) add(t.setup, k, v);

  let last = null;
  let coldHere = 0;
  for (const r of reqs) {
    t.main.requests++;
    t.main.ctx += r.ctx;
    t.main.out += r.out;
    t.main.cost += r.cost;
    t.main.cacheWrite += r.write;
    if (last !== null && r.ts - last > COLD_GAP_MS && r.write > COLD_MIN_WRITE) {
      coldHere++;
      t.cold.count++;
      t.cold.cost += r.writeCost;
      t.cold.cacheWrite += r.write;
      t.cold.contexts.push(r.ctx);
    }
    last = r.ts;
  }
  if (coldHere) t.cold.sessions++;

  // A tool result is re-sent with every later request until the session ends
  // or is compacted.
  let later = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.req) {
      later++;
      t.resent += e.ctx;
    } else if (e.compact) later = 0;
    else {
      const w = e.tokens * later;
      t.tools.total += w;
      add(t.tools.byKind, e.kind, w);
      add(t.tools.bySize, sizeBand(e.tokens), w);
    }
  }

  if (reqs.length >= MIN_REQUESTS) {
    t.sessions.push({ requests: reqs.length, first: reqs[0].ctx, ctx: reqs.reduce((s, r) => s + r.ctx, 0), out: reqs.reduce((s, r) => s + r.out, 0) });
  }
}

// ThinWindow's per-session counts from the last 7 days (the hooks delete
// older state files).
export function thinwindowActions(base = tmpdir()) {
  const dir = join(base, 'thinwindow', 'state');
  const actions = {};
  let sessions = 0;
  let names = [];
  try {
    names = readdirSync(dir).filter((n) => n.endsWith('.json'));
  } catch {
    return { sessions, actions };
  }
  for (const name of names) {
    let s;
    try {
      s = JSON.parse(readFileSync(join(dir, name), 'utf8'));
    } catch {
      continue;
    }
    sessions++;
    for (const key of Object.keys(ACTION_LABEL)) {
      const n = num(s?.stats?.[key]);
      if (n) add(actions, key, n);
    }
  }
  return { sessions, actions };
}

const sorted = (a) => [...a].sort((x, y) => x - y);
const median = (a) => (a.length ? sorted(a)[a.length >> 1] : 0);
const quantile = (a, q) => (a.length ? sorted(a)[Math.floor(q * (a.length - 1))] : 0);
const share = (a, b) => (b ? a / b : 0);
const round = (x, d = 3) => Number(x.toFixed(d));

function shares(obj, total) {
  return Object.fromEntries(
    Object.entries(obj)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, round(share(v, total))]),
  );
}

function thinwindowVersion() {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const v = JSON.parse(readFileSync(join(here, '..', '..', '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;
    return parseVersion(v) ? v : null;
  } catch {
    return null;
  }
}

// Why the numbers can't be trusted, or null.
function formatProblem(t) {
  if (t.files === 0) return null;
  if (t.usageRecords === 0) return 'no request records with token usage';
  if (t.unrecognized / t.usageRecords > MAX_UNRECOGNIZED) return `${t.unrecognized} of ${t.usageRecords} request records lack the fields this report reads`;
  return null;
}

// Scans everything and returns the summary: the object --json prints.
export async function buildReport({ root = defaultRoot(), stateBase = tmpdir() } = {}) {
  const t = newTotals();
  for (const f of transcriptFiles(root)) await scanFile(f, t);
  const version = (v) => (v ? v.join('.') : null);
  const claudeCode = { oldest: version(t.oldest), newest: version(t.newest) };
  const checked = !t.newest || t.newest[0] < CHECKED_UP_TO[0] || (t.newest[0] === CHECKED_UP_TO[0] && t.newest[1] <= CHECKED_UP_TO[1]);
  const base = { thinwindowReport: 1, thinwindow: thinwindowVersion(), claudeCode, checkedVersion: checked };
  const problem = formatProblem(t);
  if (problem) return { ...base, error: 'format-not-recognized', detail: problem, files: t.files };
  if (t.main.requests === 0) return { ...base, error: 'no-sessions', files: t.files };

  const S = t.sessions;
  const longest = [...S].sort((a, b) => b.requests - a.requests).slice(0, Math.max(1, Math.ceil(S.length / 10)));
  const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
  const allTokens = sum(S, 'ctx') + sum(S, 'out');
  const long = S.filter((s) => s.requests >= LONG_SESSION);
  const avgSetup = Object.fromEntries(
    Object.entries(t.setup)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, Math.round(v / t.setupSessions)]),
  );
  return {
    ...base,
    pricing: PRICING,
    days: Math.max(1, Math.ceil((t.lastTs - t.firstTs) / 86400000)),
    sessions: S.length,
    requests: t.main.requests,
    requestsPerSession: { median: median(S.map((s) => s.requests)), p90: quantile(S.map((s) => s.requests), 0.9) },
    contextPerRequest: {
      mean: Math.round(share(t.main.ctx, t.main.requests)),
      longestSessions: Math.round(share(sum(longest, 'ctx'), sum(longest, 'requests'))),
      longestSessionsCount: longest.length,
    },
    longSessions: { count: long.length, tokenShare: round(share(sum(long, 'ctx') + sum(long, 'out'), allTokens)) },
    firstRequest: { median: median(S.map((s) => s.first)), parts: avgSetup },
    coldRewrites: {
      count: t.cold.count,
      sessions: t.cold.sessions,
      medianContext: median(t.cold.contexts),
      shareOfCost: round(share(t.cold.cost, t.main.cost)),
      shareOfCacheWrites: round(share(t.cold.cacheWrite, t.main.cacheWrite)),
    },
    toolOutput: {
      shareOfResent: round(share(t.tools.total, t.resent)),
      bySource: shares(t.tools.byKind, t.resent),
      bySize: Object.fromEntries(Object.keys(SIZE_LABEL).map((k) => [k, round(share(t.tools.bySize[k] || 0, t.resent))])),
    },
    costShareByModel: shares(t.costByFamily, t.main.cost),
    subagents: { requests: t.side.requests, shareOfCost: round(share(t.side.cost, t.main.cost + t.side.cost)) },
    unpricedRequests: t.unpriced,
    skippedLines: t.badLines + t.unrecognized,
    thinwindowLast7Days: thinwindowActions(stateBase),
    // Kept out of --json: what the user paid is theirs to share or not.
    _usd: { total: t.main.cost, cold: t.cold.cost },
  };
}

export function defaultRoot(env = process.env, home = homedir()) {
  return join(env.CLAUDE_CONFIG_DIR || join(home, '.claude'), 'projects');
}

const tok = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e5 ? `${Math.round(n / 1e3)}k` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n)));
const pct = (x) => (x < 0.1 ? `${(x * 100).toFixed(1)}%` : `${Math.round(x * 100)}%`);
const usd = (x) => `US$${x >= 100 ? Math.round(x).toLocaleString('en-US') : x.toFixed(2)}`;
const int = (n) => n.toLocaleString('en-US');

const ISSUES = 'https://github.com/thinwindow/thinwindow/issues';

export function formatText(r) {
  if (r.error === 'format-not-recognized') {
    return [
      'ThinWindow report: transcript format not recognized.',
      `Read ${int(r.files)} transcript files${r.claudeCode.newest ? ` from Claude Code up to ${r.claudeCode.newest}` : ''}: ${r.detail}.`,
      'Nothing is reported rather than wrong numbers.',
      `Please open an issue with your Claude Code version: ${ISSUES}`,
      '',
    ].join('\n');
  }
  if (r.error === 'no-sessions') return 'ThinWindow report: no Claude Code sessions found on this machine.\n';
  const c = r.coldRewrites;
  const parts = Object.entries(r.firstRequest.parts)
    .slice(0, 4)
    .map(([k, v]) => `${SETUP_LABEL[k]} ${tok(v)}`);
  const sources = Object.entries(r.toolOutput.bySource)
    .slice(0, 4)
    .map(([k, v]) => `${TOOL_LABEL[k]} ${pct(v)}`);
  const bands = Object.entries(r.toolOutput.bySize).map(([k, v]) => `${SIZE_LABEL[k]} ${pct(v)}`);
  const tw = r.thinwindowLast7Days;
  const did = Object.entries(tw.actions)
    .sort((x, y) => y[1] - x[1])
    .map(([k, v]) => `${ACTION_LABEL[k]} ${int(v)}`);
  const out = [
    `ThinWindow report: ${int(r.sessions)} sessions, ${int(r.requests)} requests over ${r.days} days`,
    'Your own Claude Code sessions on this machine. Computed here; nothing was sent.',
    '',
    'Context re-sent with every request',
    `  An average request carries ${tok(r.contextPerRequest.mean)} tokens; the median session has ${r.requestsPerSession.median} requests.`,
    `  Your ${r.contextPerRequest.longestSessionsCount} longest sessions: ${tok(r.contextPerRequest.longestSessions)} per request.`,
    `  Sessions of ${LONG_SESSION}+ requests hold ${pct(r.longSessions.tokenShare)} of all tokens.`,
    '',
    'Re-written after the cache expired (idle over 60 minutes)',
    c.count
      ? `  ${int(c.count)} times, in ${c.sessions} sessions. Median context then: ${tok(c.medianContext)} tokens.`
      : '  Never: no session was resumed with a large context after an hour idle.',
  ];
  if (c.count) {
    out.push(`  ${usd(r._usd.cold)} re-written: ${pct(c.shareOfCost)} of the ${usd(r._usd.total)} total, ${pct(c.shareOfCacheWrites)} of all cache writes.`);
  }
  out.push(
    '',
    "Setup: what a session's first request carries",
    `  ${tok(r.firstRequest.median)} tokens (median).${parts.length ? ' Largest parts, on average:' : ''}`,
    ...(parts.length ? [`  ${parts.join(', ')}.`] : []),
    '',
    'Tool output, counted each time it is re-sent',
    `  ${pct(r.toolOutput.shareOfResent)} of all re-sent context${sources.length ? `: ${sources.join(', ')}` : ''}.`,
    `  By result size: ${bands.join(', ')}.`,
    '',
    `ThinWindow, last 7 days (${tw.sessions} sessions with it on)`,
    `  ${did.length ? did.join(', ') : 'nothing to report'}.`,
    '',
    `Prices: ${PRICING}.`,
    'On a subscription, read US$ as a relative size, not what you paid.',
  );
  const notes = [];
  if (r.subagents.requests) notes.push(`${int(r.subagents.requests)} sub-agent requests are left out`);
  if (!r.checkedVersion) notes.push(`checked against Claude Code up to ${CHECKED_UP_TO.join('.')}, some sessions are newer`);
  if (notes.length) out.push(`${notes.join('; ')}.`.replace(/^./, (ch) => ch.toUpperCase()));
  out.push('Share these numbers: /thinwindow:report --json', '');
  return out.join('\n');
}

export function formatJson(r) {
  const { _usd, ...shared } = r;
  return `${JSON.stringify(shared, null, 2)}\n`;
}

const USAGE = `usage: thinwindow-report [--json]

Where your Claude Code sessions' context cost went, from the transcripts on
this machine. Prints aggregate numbers only and sends nothing. --json prints a
short summary you can choose to share.`;

export async function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr } = {}) {
  if (argv.includes('-h') || argv.includes('--help')) {
    stdout.write(`${USAGE}\n`);
    return 0;
  }
  const unknown = argv.filter((a) => a !== '--json');
  if (unknown.length) {
    stderr.write(`${USAGE}\n`);
    return 2;
  }
  const r = await buildReport();
  stdout.write(argv.includes('--json') ? formatJson(r) : formatText(r));
  return r.error === 'format-not-recognized' ? 1 : 0;
}

function isEntry() {
  try {
    return realpathSync(process.argv[1] || '') === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) main().then((code) => (process.exitCode = code));
