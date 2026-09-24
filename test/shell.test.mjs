import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandWords, parseShell } from '../hooks/lib/shell.mjs';

const texts = (stage) => stage.words.map((w) => w.text);

test('splits pipelines on && || ; & and newlines', () => {
  const { ok, pipelines } = parseShell('cd app && npm test || echo fail; ls\nwc -l x & sleep 1');
  assert.ok(ok);
  assert.deepEqual(
    pipelines.map((p) => texts(p.stages[0])),
    [['cd', 'app'], ['npm', 'test'], ['echo', 'fail'], ['ls'], ['wc', '-l', 'x'], ['sleep', '1']],
  );
  assert.equal(pipelines[4].background, true);
});

test('splits stages on pipes', () => {
  const { pipelines } = parseShell('git log | head -n 5 |& cat');
  assert.equal(pipelines.length, 1);
  assert.deepEqual(pipelines[0].stages.map(texts), [['git', 'log'], ['head', '-n', '5'], ['cat']]);
});

test('handles quotes, escapes and substitutions as single words', () => {
  const { ok, pipelines } = parseShell(`grep -n "a | b" 'c && d' e\\ f $(echo "x y") \`pwd\``);
  assert.ok(ok);
  assert.deepEqual(texts(pipelines[0].stages[0]), ['grep', '-n', 'a | b', 'c && d', 'e f', '$(echo "x y")', '`pwd`']);
});

test('records redirects with fds', () => {
  const { pipelines } = parseShell('npm test > out.log 2>&1');
  const stage = pipelines[0].stages[0];
  assert.deepEqual(texts(stage), ['npm', 'test']);
  assert.deepEqual(
    stage.redirects.map((r) => [r.fd, r.op, r.target]),
    [
      [null, '>', 'out.log'],
      ['2', '>&', '1'],
    ],
  );
  const both = parseShell('make &> /dev/null').pipelines[0].stages[0];
  assert.equal(both.redirects[0].op, '&>');
});

test('skips here-document bodies', () => {
  const { ok, pipelines } = parseShell("cat <<'EOF' > notes.md\ngit log\nnpm test\nEOF\necho done");
  assert.ok(ok);
  assert.deepEqual(
    pipelines.map((p) => texts(p.stages[0])),
    [['cat'], ['echo', 'done']],
  );
});

test('ignores comments and treats subshell parens as separators', () => {
  const { pipelines } = parseShell('(cd x && npm ci) # install\n{ ls; }');
  assert.deepEqual(
    pipelines.map((p) => texts(p.stages[0])),
    [['cd', 'x'], ['npm', 'ci'], ['ls']],
  );
});

test('keeps find -exec {} \\; intact', () => {
  const { pipelines } = parseShell('find src -name "*.ts" -exec wc -l {} \\;');
  assert.deepEqual(texts(pipelines[0].stages[0]), ['find', 'src', '-name', '*.ts', '-exec', 'wc', '-l', '{}', ';']);
});

test('reports unterminated quotes', () => {
  assert.equal(parseShell('echo "oops').ok, false);
  assert.equal(parseShell("echo 'oops").ok, false);
});

test('word offsets point into the source', () => {
  const src = 'FOO=1 npm  test';
  const w = parseShell(src).pipelines[0].stages[0].words;
  assert.equal(src.slice(w[1].start, w[1].end), 'npm');
  assert.equal(src.slice(w[2].start, w[2].end), 'test');
});

test('commandWords strips assignments and wrappers', () => {
  const stage = (src) => parseShell(src).pipelines[0].stages[0];
  const words = (src) => commandWords(stage(src)).words.map((w) => w.text);
  assert.deepEqual(words('CI=1 FOO=bar npm test'), ['npm', 'test']);
  assert.deepEqual(words('sudo -u root apt-get install x'), ['apt-get', 'install', 'x']);
  assert.deepEqual(words('timeout -s KILL 60 cargo test'), ['cargo', 'test']);
  assert.deepEqual(words('env -i PATH=/bin time -p make'), ['make']);
  assert.deepEqual(commandWords(stage('sudo npm i')).wrappers, ['sudo']);
});
