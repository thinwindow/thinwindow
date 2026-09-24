// Checker for bench task commander-extract-utils (tj/commander.js v15.0.0).
// Run from the repository root after `npm ci`.
import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

if (!existsSync('lib/utils.js')) fail('lib/utils.js does not exist');
const command = readFileSync('lib/command.js', 'utf8');
if (/function\s+(incrementNodeInspectorPort|useColor)\s*\(/.test(command)) {
  fail('lib/command.js still defines incrementNodeInspectorPort or useColor');
}
if (!/from\s+['"]\.\/utils\.js['"]/.test(command)) fail('lib/command.js does not import from ./utils.js');

const utils = await import(pathToFileURL(resolve('lib/utils.js')).href);
if (typeof utils.incrementNodeInspectorPort !== 'function') fail('lib/utils.js does not export incrementNodeInspectorPort');
if (typeof utils.useColor !== 'function') fail('lib/utils.js does not export useColor');

const cases = [
  [['--inspect'], ['--inspect=127.0.0.1:9230']],
  [['--inspect=1234'], ['--inspect=127.0.0.1:1235']],
  [['--inspect-brk=localhost:4000', '--no-warnings'], ['--inspect-brk=localhost:4001', '--no-warnings']],
  [['--inspect-port=0'], ['--inspect-port=0']],
];
for (const [input, output] of cases) {
  const got = utils.incrementNodeInspectorPort(input);
  if (JSON.stringify(got) !== JSON.stringify(output)) {
    fail(`incrementNodeInspectorPort(${JSON.stringify(input)}) = ${JSON.stringify(got)}, expected ${JSON.stringify(output)}`);
  }
}

const saved = { ...process.env };
for (const k of ['NO_COLOR', 'FORCE_COLOR', 'CLICOLOR_FORCE']) delete process.env[k];
const colorCases = [
  [{}, undefined],
  [{ NO_COLOR: '1' }, false],
  [{ FORCE_COLOR: '0' }, false],
  [{ FORCE_COLOR: '1' }, true],
  [{ CLICOLOR_FORCE: '1' }, true],
];
for (const [env, expected] of colorCases) {
  for (const k of ['NO_COLOR', 'FORCE_COLOR', 'CLICOLOR_FORCE']) delete process.env[k];
  Object.assign(process.env, env);
  if (utils.useColor() !== expected) fail(`useColor() with ${JSON.stringify(env)} returned ${utils.useColor()}`);
}
process.env = saved;
console.log('extraction looks right');
