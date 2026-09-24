// Checker for bench task commander-ci-config: compares answer.json with the
// values in tj/commander.js v15.0.0 (.github/workflows/tests.yml and
// package.json). Order doesn't matter; ">=" and "v" prefixes are ignored.
import { readFileSync } from 'node:fs';

const expected = {
  ciNodeVersions: ['22.x', '24.x', '26.x'],
  ciOperatingSystems: ['ubuntu-latest', 'windows-latest', 'macos-latest'],
  minNodeVersion: '22.12.0',
  typingsTestScript: 'check:type:ts',
};

let answer;
try {
  answer = JSON.parse(readFileSync(process.argv[2] || 'answer.json', 'utf8'));
} catch (err) {
  console.error(`answer.json missing or not JSON: ${err.message}`);
  process.exit(1);
}

const norm = (v) => String(v).trim().toLowerCase().replace(/^(>=|v)+/, '').replace(/^npm run /, '');
const sameSet = (a, b) => Array.isArray(a) && a.length === b.length && b.every((x) => a.map(norm).includes(norm(x)));

const failures = [];
if (!sameSet(answer.ciNodeVersions, expected.ciNodeVersions)) failures.push('ciNodeVersions');
if (!sameSet(answer.ciOperatingSystems, expected.ciOperatingSystems)) failures.push('ciOperatingSystems');
if (norm(answer.minNodeVersion) !== norm(expected.minNodeVersion)) failures.push('minNodeVersion');
if (norm(answer.typingsTestScript) !== norm(expected.typingsTestScript)) failures.push('typingsTestScript');

if (failures.length) {
  console.error(`wrong or missing: ${failures.join(', ')}`);
  console.error(`got: ${JSON.stringify(answer)}`);
  process.exit(1);
}
console.log('answer.json matches');
