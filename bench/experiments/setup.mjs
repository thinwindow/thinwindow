#!/usr/bin/env node
// Setup-cost probe (#35, gate G3): how much of a session's first request goes
// away with fewer skills or tools. One `claude -p "Reply with OK."` per
// variant, --max-turns 1, in an empty folder, under the CLAUDE_CONFIG_DIR you
// pass (no user plugins or MCP servers of your own):
//
//   defaults        nothing changed
//   no-skills       --disable-slash-commands
//   minimal-tools   --disallowedTools: built-in tools used in < 0.5% of calls
//   both            no-skills + minimal-tools
//   agent           --agent thinwindow:minimal (a throwaway plugin with only
//                   that agent): does the plugin agent do what the flag did?
//   agent-skill     the same, sending a skill command: do typed skill
//                   commands still run without the Skill tool?
//
// The two agent variants run only when minimal-tools meets G3's go line.
//
//   node bench/experiments/setup.mjs --dry-run [--model m]
//   CLAUDE_CONFIG_DIR=~/.claude-bench node bench/experiments/setup.mjs [--model m]
//   node bench/experiments/setup.mjs --analyze bench/results/experiments/setup-<date>.jsonl
//
// Records keep token usage, tool and skill counts, built-in tool names and
// setup sizes by attachment type, never transcripts.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { claudeEnv, claudeVersion, firstUsage, parseInit, parseResult, profileLabel } from '../lib/claude.mjs';
import { RESULTS_DIR } from '../lib/paths.mjs';
import { priceOf, resolveModel } from '../lib/pricing.mjs';
import { runProcess } from '../lib/proc.mjs';
import { appendResult, localDate, readResultFile } from '../lib/results.mjs';
import { SETUP, SETUP_LABEL } from '../../skills/thinwindow/scripts/thinwindow-report.mjs';
import { sessionRecords } from '../lib/transcripts.mjs';

export { firstUsage };

export const PROMPT = 'Reply with OK.';
// Built-in tools used in at least 0.5% of the maintainer's main-thread tool
// calls (35,304 calls over 123 days, 87% of them in the desktop app), plus
// ExitPlanMode, which plan mode needs to hand back a plan.
export const KEEP = ['Bash', 'Edit', 'Read', 'Write', 'WebSearch', 'WebFetch', 'TaskUpdate', 'ToolSearch', 'TaskCreate', 'ExitPlanMode'];
// Built-in tools those sessions used in under 0.5% of calls. Some exist only
// in the desktop app or on some accounts, so a -p run may not list them.
export const RARE = ['AskUserQuestion', 'SendUserFile', 'Monitor', 'Artifact', 'TaskOutput', 'TaskStop', 'Skill', 'ScheduleWakeup', 'SendFeedback', 'ListAgents', 'EnterPlanMode', 'Agent'];
export const GO = 0.2;
export const NOTICE_ONLY = 0.1;
const MAX_RUN_USD = '0.10';
const EST_CONTEXT = 20000; // a first request on a bare profile, Haiku (#33's live check: ~20k)
const SKILL = 'probe-hello';
const SKILL_REPLY = 'PROBE-OK';
const EXPERIMENTS_DIR = join(RESULTS_DIR, 'experiments');

// Every built-in tool a run lists, plus the rare ones, minus KEEP. MCP tools
// are never listed: they're the user's own.
export function minimalDisallowed(tools = []) {
  return [...new Set([...tools.filter((t) => typeof t === 'string' && !t.startsWith('mcp__')), ...RARE])].filter((t) => !KEEP.includes(t)).sort();
}

// The agent: an empty body keeps Claude Code's system prompt
// (https://code.claude.com/docs/en/sub-agents, Claude Code >= 2.1.281). The
// shipped one, profiles/thinwindow-minimal.md, isn't in the plugin's agents/:
// every session with the Agent tool lists each agent with its tool list
// (~110 tokens here), so only users who copy it in pay for that line.
export function agentFile(disallowed, name = 'thinwindow-minimal') {
  return [
    '---',
    `name: ${name}`,
    `description: Opt-in main-session profile (claude --agent ${name}). Never delegate to it.`,
    `disallowedTools: ${disallowed.join(', ')}`,
    '---',
    '',
  ].join('\n');
}

export const VARIANTS = ['defaults', 'no-skills', 'minimal-tools', 'both', 'agent', 'agent-skill'];

export function variantArgs(variant, { disallowed = [], pluginDir = null } = {}) {
  const noSkills = ['--disable-slash-commands'];
  const tools = ['--disallowedTools', ...disallowed];
  const agent = ['--plugin-dir', pluginDir, '--agent', 'thinwindow:minimal'];
  return { defaults: [], 'no-skills': noSkills, 'minimal-tools': tools, both: [...noSkills, ...tools], agent, 'agent-skill': agent }[variant];
}

export function probeArgs(variant, { model, ...opts }) {
  const prompt = variant === 'agent-skill' ? `/thinwindow:${SKILL}` : PROMPT;
  return ['-p', prompt, '--output-format', 'stream-json', '--verbose', '--model', model, '--max-turns', '1', '--max-budget-usd', MAX_RUN_USD, ...variantArgs(variant, opts)];
}

// Attachments before the first request, in tokens (JSON chars / 4), by type:
// the report script's definition of a first request's setup parts.
export function setupFromRecords(records) {
  const out = {};
  for (const r of records) {
    if (r.isSidechain === true) continue;
    if (r.type === 'assistant' && r.message?.usage) break;
    if (r.type === 'attachment' && typeof r.attachment?.type === 'string') out[r.attachment.type] = (out[r.attachment.type] || 0) + Math.round(JSON.stringify(r.attachment).length / 4);
  }
  return out;
}

// Share of the defaults' first request that goes away in each variant, and G3.
export function summarize(rows) {
  const base = rows.find((r) => r.variant === 'defaults' && r.usage);
  const cut = (v) => {
    const r = rows.find((x) => x.variant === v && x.usage);
    return base && r ? Math.round((1 - r.usage.context / base.usage.context) * 1e4) / 1e4 : null; // 0.2 stays 0.2
  };
  const tools = cut('minimal-tools');
  const verdict = tools === null ? 'incomplete' : tools >= GO ? 'go' : tools < NOTICE_ONLY ? 'notice-only' : 'none';
  return { cut: Object.fromEntries(VARIANTS.map((v) => [v, cut(v)])), verdict };
}

const VERDICT = {
  go: `go: ship the opt-in minimal-tools agent (minimal-tools cuts at least ${GO * 100}%)`,
  'notice-only': `notice only (minimal-tools cuts under ${NOTICE_ONLY * 100}%)`,
  none: `no pre-written outcome (minimal-tools cuts between ${NOTICE_ONLY * 100}% and ${GO * 100}%): the maintainer decides`,
  incomplete: 'incomplete: defaults or minimal-tools has no first request',
};

const tok = (n) => `${(n / 1000).toFixed(1)}k`;
const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);

export function formatAnalysis(rows) {
  const s = summarize(rows);
  const env = rows[0] || {};
  // The report's setup parts, plus the transcript's copy of the system prompt.
  const cols = [['system prompt', ['prompt_snapshot']], ...Object.entries(SETUP_LABEL).map(([key, label]) => [label, Object.keys(SETUP).filter((t) => SETUP[t] === key)])];
  const size = (r, types) => types.reduce((a, t) => a + (r.setup?.[t] || 0), 0);
  const out = [
    '# Setup-cost probe (#35, G3)',
    '',
    `Claude Code ${env.claudeVersion} · ${env.modelResolved} · profile ${env.profile} · ${env.os} · one \`claude -p "${PROMPT}"\` per variant, in an empty folder, no ThinWindow (except the agent variants' throwaway plugin).`,
    'First request = input + cache read + cache write tokens of the first API request. Tokens per request only: cache reads are cheap, so this is not a cost claim.',
    '',
    'Parts are JSON characters / 4 of the attachments written before the first request, as in `/thinwindow:report`; the system prompt is the transcript\'s `prompt_snapshot` copy of it.',
    '',
    `| Variant | First request | Cut | Tools | ${cols.map(([label]) => label).join(' | ')} |`,
    `| --- | ---: | ---: | ---: |${cols.map(() => ' ---: |').join('')}`,
  ];
  for (const r of rows) {
    out.push(`| ${r.variant} | ${r.usage ? tok(r.usage.context) : 'n/a'} | ${pct(s.cut[r.variant])} | ${r.tools ?? 'n/a'} | ${cols.map(([, types]) => (size(r, types) ? tok(size(r, types)) : '-')).join(' | ')} |`);
  }
  const tools = rows.find((r) => r.variant === 'minimal-tools');
  if (tools) out.push('', `minimal-tools removes: ${tools.disallowed.join(', ')}.`);
  const skill = rows.find((r) => r.variant === 'agent-skill');
  if (skill) out.push(`agent-skill: the typed skill command ${skill.skillRan ? 'ran' : 'did not run'} without the Skill tool.`);
  const usd = rows.reduce((a, r) => a + (r.usd || 0), 0);
  out.push('', `G3: ${VERDICT[s.verdict]}.`, `Spent: US$${usd.toFixed(3)} at list price, from token usage.`);
  return `${out.join('\n')}\n`;
}

function formatDryRun({ model }) {
  const price = priceOf(model);
  const each = price ? (EST_CONTEXT * price.cacheWrite) / 1e6 : null;
  const usd = (n) => (each === null ? 'unknown (no list price)' : `~US$${(each * n).toFixed(2)}`);
  return [
    `Setup-cost probe: ${model}, profile ${process.env.CLAUDE_CONFIG_DIR || '(set CLAUDE_CONFIG_DIR)'}, Claude Code ${claudeVersion() ?? '?'}.`,
    `Runs: 4 (defaults, no-skills, minimal-tools, both), then 2 more (agent, agent-skill) only if minimal-tools cuts >= ${GO * 100}%.`,
    `Cost: each run is one cold first request of ~${tok(EST_CONTEXT)} tokens at the 1-hour cache-write price: 4 runs ${usd(4)}, 6 runs ${usd(6)}. Each run is capped at US$${MAX_RUN_USD}.`,
    `minimal-tools keeps ${KEEP.join(', ')}, and removes every other built-in tool the defaults run lists, plus ${RARE.join(', ')}.`,
    `claude ${probeArgs('minimal-tools', { model, disallowed: ['<list>'] }).map((a) => (/[\s"]/.test(a) ? JSON.stringify(a) : a)).join(' ')}`,
    '',
  ].join('\n');
}

// A plugin named thinwindow holding only the agent and a skill that can only
// be typed, so the agent variants differ from minimal-tools by the agent alone.
function throwawayPlugin(dir, disallowed) {
  const root = join(dir, 'plugin');
  mkdirSync(join(root, '.claude-plugin'), { recursive: true });
  mkdirSync(join(root, 'agents'));
  mkdirSync(join(root, 'skills', SKILL), { recursive: true });
  writeFileSync(join(root, '.claude-plugin', 'plugin.json'), JSON.stringify({ name: 'thinwindow', version: '0.0.0-probe' }));
  writeFileSync(join(root, 'agents', 'minimal.md'), agentFile(disallowed, 'minimal'));
  writeFileSync(join(root, 'skills', SKILL, 'SKILL.md'), `---\nname: ${SKILL}\ndescription: Probe skill.\ndisable-model-invocation: true\n---\n\nReply with the word ${SKILL_REPLY}.\n`);
  return root;
}

async function runVariant(variant, { model, cwd, file, version, ...opts }) {
  const env = claudeEnv('baseline');
  for (const k of ['CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDECODE', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID']) delete env[k];
  const res = await runProcess('claude', probeArgs(variant, { model, ...opts }), { cwd, env, timeoutMs: 300000 });
  const init = parseInit(res.stdout) || {};
  const parsed = parseResult(res.stdout);
  const usage = firstUsage(res.stdout);
  const price = priceOf(model);
  const records = init.session_id ? sessionRecords(init.session_id) : [];
  const tools = Array.isArray(init.tools) ? init.tools : [];
  const row = {
    v: 1,
    experiment: 'setup',
    variant,
    model,
    modelResolved: resolveModel(model),
    claudeVersion: version,
    profile: profileLabel(),
    os: `${process.platform} ${(await import('node:os')).release()}`,
    startedAt: new Date().toISOString(),
    exit: res.code,
    subtype: parsed?.subtype ?? null,
    initKeys: Object.keys(init).sort(),
    tools: tools.length,
    builtInTools: tools.filter((t) => typeof t === 'string' && !t.startsWith('mcp__')).sort(),
    mcpTools: tools.filter((t) => typeof t === 'string' && t.startsWith('mcp__')).length,
    skills: Array.isArray(init.skills) ? init.skills.length : Array.isArray(init.slash_commands) ? init.slash_commands.length : null,
    agents: Array.isArray(init.agents) ? init.agents.length : null,
    disallowed: opts.disallowed && variant !== 'defaults' && variant !== 'no-skills' ? opts.disallowed : [],
    usage,
    setup: setupFromRecords(records),
    usd: usage && price ? (usage.input * price.input + usage.cacheRead * price.cacheRead + usage.cacheWrite * price.cacheWrite + usage.output * price.output) / 1e6 : null,
  };
  if (variant === 'agent-skill') row.skillRan = String(parsed?.resultText ?? '').includes(SKILL_REPLY);
  appendResult(file, row);
  console.log(`${variant}: exit ${row.exit}, ${row.subtype}, first request ${usage ? tok(usage.context) : 'n/a'}, ${row.tools} tools, ${row.skills ?? '?'} skills, US$${(row.usd ?? 0).toFixed(3)}`);
  return row;
}

async function runProbe({ model }) {
  if (!process.env.CLAUDE_CONFIG_DIR) throw new Error('set CLAUDE_CONFIG_DIR to the bench profile');
  const version = claudeVersion();
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'tw-setup-')));
  const file = join(EXPERIMENTS_DIR, `setup-${localDate()}.jsonl`);
  const rows = [await runVariant('defaults', { model, cwd, file, version })];
  const disallowed = minimalDisallowed(rows[0].builtInTools);
  for (const v of ['no-skills', 'minimal-tools', 'both']) rows.push(await runVariant(v, { model, cwd, file, version, disallowed }));
  if (summarize(rows).verdict === 'go') {
    const pluginDir = throwawayPlugin(cwd, disallowed);
    for (const v of ['agent', 'agent-skill']) rows.push(await runVariant(v, { model, cwd, file, version, disallowed, pluginDir }));
  }
  process.stdout.write(`\n${formatAnalysis(rows)}`);
  console.log(`Rows: ${file}`);
}

async function main() {
  const { values } = parseArgs({
    options: {
      model: { type: 'string', default: 'claude-haiku-4-5' },
      'dry-run': { type: 'boolean', default: false },
      analyze: { type: 'string' },
    },
  });
  if (values.analyze) process.stdout.write(formatAnalysis(readResultFile(values.analyze)));
  else if (values['dry-run']) process.stdout.write(formatDryRun(values));
  else await runProbe(values);
}

function isMain() {
  try {
    return pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isMain()) main();
