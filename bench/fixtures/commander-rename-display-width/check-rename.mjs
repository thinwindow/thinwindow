// Checker for bench task commander-rename-display-width (tj/commander.js
// v15.0.0): Help.displayWidth renamed to visibleTextWidth everywhere, with
// no alias left behind. Run from the repository root.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

const SKIP = new Set(['node_modules', '.git', 'CHANGELOG.md', 'answer.json']);
const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/\.(js|mjs|cjs|ts|mts|md|json)$/.test(name) && /\bdisplayWidth\b/.test(readFileSync(p, 'utf8'))) hits.push(p);
  }
}
walk('.');
if (hits.length) fail(`displayWidth still appears in: ${hits.join(', ')}`);

if (!/\bvisibleTextWidth\s*\(/.test(readFileSync('lib/help.js', 'utf8'))) fail('lib/help.js has no visibleTextWidth method');
if (!/\bvisibleTextWidth\s*\(/.test(readFileSync('typings/index.d.ts', 'utf8'))) fail('typings/index.d.ts has no visibleTextWidth');

const { Help } = await import(pathToFileURL(resolve('index.js')).href);
const help = new Help();
if (help.displayWidth !== undefined) fail('Help still has a displayWidth member');
if (help.visibleTextWidth('\u001b[31mabc\u001b[39m') !== 3) fail('visibleTextWidth does not ignore color codes');
console.log('rename looks right');
