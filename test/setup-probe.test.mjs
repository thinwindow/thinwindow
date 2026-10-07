// Setup-cost probe (#35, G3): the tool list, the agent file and the verdict.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { KEEP, RARE, agentFile, firstUsage, minimalDisallowed, probeArgs, setupFromRecords, summarize } from '../bench/experiments/setup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('minimal-tools removes rare built-in tools only: never a kept one or an MCP tool', () => {
  const list = minimalDisallowed(['Bash', 'Read', 'NotebookEdit', 'CronCreate', 'ExitPlanMode', 'mcp__github__search', 'Skill']);
  assert.deepEqual(list, [...new Set(['NotebookEdit', 'CronCreate', ...RARE])].sort());
  for (const t of KEEP) assert.ok(!list.includes(t), t);
  assert.ok(list.every((t) => !t.startsWith('mcp__')));
  assert.match(agentFile(['Skill', 'Agent']), /^---\nname: thinwindow-minimal\ndescription: .+\ndisallowedTools: Skill, Agent\n---\n$/);
  const args = probeArgs('both', { model: 'haiku', disallowed: ['Skill', 'Agent'] });
  assert.deepEqual(args.slice(-4), ['--disable-slash-commands', '--disallowedTools', 'Skill', 'Agent']);
  assert.ok(args.includes('--max-budget-usd'));
});

test('reads the first request and its setup, and decides G3 on minimal-tools', () => {
  const stream = [
    JSON.stringify({ type: 'system', subtype: 'init', tools: [] }),
    JSON.stringify({ type: 'assistant', message: { id: 'm1', usage: { input_tokens: 0, output_tokens: 0 } } }),
    JSON.stringify({ type: 'assistant', message: { id: 'm2', usage: { input_tokens: 9, cache_read_input_tokens: 10000, cache_creation_input_tokens: 9991, output_tokens: 3 } } }),
  ].join('\n');
  assert.deepEqual(firstUsage(stream), { input: 9, cacheRead: 10000, cacheWrite: 9991, output: 3, context: 20000 });
  const listing = { type: 'attachment', attachment: { type: 'skill_listing', content: 'y'.repeat(400) } };
  assert.deepEqual(setupFromRecords([listing, { ...listing, isSidechain: true }, { type: 'assistant', message: { usage: {} } }, listing]), { skill_listing: Math.round(JSON.stringify(listing.attachment).length / 4) });
  const rows = (tools) => [{ variant: 'defaults', usage: { context: 20000 } }, { variant: 'no-skills', usage: { context: 18000 } }, { variant: 'minimal-tools', usage: { context: tools } }];
  assert.equal(summarize(rows(16000)).verdict, 'go');
  assert.equal(summarize(rows(18500)).verdict, 'notice-only');
  assert.equal(summarize(rows(17000)).verdict, 'none');
  assert.equal(summarize(rows(16000)).cut['no-skills'], 0.1);
  assert.equal(summarize([{ variant: 'defaults', usage: null }]).verdict, 'incomplete');
});

test('profiles/thinwindow-minimal.md is the probed agent: empty body, no memory, the list the probe validated', () => {
  const md = readFileSync(join(ROOT, 'profiles', 'thinwindow-minimal.md'), 'utf8');
  const rows = readFileSync(join(ROOT, 'bench', 'results', 'experiments', 'setup-2026-10-05.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const agent = rows.find((r) => r.variant === 'agent');
  assert.equal(md, agentFile(agent.disallowed));
  assert.ok(md.endsWith('---\n'), 'an empty body keeps the system prompt');
  assert.doesNotMatch(md, /^memory:/m, 'a memory field would replace it');
  assert.equal(agent.usage.context, rows.find((r) => r.variant === 'minimal-tools').usage.context, 'the agent did what the flag did');
});
