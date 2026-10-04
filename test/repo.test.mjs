// The same checks CI runs through scripts/check.mjs, plus unit tests for
// the validators themselves.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  RULES_MAX_CHARS,
  parseFrontmatter,
  referencedLabels,
  rulesBudget,
  runChecks,
  validateHooks,
  validateLabels,
  validateMarketplace,
  validatePlugin,
  validateSkill,
  validateTask,
} from '../scripts/check.mjs';
import { HOOK_ENV } from '../hooks/lib/hook-io.mjs';
import { PATHS as DIRECTORY_PATHS, absoluteLinks } from '../scripts/build-directory.mjs';
import { syncedContent } from '../scripts/sync-rules.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

test('the repository passes scripts/check.mjs', () => {
  const { errors } = runChecks();
  assert.deepEqual(errors, []);
});

test('rules/thinwindow.md is within the token budget', () => {
  const text = readFileSync(join(ROOT, 'rules', 'thinwindow.md'), 'utf8');
  const b = rulesBudget(text);
  assert.ok(b.ok, `${b.chars} > ${RULES_MAX_CHARS}`);
  assert.ok(b.estTokens <= 500);
  assert.equal(rulesBudget('x'.repeat(RULES_MAX_CHARS + 1)).ok, false);
});

test('the rules keep every starting rule from the spec', () => {
  const text = readFileSync(join(ROOT, 'rules', 'thinwindow.md'), 'utf8');
  for (const phrase of [
    'Locate before reading',
    'over ~300 lines',
    "Don't re-read",
    'Cap command output',
    'thinwindow-run',
    'git diff --stat',
    'git log -n 10 --oneline',
    'Stop exploring',
    'Batch independent lookups',
    'file:line',
  ]) {
    assert.ok(text.includes(phrase), phrase);
  }
});

test('validatePlugin', () => {
  assert.deepEqual(validatePlugin({ name: 'thinwindow', version: '0.1.0', author: { name: 'x' } }), []);
  assert.ok(validatePlugin({ name: 'Skin Flint' }).length > 0);
  assert.ok(validatePlugin({ name: 'a', version: 'one' }).length > 0);
  assert.ok(validatePlugin({ name: 'a', keywords: 'x' }).length > 0);
});

test('validateMarketplace', () => {
  const ok = { name: 'thinwindow', owner: { name: 'x' }, plugins: [{ name: 'thinwindow', source: './' }] };
  assert.deepEqual(validateMarketplace(ok, 'thinwindow'), []);
  assert.ok(validateMarketplace({ ...ok, owner: {} }).length > 0);
  assert.ok(validateMarketplace({ ...ok, plugins: [{ name: 'thinwindow', source: 'plugins/x' }] }).length > 0);
  assert.ok(validateMarketplace(ok, 'other').length > 0);
});

test('validateHooks', () => {
  const good = { hooks: { PreToolUse: [{ matcher: 'Read', hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.mjs'] }] }] } };
  assert.deepEqual(validateHooks(good, ROOT), []);
  const missing = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/hooks/nope.mjs'] }] }] } };
  assert.match(validateHooks(missing, ROOT)[0], /does not exist/);
  assert.match(validateHooks({ hooks: { PreToolUze: [] } }, ROOT)[0], /unknown hook event/);
});

test('validateTask', () => {
  const t = {
    repo: 'https://github.com/owner/repo.git',
    commit: 'a'.repeat(40),
    prompt: 'Fix it',
    verify: 'npm test',
    timeout: 900,
  };
  assert.deepEqual(validateTask(t), []);
  assert.ok(validateTask({ ...t, commit: 'main' }).length > 0);
  assert.ok(validateTask({ ...t, repo: 'git@github.com:o/r.git' }).length > 0);
  assert.ok(validateTask({ ...t, timeout: 0 }).length > 0);
  assert.ok(validateTask({ ...t, extra: 1 }).length > 0);
  assert.ok(validateTask({ ...t, verify: '' }).length > 0);
});

test('validateSkill and parseFrontmatter', () => {
  const skill = readFileSync(join(ROOT, 'skills', 'thinwindow', 'SKILL.md'), 'utf8');
  assert.deepEqual(validateSkill(skill, 'thinwindow'), []);
  assert.equal(parseFrontmatter(skill).name, 'thinwindow');
  assert.ok(validateSkill('---\nname: Bad_Name\ndescription: x\n---\n', 'Bad_Name').length > 0);
  assert.ok(validateSkill('---\nname: a\ndescription: x\n---\n', 'b').length > 0);
  assert.ok(validateSkill('---\nname: a\n---\n', 'a').length > 0);
  assert.ok(validateSkill('---\nname: a\ndescription: x\nmodel: opus\n---\n', 'a').length > 0);
  assert.ok(validateSkill('no frontmatter', 'a').length > 0);
  // Claude Code-only fields only in skills hidden from `npx skills`.
  assert.ok(validateSkill('---\nname: a\ndescription: x\ndisable-model-invocation: true\n---\n', 'a').length > 0);
  assert.deepEqual(validateSkill('---\nname: a\ndescription: x\ndisable-model-invocation: true\nmetadata:\n  internal: true\n---\n', 'a'), []);
  assert.ok(validateSkill('---\nname: a\ndescription: x\nmodel: opus\nmetadata:\n  internal: true\n---\n', 'a').length > 0);
});

test('the report skill is user-invoked and runs the bundled script', () => {
  const skill = readFileSync(join(ROOT, 'skills', 'report', 'SKILL.md'), 'utf8');
  assert.deepEqual(validateSkill(skill, 'report'), []);
  // Out of the skill listing paid on every request.
  assert.equal(parseFrontmatter(skill)['disable-model-invocation'], 'true');
  const m = /^!`node "\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)" \$ARGUMENTS`$/m.exec(skill);
  assert.ok(m, 'injects the script output with !`...`');
  assert.ok(existsSync(join(ROOT, m[1])), m[1]);
});

test('sync-rules replaces only the marked block', () => {
  const target = 'before\n<!-- rules:start (x) -->\nold\n<!-- rules:end -->\nafter\n';
  assert.equal(syncedContent(target, 'new rules\n'), 'before\n<!-- rules:start (x) -->\nnew rules\n<!-- rules:end -->\nafter\n');
  assert.throws(() => syncedContent('no markers', 'x'));
});

test('validateLabels', () => {
  const ok = [{ name: 'rule', color: '5319e7', description: 'Rules' }];
  assert.deepEqual(validateLabels(ok), []);
  assert.ok(validateLabels({}).length > 0);
  assert.ok(validateLabels([{ name: 'a', color: '#5319e7', description: '' }]).length > 0);
  assert.ok(validateLabels([{ name: 'a', color: 'ABCDEF', description: '' }]).length > 0);
  assert.ok(validateLabels([{ name: 'a', color: 'abcdef', description: 'x'.repeat(101) }]).length > 0);
  assert.ok(validateLabels([...ok, { name: 'Rule', color: 'abcdef', description: '' }]).some((e) => /duplicate/.test(e)));
  assert.ok(validateLabels([{ name: 'a', color: 'abcdef', description: '', default: true }]).length > 0);
});

test('labels.json defines every label the templates and the stale workflow use', () => {
  const labels = JSON.parse(readFileSync(join(ROOT, '.github', 'labels.json'), 'utf8'));
  assert.deepEqual(validateLabels(labels), []);
  const defined = new Set(labels.map((l) => l.name));
  const used = referencedLabels(ROOT);
  for (const name of ['bug', 'rule', 'adapter', 'benchmark', 'stale', 'pinned', 'security', 'roadmap']) {
    assert.ok(used.includes(name), `${name} not found in templates/stale workflow`);
  }
  for (const name of used) assert.ok(defined.has(name), `${name} is used but not defined`);
});

test('the hooks read only the environment variables they name', () => {
  assert.deepEqual(Object.keys(HOOK_ENV), ['THINWINDOW', 'THINWINDOW_DEBUG', 'CLAUDE_PROJECT_DIR']);
  for (const dir of ['hooks', 'hooks/lib']) {
    for (const f of readdirSync(join(ROOT, dir)).filter((n) => n.endsWith('.mjs'))) {
      const reads = readFileSync(join(ROOT, dir, f), 'utf8').match(/process\.env(\.\w+)?/g) || [];
      const expected = f === 'hook-io.mjs' ? Object.keys(HOOK_ENV).map((k) => `process.env.${k}`) : [];
      assert.deepEqual(reads, expected, `${dir}/${f}`);
    }
  }
});

test('the directory branch points relative links at main', () => {
  const isDir = (p) => p === 'bench/results';
  const md = [
    '![chart](bench/results/chart.svg) [raw](bench/results) [docs](docs/a.md#x "t") [top](#install) [x](https://e.com/a)',
    '<a href="README.es.md">es</a> <img src="assets/i.png">',
  ].join('\n');
  assert.equal(
    absoluteLinks(md, 'README.md', isDir),
    [
      '![chart](https://raw.githubusercontent.com/thinwindow/thinwindow/main/bench/results/chart.svg)' +
        ' [raw](https://github.com/thinwindow/thinwindow/tree/main/bench/results)' +
        ' [docs](https://github.com/thinwindow/thinwindow/blob/main/docs/a.md#x "t") [top](#install) [x](https://e.com/a)',
      '<a href="https://github.com/thinwindow/thinwindow/blob/main/README.es.md">es</a>' +
        ' <img src="https://raw.githubusercontent.com/thinwindow/thinwindow/main/assets/i.png">',
    ].join('\n'),
  );
  // Resolved from the file's own folder.
  assert.equal(absoluteLinks('[d](../../docs/a.md)', 'skills/thinwindow/SKILL.md'), '[d](https://github.com/thinwindow/thinwindow/blob/main/docs/a.md)');
  // A closed list: bench/, the website, images and CLAUDE.md stay out.
  assert.deepEqual(DIRECTORY_PATHS, ['.claude-plugin/plugin.json', 'hooks', 'skills', 'rules', 'README.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md']);
});

test('the directory build pins README links and images to the commit it packages', () => {
  assert.equal(
    absoluteLinks('![c](bench/results/chart.svg) [d](docs/a.md) [r](bench/results)', 'README.md', (p) => p === 'bench/results', 'abc123'),
    '![c](https://raw.githubusercontent.com/thinwindow/thinwindow/abc123/bench/results/chart.svg)' +
      ' [d](https://github.com/thinwindow/thinwindow/blob/abc123/docs/a.md)' +
      ' [r](https://github.com/thinwindow/thinwindow/tree/abc123/bench/results)',
  );
});
