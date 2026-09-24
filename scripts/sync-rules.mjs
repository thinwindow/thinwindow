#!/usr/bin/env node
// Copies rules/thinwindow.md (the single source of truth) into the files that
// must carry the rules inline: the Agent Skill and the AGENTS.md adapter.
// `node scripts/sync-rules.mjs --check` exits 1 when a copy is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const RULES = join(ROOT, 'rules', 'thinwindow.md');
export const TARGETS = [join(ROOT, 'skills', 'thinwindow', 'SKILL.md'), join(ROOT, 'adapters', 'AGENTS.md')];

const BLOCK = /(<!-- rules:start[^>]*-->\n)[\s\S]*?(<!-- rules:end -->)/;

export function syncedContent(target, rules) {
  if (!BLOCK.test(target)) throw new Error('missing <!-- rules:start --> ... <!-- rules:end --> markers');
  return target.replace(BLOCK, (_, open, close) => `${open}${rules.trim()}\n${close}`);
}

export function outOfDate() {
  const rules = readFileSync(RULES, 'utf8');
  return TARGETS.filter((t) => {
    const current = readFileSync(t, 'utf8');
    return syncedContent(current, rules) !== current;
  });
}

function main() {
  const check = process.argv.includes('--check');
  const rules = readFileSync(RULES, 'utf8');
  let stale = 0;
  for (const t of TARGETS) {
    const current = readFileSync(t, 'utf8');
    const next = syncedContent(current, rules);
    if (next === current) continue;
    stale++;
    if (check) console.error(`out of date: ${t} (run node scripts/sync-rules.mjs)`);
    else {
      writeFileSync(t, next);
      console.log(`updated ${t}`);
    }
  }
  if (check && stale) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
