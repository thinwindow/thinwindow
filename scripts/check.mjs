#!/usr/bin/env node
// Repository checks run in CI (and by `npm run check`):
//   - JSON validity and required fields: plugin manifest, marketplace,
//     hooks config, benchmark task files
//   - SKILL.md frontmatter (Agent Skills fields)
//   - the token budget of rules/thinwindow.md
//   - the rules copies in SKILL.md and adapters/AGENTS.md are in sync
//   - .github/labels.json is valid and defines every label the issue
//     templates and the stale workflow use
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outOfDate } from './sync-rules.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// Principle 3 in docs/SPEC.md: at or under 500 tokens (~2,000 characters).
// There is no offline tokenizer without dependencies, so CI enforces the
// character bound, which keeps typical English text near 4 chars/token.
export const RULES_MAX_CHARS = 2000;

const KEBAB = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/;
// Frontmatter fields defined by the Agent Skills standard; anything else may
// be rejected by other agents (https://code.claude.com/docs/en/skills#frontmatter-reference).
const SKILL_FIELDS = new Set(['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']);
const HOOK_EVENTS = new Set([
  'SessionStart', 'Setup', 'InstructionsLoaded', 'UserPromptSubmit', 'UserPromptExpansion', 'MessageDisplay',
  'PreToolUse', 'PermissionRequest', 'PostToolUse', 'PostToolUseFailure', 'PostToolBatch', 'PermissionDenied',
  'Notification', 'SubagentStart', 'SubagentStop', 'TaskCreated', 'TaskCompleted', 'Stop', 'StopFailure',
  'TeammateIdle', 'ConfigChange', 'CwdChanged', 'DirectoryAdded', 'FileChanged', 'WorktreeCreate',
  'WorktreeRemove', 'PreCompact', 'PostCompact', 'PreModelSwitch', 'PostModelSwitch', 'SessionEnd',
  'Elicitation', 'ElicitationResult',
]);
const TASK_FIELDS = new Set(['repo', 'commit', 'prompt', 'verify', 'timeout']);

function readJson(file, errors) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (err) {
    errors.push(`${rel(file)}: invalid JSON: ${err.message}`);
    return null;
  }
}

function rel(file) {
  return relative(ROOT, file).replace(/\\/g, '/');
}

// Plugin manifest: https://code.claude.com/docs/en/plugins-reference#plugin-manifest-schema
export function validatePlugin(p) {
  const e = [];
  if (!p || typeof p !== 'object') return ['must be an object'];
  if (typeof p.name !== 'string' || !KEBAB.test(p.name)) e.push('name must be kebab-case');
  if (p.version !== undefined && !SEMVER.test(String(p.version))) e.push('version must be semver');
  if (p.author !== undefined && (typeof p.author !== 'object' || typeof p.author.name !== 'string')) {
    e.push('author must be an object with a name');
  }
  if (p.keywords !== undefined && !Array.isArray(p.keywords)) e.push('keywords must be an array');
  for (const k of ['description', 'homepage', 'repository', 'license']) {
    if (p[k] !== undefined && typeof p[k] !== 'string') e.push(`${k} must be a string`);
  }
  return e;
}

// Marketplace: https://code.claude.com/docs/en/plugin-marketplaces#marketplace-schema
export function validateMarketplace(m, pluginName) {
  const e = [];
  if (!m || typeof m !== 'object') return ['must be an object'];
  if (typeof m.name !== 'string' || !KEBAB.test(m.name)) e.push('name must be kebab-case');
  if (!m.owner || typeof m.owner.name !== 'string') e.push('owner.name is required');
  if (!Array.isArray(m.plugins) || m.plugins.length === 0) {
    e.push('plugins must be a non-empty array');
    return e;
  }
  for (const [i, entry] of m.plugins.entries()) {
    if (typeof entry.name !== 'string' || !KEBAB.test(entry.name)) e.push(`plugins[${i}].name must be kebab-case`);
    if (typeof entry.source === 'string') {
      if (!entry.source.startsWith('./')) e.push(`plugins[${i}].source must start with ./`);
    } else if (!entry.source || typeof entry.source !== 'object') {
      e.push(`plugins[${i}].source is required`);
    }
  }
  if (pluginName && !m.plugins.some((p) => p.name === pluginName)) e.push(`no entry for plugin "${pluginName}"`);
  return e;
}

// Hooks config: https://code.claude.com/docs/en/hooks#configuration
export function validateHooks(h, pluginRoot) {
  const e = [];
  if (!h || typeof h.hooks !== 'object' || h.hooks === null) return ['hooks must be an object'];
  for (const [event, groups] of Object.entries(h.hooks)) {
    if (!HOOK_EVENTS.has(event)) e.push(`unknown hook event ${event}`);
    if (!Array.isArray(groups)) {
      e.push(`${event} must be an array of matcher groups`);
      continue;
    }
    for (const [gi, group] of groups.entries()) {
      if (!Array.isArray(group.hooks) || group.hooks.length === 0) {
        e.push(`${event}[${gi}].hooks must be a non-empty array`);
        continue;
      }
      for (const [hi, hook] of group.hooks.entries()) {
        const at = `${event}[${gi}].hooks[${hi}]`;
        if (hook.type !== 'command') {
          e.push(`${at}: thinwindow only uses command hooks`);
          continue;
        }
        if (typeof hook.command !== 'string' || hook.command === '') e.push(`${at}.command is required`);
        if (hook.args !== undefined && !Array.isArray(hook.args)) e.push(`${at}.args must be an array`);
        for (const arg of hook.args || []) {
          const m = /^\$\{CLAUDE_PLUGIN_ROOT\}\/(.+)$/.exec(arg);
          if (m && pluginRoot && !existsSync(join(pluginRoot, m[1]))) e.push(`${at}: ${m[1]} does not exist`);
        }
      }
    }
  }
  return e;
}

// Benchmark task: { repo, commit, prompt, verify, timeout } (docs/SPEC.md).
export function validateTask(t) {
  const e = [];
  if (!t || typeof t !== 'object' || Array.isArray(t)) return ['must be an object'];
  for (const k of Object.keys(t)) if (!TASK_FIELDS.has(k)) e.push(`unknown field ${k}`);
  if (typeof t.repo !== 'string' || !/^https:\/\/\S+$/.test(t.repo)) e.push('repo must be a public https git URL');
  if (typeof t.commit !== 'string' || !/^[0-9a-f]{40}$/.test(t.commit)) e.push('commit must be a full 40-char SHA');
  if (typeof t.prompt !== 'string' || t.prompt.trim() === '') e.push('prompt must be a non-empty string');
  if (typeof t.verify !== 'string' || t.verify.trim() === '') e.push('verify must be a non-empty shell command');
  if (!Number.isInteger(t.timeout) || t.timeout <= 0) e.push('timeout must be a positive integer (seconds)');
  return e;
}

// Tiny YAML-frontmatter reader: top-level `key: value` pairs only.
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
  if (!m) return null;
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    if (/^\s/.test(line) || line.trim() === '' || line.trim().startsWith('#')) continue;
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[kv[1]] = v;
  }
  return out;
}

// Agent Skills: name is 1-64 lowercase letters, digits and hyphens and
// matches its directory; description is 1-1024 characters.
export function validateSkill(text, dirName) {
  const fm = parseFrontmatter(text);
  if (!fm) return ['missing YAML frontmatter'];
  const e = [];
  for (const k of Object.keys(fm)) if (!SKILL_FIELDS.has(k)) e.push(`frontmatter field ${k} is not in the Agent Skills standard`);
  if (!fm.name || fm.name.length > 64 || !KEBAB.test(fm.name)) e.push('name must be 1-64 chars of a-z, 0-9 and single hyphens');
  else if (dirName && fm.name !== dirName) e.push(`name "${fm.name}" must match its directory "${dirName}"`);
  if (!fm.description) e.push('description is required');
  else if (fm.description.length > 1024) e.push('description must be at most 1024 characters');
  return e;
}

// Labels as code: .github/labels.json, synced by .github/workflows/labels.yml.
// GitHub limits names to 50 characters and descriptions to 100.
export function validateLabels(labels) {
  if (!Array.isArray(labels)) return ['must be an array of labels'];
  const e = [];
  const seen = new Set();
  for (const [i, l] of labels.entries()) {
    if (!l || typeof l.name !== 'string' || l.name.trim() === '' || l.name.length > 50) {
      e.push(`[${i}]: name must be 1-50 characters`);
      continue;
    }
    if (seen.has(l.name.toLowerCase())) e.push(`duplicate label "${l.name}"`);
    seen.add(l.name.toLowerCase());
    if (typeof l.color !== 'string' || !/^[0-9a-f]{6}$/.test(l.color)) e.push(`"${l.name}": color must be 6 lowercase hex digits, no #`);
    if (typeof l.description !== 'string' || l.description.length > 100) e.push(`"${l.name}": description must be a string of at most 100 characters`);
    for (const k of Object.keys(l)) if (!['name', 'color', 'description'].includes(k)) e.push(`"${l.name}": unknown field ${k}`);
  }
  return e;
}

// Label names used by the issue templates (`labels: [a, b]`) and the stale
// workflow (its *-label and *-labels settings).
export function referencedLabels(root = ROOT) {
  const out = new Set();
  const templates = join(root, '.github', 'ISSUE_TEMPLATE');
  if (existsSync(templates)) {
    for (const name of readdirSync(templates).filter((n) => /\.ya?ml$/.test(n))) {
      const m = /^labels:\s*\[([^\]]*)\]/m.exec(readFileSync(join(templates, name), 'utf8'));
      if (m) m[1].split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean).forEach((x) => out.add(x));
    }
  }
  const stale = join(root, '.github', 'workflows', 'stale.yml');
  if (existsSync(stale)) {
    for (const m of readFileSync(stale, 'utf8').matchAll(/^\s*(?:stale|exempt)-(?:issue|pr)-labels?:\s*(.+)$/gm)) {
      m[1].split(',').map((x) => x.trim()).filter(Boolean).forEach((x) => out.add(x));
    }
  }
  return [...out].sort();
}

export function rulesBudget(text) {
  return { chars: text.length, estTokens: Math.ceil(text.length / 4), ok: text.length <= RULES_MAX_CHARS };
}

export function runChecks(root = ROOT) {
  const errors = [];
  const add = (file, list) => list.forEach((msg) => errors.push(`${rel(file)}: ${msg}`));

  const pluginFile = join(root, '.claude-plugin', 'plugin.json');
  const plugin = readJson(pluginFile, errors);
  if (plugin) add(pluginFile, validatePlugin(plugin));

  const marketFile = join(root, '.claude-plugin', 'marketplace.json');
  const market = readJson(marketFile, errors);
  if (market) add(marketFile, validateMarketplace(market, plugin && plugin.name));

  const hooksFile = join(root, 'hooks', 'hooks.json');
  const hooks = readJson(hooksFile, errors);
  if (hooks) add(hooksFile, validateHooks(hooks, root));

  const tasksDir = join(root, 'bench', 'tasks');
  if (existsSync(tasksDir)) {
    for (const name of readdirSync(tasksDir).filter((n) => n.endsWith('.json')).sort()) {
      const file = join(tasksDir, name);
      const task = readJson(file, errors);
      if (!task) continue;
      add(file, validateTask(task));
      if (!/^[a-z0-9][a-z0-9-]*\.json$/.test(name)) errors.push(`${rel(file)}: task id must be kebab-case`);
    }
  }

  const labelsFile = join(root, '.github', 'labels.json');
  if (existsSync(labelsFile)) {
    const labels = readJson(labelsFile, errors);
    if (labels) {
      const problems = validateLabels(labels);
      add(labelsFile, problems);
      if (!problems.length) {
        const defined = new Set(labels.map((l) => l.name));
        for (const name of referencedLabels(root)) {
          if (!defined.has(name)) errors.push(`${rel(labelsFile)}: label "${name}" is used but not defined`);
        }
      }
    }
  }

  const skillsDir = join(root, 'skills');
  for (const dir of readdirSync(skillsDir)) {
    const file = join(skillsDir, dir, 'SKILL.md');
    if (!existsSync(file)) continue;
    add(file, validateSkill(readFileSync(file, 'utf8'), basename(dir)));
  }

  const rulesFile = join(root, 'rules', 'thinwindow.md');
  const budget = rulesBudget(readFileSync(rulesFile, 'utf8'));
  if (!budget.ok) {
    errors.push(`${rel(rulesFile)}: ${budget.chars} characters, over the ${RULES_MAX_CHARS}-character (~500 token) budget`);
  }

  if (root === ROOT) for (const t of outOfDate()) errors.push(`${rel(t)}: rules block out of date (run npm run sync-rules)`);

  for (const bin of ['bin/thinwindow-run', 'skills/thinwindow/scripts/thinwindow-run.mjs']) {
    const file = join(root, bin);
    if (!existsSync(file)) errors.push(`${bin}: missing`);
    else if (process.platform !== 'win32' && (statSync(file).mode & 0o111) === 0) errors.push(`${bin}: not executable`);
  }

  return { errors, budget };
}

function main() {
  const { errors, budget } = runChecks();
  console.log(`rules/thinwindow.md: ${budget.chars}/${RULES_MAX_CHARS} characters (~${budget.estTokens} tokens)`);
  for (const e of errors) console.error(`error: ${e}`);
  if (errors.length) {
    process.exitCode = 1;
  } else {
    console.log('all checks passed');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
