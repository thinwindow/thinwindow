import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkBash } from '../hooks/lib/bash-guard.mjs';
import { loadConfig } from '../hooks/lib/config.mjs';
import { lines, makeProject } from './helpers.mjs';

const proj = makeProject();
// "rewrite": false restores the soft block for noisy commands.
const soft = () => ({ ...loadConfig({ projectDir: proj.root, home: proj.home, env: {} }), rewrite: false });

function decide(command, { cwd = proj.root, config, state, extra = {} } = {}) {
  const cfg = config || loadConfig({ projectDir: proj.root, home: proj.home, env: {} });
  return checkBash({
    input: { session_id: 's', cwd, tool_name: 'Bash', tool_input: { command, ...extra } },
    config: cfg,
    state: state || { v: 1, agents: {}, denied: [] },
    projectDir: proj.root,
    home: proj.home,
  });
}

const DENIED_ANTI_PATTERNS = [
  'cat big.txt',
  'cat -n big.txt',
  'bat big.txt',
  'cat package-lock.json',
  'less package-lock.json',
  'cat app.min.js',
  'cat bundle.js',
  'cat blob.dat',
  'git log',
  'git log --oneline',
  'git -C . log -p',
  'git --no-pager log --stat',
  'ls -R',
  'ls -laR src',
  'ls --recursive',
  'tree',
  'tree -a',
  'find .',
  'find . -name "*.ts"',
  'find',
  `find ${proj.root.replace(/\\/g, '/')} -type f`,
  'find ~ -name x',
  'cd src && cat ../big.txt',
  'git log | cat',
];

for (const cmd of DENIED_ANTI_PATTERNS) {
  test(`denies anti-pattern: ${cmd}`, () => {
    const r = decide(cmd);
    assert.equal(r.action, 'deny', JSON.stringify(r));
    assert.equal(r.kind, 'anti-pattern');
    assert.match(r.reason, /^thinwindow: /);
  });
}

const ALLOWED = [
  'cat src/small.ts',
  'cat missing-file.txt',
  'cat big.txt | grep line',
  'cat big.txt | head -n 20',
  'cat big.txt > copy.txt',
  'cat big.txt >/dev/null 2>&1',
  'cat <<EOF > out.md\nhello\nEOF',
  'cat',
  'head -n 50 package-lock.json',
  'grep -n lodash package-lock.json',
  'git log -n 10 --oneline',
  'git log -5',
  'git log -n5 -p',
  'git log --max-count=3',
  'git log --max-count 3',
  'git log main..HEAD --oneline',
  'git log --since=2.weeks',
  'git log --oneline | head -20',
  'git status',
  'git diff --stat',
  'ls',
  'ls -la src',
  'ls -r',
  'tree -L 2',
  'tree -L2 -I node_modules',
  'find . -maxdepth 2 -name "*.ts"',
  'find src -name "*.ts"',
  'find . -name "*.ts" | head',
  'find packages/app -type f',
  'echo "cat big.txt"',
  'rg -n foo src',
];

for (const cmd of ALLOWED) {
  test(`allows: ${JSON.stringify(cmd)}`, () => {
    const r = decide(cmd);
    assert.equal(r.action, 'allow', JSON.stringify(r));
  });
}

test('a ~ inside a path is literal (Windows short names)', () => {
  const tilde = join(proj.root, 'src', 'dir~1');
  mkdirSync(tilde, { recursive: true });
  writeFileSync(join(tilde, 'big.txt'), lines(900));
  assert.equal(decide(`cat ${join('src', 'dir~1', 'big.txt').replace(/\\/g, '/')}`).action, 'deny');
  assert.equal(decide('cat ~/big.txt').action, 'allow');
});

test('find . from a subdirectory of the repo is not "from the root"', () => {
  assert.equal(decide('find . -name "*.ts"', { cwd: join(proj.root, 'packages', 'app') }).action, 'allow');
  assert.equal(decide('find ../.. -name "*.ts"', { cwd: join(proj.root, 'packages', 'app') }).action, 'deny');
});

const NOISY = [
  'npm test',
  'npm install',
  'npm ci',
  'npm run build',
  'pnpm test',
  'yarn',
  'yarn install --frozen-lockfile',
  'bun test',
  'npx jest',
  'npx vitest run',
  'pytest',
  'python -m pytest -x tests',
  'pip install -r requirements.txt',
  'uv sync',
  'cargo test',
  'go test ./...',
  './gradlew build',
  'mvn package',
  'make',
  'cd app && npm test',
  'CI=1 npm test',
  'npm test 2>&1',
  'npm test | cat',
  'node --test',
  'uv run pytest -x',
];

for (const cmd of NOISY) {
  test(`soft-blocks noisy command: ${cmd}`, () => {
    const r = decide(cmd, { config: soft() });
    assert.equal(r.action, 'deny', JSON.stringify(r));
    assert.equal(r.kind, 'noisy');
    assert.match(r.reason, /thinwindow-run/);
  });
}

const CAPPED = [
  'npm test | tail -n 40',
  'npm test 2>&1 | tail -40',
  'npm test > test.log 2>&1',
  'npm install --silent',
  'npm ci --loglevel=error',
  'npm ci --loglevel error',
  'pytest -q',
  'pip install -q -r requirements.txt',
  'thinwindow-run npm test',
  'CI=1 thinwindow-run npm test',
  'npm test | grep -c passing',
  'npm view react version',
  'npm run dev',
  'cargo run',
  'go version',
];

for (const cmd of CAPPED) {
  test(`allows capped or quiet command: ${cmd}`, () => {
    assert.equal(decide(cmd).action, 'allow');
  });
}

test('background commands are not soft-blocked', () => {
  assert.equal(decide('npm test', { extra: { run_in_background: true } }).action, 'allow');
  assert.equal(decide('npm run build &').action, 'allow');
});

test('an identical retry of a soft-blocked command goes through once', () => {
  const state = { v: 1, agents: {}, denied: [] };
  const config = soft();
  assert.equal(decide('npm test', { state, config }).action, 'deny');
  assert.equal(decide('npm test', { state, config }).action, 'allow');
  assert.equal(decide('npm test', { state, config }).action, 'deny');
  assert.equal(decide('npm test -- --watch=false', { state, config }).action, 'deny');
});

test('noisy commands are rewritten through thinwindow-run by default', () => {
  const r = decide('npm test');
  assert.equal(r.action, 'rewrite');
  assert.equal(r.command, 'thinwindow-run npm test');
});

test('anti-pattern denials are not bypassed by retrying', () => {
  const state = { v: 1, agents: {}, denied: [] };
  assert.equal(decide('git log', { state }).action, 'deny');
  assert.equal(decide('git log', { state }).action, 'deny');
});

test('rewrite mode wraps noisy commands with thinwindow-run', () => {
  const config = { ...loadConfig({ projectDir: proj.root, home: proj.home, env: {} }), rewrite: true };
  const r = decide('cd app && CI=1 npm test -- -u && npm run build', { config });
  assert.equal(r.action, 'rewrite');
  assert.equal(r.command, 'cd app && CI=1 thinwindow-run npm test -- -u && thinwindow-run npm run build');
  assert.equal(decide('timeout 60 cargo test', { config }).command, 'timeout 60 thinwindow-run cargo test');
});

test('rewrite mode leaves sudo commands to the soft block', () => {
  const config = { ...loadConfig({ projectDir: proj.root, home: proj.home, env: {} }), rewrite: true };
  assert.equal(decide('sudo apt-get install -y jq', { config }).action, 'deny');
});

test('allowlist.commands exempts matching commands', () => {
  const config = soft();
  config.allowCommandPatterns = [/^npm test$/, /^git log/];
  assert.equal(decide('npm test', { config }).action, 'allow');
  assert.equal(decide('git log', { config }).action, 'allow');
  assert.equal(decide('npm ci', { config }).action, 'deny');
});

test('allowlist.paths exempts files from the cat checks', () => {
  const config = loadConfig({ projectDir: proj.root, home: proj.home, env: {} });
  config.allowPathPatterns = [/^big\.txt$/];
  assert.equal(decide('cat big.txt', { config }).action, 'allow');
});

test('unparseable commands are allowed', () => {
  assert.equal(decide('cat "big.txt').action, 'allow');
  assert.equal(decide('').action, 'allow');
});

const SCOPE_DENIED = [
  'grep -rn foo .',
  'grep -rn foo',
  'egrep -r foo .',
  'fgrep -r foo .',
  'rg foo',
  'rg -n foo .',
  'ag foo',
  'grep -R foo .',
  'grep --recursive foo .',
  'git diff',
  'git diff main..HEAD',
  'git diff --cached',
  'git diff HEAD~1',
];

for (const cmd of SCOPE_DENIED) {
  test(`soft-blocks scope issue: ${cmd}`, () => {
    const r = decide(cmd, { config: soft() });
    assert.equal(r.action, 'deny', JSON.stringify(r));
    assert.equal(r.kind, 'scope');
    assert.match(r.reason, /^thinwindow: /);
  });
}

const SCOPE_ALLOWED = [
  // grep on a single file (must keep passing)
  'grep -n lodash package-lock.json',
  'grep foo big.txt',
  // scoped to a subdirectory, not the whole tree
  'grep -rn foo src',
  'rg -n foo src',
  'rg foo src',
  // capped
  'grep -rn --max-count=5 foo .',
  'grep -rn -m5 foo .',
  'grep -rn -m 5 foo .',
  'rg -m 20 foo',
  'rg --max-count=20 foo',
  // excluded
  'grep -rn foo . --exclude-dir=node_modules',
  "rg -g '!node_modules' foo",
  'rg -tjs foo',
  // inherently bounded output (filenames or counts only, not match lines)
  'grep -rl foo .',
  'grep -rc foo .',
  'rg -l foo',
  'rg --count foo',
  // already capped by a later pipeline stage or a redirect
  'grep -r foo . | head',
  'grep -r foo . > out.txt',
  // git diff (must keep passing)
  'git diff -- src/foo.ts',
  'git diff --stat',
  'git diff --shortstat',
  'git diff --name-only',
  'git diff HEAD~1 -- src/foo.ts',
];

for (const cmd of SCOPE_ALLOWED) {
  test(`allows: ${JSON.stringify(cmd)} (scope check)`, () => {
    assert.equal(decide(cmd).action, 'allow', JSON.stringify(decide(cmd)));
  });
}

test('scope issues get a soft block: an identical retry goes through once', () => {
  const config = soft();
  const state = { v: 1, agents: {}, denied: [] };
  assert.equal(decide('grep -rn foo .', { state, config }).action, 'deny');
  assert.equal(decide('grep -rn foo .', { state, config }).action, 'allow');
  assert.equal(decide('grep -rn foo .', { state, config }).action, 'deny');

  const state2 = { v: 1, agents: {}, denied: [] };
  assert.equal(decide('git diff', { state: state2, config }).action, 'deny');
  assert.equal(decide('git diff', { state: state2, config }).action, 'allow');
  assert.equal(decide('git diff', { state: state2, config }).action, 'deny');
});

test('a head cap on a short concatenation of files is dropped', () => {
  mkdirSync(join(proj.root, 'wf'), { recursive: true });
  writeFileSync(join(proj.root, 'wf', 'a.yml'), lines(58));
  writeFileSync(join(proj.root, 'wf', 'b.yml'), lines(31));
  const r = decide("cat wf/*.yml | head -60; grep -n engines package.json");
  assert.equal(r.action, 'rewrite');
  assert.equal(r.command, 'cat wf/*.yml; grep -n engines package.json');
  assert.match(r.context, /2 files are only 89 lines/);
  assert.equal(decide('cat wf/a.yml wf/b.yml | head -n 20').command, 'cat wf/a.yml wf/b.yml');
  for (const cmd of [
    'cat wf/a.yml | head -20', // one file: its top is a real intent
    'cat wf/*.yml | head -100', // the cap cuts nothing
    'cat wf/*.yml big.txt | head -60', // long in total: the cap stays
    'cat wf/*.yml package-lock.json | head -60',
    'cat "wf/*.yml" | head -60', // quoted: no glob
    'cat $DIR/*.yml | head -60',
    'cat wf/*.yml | head -c 100',
    'cat wf/*.yml | head -n 20 > out.txt',
  ]) assert.equal(decide(cmd).action, 'allow', cmd);
  assert.equal(decide('cat wf/*.yml | head -60', { config: soft() }).action, 'allow');
});

test('scope issues are fixed in place by default', () => {
  const grep = decide('grep -rn foo .');
  assert.equal(grep.action, 'rewrite');
  assert.equal(grep.command, 'grep --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build -rn foo . | head -n 100');
  assert.match(grep.context, /first 100 lines/);
  assert.equal(decide('rg -n foo .').command, 'rg -n foo . | head -n 100');
  assert.equal(decide('git diff').command, 'git diff --stat');
  assert.equal(decide('git -C sub diff HEAD~1').command, 'git -C sub diff --stat HEAD~1');
  const both = decide('git diff && npm test');
  assert.equal(both.command, 'git diff --stat && thinwindow-run npm test');
  assert.match(both.context, /git diff --stat/);
  assert.match(both.context, /thinwindow-run/);
  assert.equal(decide('sudo grep -rn foo .').action, 'deny');
});
