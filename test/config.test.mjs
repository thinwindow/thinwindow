import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULTS, globToRegExp, loadConfig } from '../hooks/lib/config.mjs';
import { tempDir } from './helpers.mjs';

test('defaults apply without config files', () => {
  const c = loadConfig({ projectDir: tempDir(), home: tempDir(), env: {} });
  assert.equal(c.enabled, true);
  assert.equal(c.maxReadLines, DEFAULTS.maxReadLines);
  assert.equal(c.maxReadLines, 400);
  assert.equal(c.rewrite, false);
  assert.ok(c.noisyPatterns.length > 10);
});

test('project config overrides home config', () => {
  const home = tempDir();
  const proj = tempDir();
  writeFileSync(join(home, '.thinwindow.json'), JSON.stringify({ maxReadLines: 200, rewrite: true }));
  writeFileSync(join(proj, '.thinwindow.json'), JSON.stringify({ maxReadLines: 800 }));
  const c = loadConfig({ projectDir: proj, home, env: {} });
  assert.equal(c.maxReadLines, 800);
  assert.equal(c.rewrite, true);
});

test('noisyCommands and allowlists add to the defaults', () => {
  const proj = tempDir();
  writeFileSync(
    join(proj, '.thinwindow.json'),
    JSON.stringify({ noisyCommands: ['^just test\\b'], allowlist: { paths: ['docs/**'], commands: ['^make lint$'] } }),
  );
  const c = loadConfig({ projectDir: proj, home: tempDir(), env: {} });
  assert.ok(c.noisyPatterns.some((re) => re.test('just test')));
  assert.ok(c.noisyPatterns.some((re) => re.test('npm test')));
  assert.ok(c.allowCommandPatterns.some((re) => re.test('make lint')));
  assert.ok(c.allowPathPatterns.some((re) => re.test('docs/a/b.md')));
});

test('"enabled": false turns thinwindow off', () => {
  const proj = tempDir();
  writeFileSync(join(proj, '.thinwindow.json'), JSON.stringify({ enabled: false }));
  assert.equal(loadConfig({ projectDir: proj, home: tempDir(), env: {} }).enabled, false);
});

test('THINWINDOW=off turns thinwindow off whatever the files say', () => {
  const proj = tempDir();
  writeFileSync(join(proj, '.thinwindow.json'), JSON.stringify({ enabled: true }));
  for (const v of ['off', 'OFF', '0', 'false']) {
    assert.equal(loadConfig({ projectDir: proj, home: tempDir(), env: { THINWINDOW: v } }).enabled, false);
  }
  assert.equal(loadConfig({ projectDir: proj, home: tempDir(), env: { THINWINDOW: 'on' } }).enabled, true);
});

test('broken or mistyped config falls back to defaults', () => {
  const proj = tempDir();
  writeFileSync(join(proj, '.thinwindow.json'), '{ not json');
  const home = tempDir();
  writeFileSync(join(home, '.thinwindow.json'), JSON.stringify({ maxReadLines: 'lots', enabled: 'no', noisyCommands: ['(', 7] }));
  const c = loadConfig({ projectDir: proj, home, env: {} });
  assert.equal(c.enabled, true);
  assert.equal(c.maxReadLines, 400);
  assert.ok(c.noisyPatterns.length > 10);
});

test('globToRegExp', () => {
  const cases = [
    ['docs/**', 'docs/a.md', true],
    ['docs/**', 'docs/a/b/c.md', true],
    ['docs/**', 'src/docs/a.md', false],
    ['*.md', 'README.md', true],
    ['*.md', 'docs/guide.md', true],
    ['src/*.ts', 'src/a.ts', true],
    ['src/*.ts', 'src/x/a.ts', false],
    ['src/**/*.ts', 'src/a.ts', true],
    ['src/**/*.ts', 'src/x/y/a.ts', true],
    ['fixtures/?.json', 'fixtures/a.json', true],
    ['**/generated/**', '/abs/path/generated/x.ts', true],
  ];
  for (const [glob, path, expected] of cases) {
    assert.equal(globToRegExp(glob).test(path), expected, `${glob} vs ${path}`);
  }
});
