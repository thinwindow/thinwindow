import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkBash } from '../hooks/lib/bash-guard.mjs';
import { loadConfig } from '../hooks/lib/config.mjs';
import { makeProject } from './helpers.mjs';

const proj = makeProject();

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
    assert.match(r.reason, /^skinflint: /);
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
    const r = decide(cmd);
    assert.equal(r.action, 'deny', JSON.stringify(r));
    assert.equal(r.kind, 'noisy');
    assert.match(r.reason, /skinflint-run/);
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
  'skinflint-run npm test',
  'CI=1 skinflint-run npm test',
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
  assert.equal(decide('npm test', { state }).action, 'deny');
  assert.equal(decide('npm test', { state }).action, 'allow');
  assert.equal(decide('npm test', { state }).action, 'deny');
  assert.equal(decide('npm test -- --watch=false', { state }).action, 'deny');
});

test('anti-pattern denials are not bypassed by retrying', () => {
  const state = { v: 1, agents: {}, denied: [] };
  assert.equal(decide('git log', { state }).action, 'deny');
  assert.equal(decide('git log', { state }).action, 'deny');
});

test('rewrite mode wraps noisy commands with skinflint-run', () => {
  const config = { ...loadConfig({ projectDir: proj.root, home: proj.home, env: {} }), rewrite: true };
  const r = decide('cd app && CI=1 npm test -- -u && npm run build', { config });
  assert.equal(r.action, 'rewrite');
  assert.equal(r.command, 'cd app && CI=1 skinflint-run npm test -- -u && skinflint-run npm run build');
  assert.equal(decide('timeout 60 cargo test', { config }).command, 'timeout 60 skinflint-run cargo test');
});

test('rewrite mode leaves sudo commands to the soft block', () => {
  const config = { ...loadConfig({ projectDir: proj.root, home: proj.home, env: {} }), rewrite: true };
  assert.equal(decide('sudo apt-get install -y jq', { config }).action, 'deny');
});

test('allowlist.commands exempts matching commands', () => {
  const config = loadConfig({ projectDir: proj.root, home: proj.home, env: {} });
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
