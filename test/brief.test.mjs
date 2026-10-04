// Session briefs (#33): the Stop hook, the incremental transcript reads, and
// /thinwindow:resume's output, against fixture transcripts.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { RUN } from '../hooks/lib/bash-guard.mjs';
import { BRIEF_MAX_CHARS, briefsDir, buildBrief, emptyBrief, foldRecords, readNewRecords, renderBrief, resumeText, SHORT, updateBrief } from '../hooks/lib/brief.mjs';
import { parseFrontmatter, validateSkill } from '../scripts/check.mjs';
import { tempDir } from './helpers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STOP = join(ROOT, 'hooks', 'stop.mjs');
const START = join(ROOT, 'hooks', 'session-start.mjs');
const SECRET = 'PROMPT-SECRET-7f3a';

const user = (content) => ({ type: 'user', message: { content } });
const assistant = (content) => ({ type: 'assistant', message: { content } });
const jsonl = (records) => records.map((r) => `${JSON.stringify(r)}\n`).join('');

// A session in a repo at `dir`: two turns, a failing then passing test run,
// an edit through Bash (sed) that no Edit call shows.
function turns(dir) {
  return [
    [
      user(`Fix the off-by-one in the pager ${SECRET}.`),
      { type: 'attachment', attachment: { type: 'skill_listing' } },
      assistant([{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: `sed -i '' 's/<=/</' src/pager.js` } }]),
      user([{ type: 'tool_result', tool_use_id: 't1', content: '' }]),
      assistant([{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: `${RUN} npm test` } }]),
      user([{ type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'Exit code 1\n1 failing' }]),
      assistant([{ type: 'text', text: 'One test still fails: the last page is empty.' }]),
    ],
    [
      user('<command-name>/clear</command-name>'),
      user([{ type: 'text', text: 'Handle the empty last page too.' }]),
      assistant([{ type: 'tool_use', id: 't3', name: 'Edit', input: { file_path: join(dir, 'src', 'pager.js') } }]),
      user([{ type: 'tool_result', tool_use_id: 't3', content: 'ok' }]),
      assistant([{ type: 'tool_use', id: 't4', name: 'Bash', input: { command: 'npm test' } }]),
      user([{ type: 'tool_result', tool_use_id: 't4', content: '12 passing' }]),
      assistant([{ type: 'text', text: 'Fixed: the pager stops at the last full page. Tests pass.' }]),
    ],
  ];
}

function git(dir, ...args) {
  // The first commit is two hours old, before any brief in these tests.
  const date = args.includes('init') ? { GIT_COMMITTER_DATE: new Date(Date.now() - 7200_000).toISOString(), GIT_AUTHOR_DATE: new Date(Date.now() - 7200_000).toISOString() } : {};
  const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8', env: { ...process.env, ...date } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
}

function repo() {
  const dir = tempDir('thinwindow-brief-repo-');
  git(dir, 'init', '-q');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'pager.js'), 'a <= b\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-qm', 'init');
  writeFileSync(join(dir, 'src', 'pager.js'), 'a < b\n'); // what the sed did
  return dir;
}

function runStop(input, env = {}) {
  const home = tempDir('thinwindow-home-');
  const r = spawnSync(process.execPath, [STOP], {
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, HOME: home, USERPROFILE: home, CLAUDE_PLUGIN_DATA: '', THINWINDOW: '', THINWINDOW_DEBUG: '', ...env },
  });
  return r;
}

function session() {
  const dir = repo();
  const data = tempDir('thinwindow-data-');
  const transcript = join(tempDir('thinwindow-transcript-'), 's1.jsonl');
  const input = { session_id: 's1', transcript_path: transcript, cwd: dir, hook_event_name: 'Stop' };
  const env = { CLAUDE_PLUGIN_DATA: data, CLAUDE_PROJECT_DIR: dir };
  const file = join(briefsDir(data, dir), 's1.json');
  return { dir, data, transcript, input, env, file };
}

test('folding turn by turn gives the same brief as the whole session at once', () => {
  const [a, b] = turns('/w');
  const whole = buildBrief([...a, ...b], { cwd: '/w' });
  const brief = foldRecords(emptyBrief(), a, { cwd: '/w' });
  assert.equal(renderBrief(foldRecords(brief, b, { cwd: '/w' })), whole);
  assert.ok(whole.length <= BRIEF_MAX_CHARS);
  // thinwindow-run's prefix is dropped, so the command reads as typed.
  assert.match(whole, /\nCommands: `sed -i '' 's\/<=\/<\/' src\/pager\.js` → exit 0; `npm test` → exit 1; `npm test` → exit 0\n/);
});

test('the Stop hook writes the brief, prints nothing, and reads only what is new', () => {
  const s = session();
  const [a, b] = turns(s.dir);
  writeFileSync(s.transcript, jsonl(a));
  let r = runStop({ ...s.input, last_assistant_message: 'One test still fails: the last page is empty.' }, s.env);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
  let brief = JSON.parse(readFileSync(s.file, 'utf8'));
  assert.equal(brief.offset, readFileSync(s.transcript).length);
  assert.deepEqual(brief.git, ['src/pager.js'], 'an edit made through Bash shows up from git status');
  assert.deepEqual(brief.edited, []);

  appendFileSync(s.transcript, jsonl(b));
  r = runStop({ ...s.input, last_assistant_message: 'Fixed: the pager stops at the last full page. Tests pass.' }, { ...s.env, THINWINDOW_DEBUG: '1' });
  assert.equal(r.stdout, '');
  assert.match(r.stderr, /Stop: brief updated from 7 new records/);
  assert.ok(!r.stderr.includes(SECRET) && !r.stderr.includes('pager'), 'debug output carries counts, never content');
  brief = JSON.parse(readFileSync(s.file, 'utf8'));
  const text = renderBrief(brief);
  assert.match(text, new RegExp(`\\nGoal: Fix the off-by-one in the pager ${SECRET}\\.\\n`));
  assert.match(text, /\nRecent requests: Handle the empty last page too\.\n/);
  assert.match(text, /\nFiles edited: src\/pager\.js\n/);
  assert.match(text, /\nLast message: Fixed: the pager stops at the last full page\. Tests pass\.$/);

  r = runStop({ ...s.input, last_assistant_message: 'Fixed: the pager stops at the last full page. Tests pass.' }, { ...s.env, THINWINDOW_DEBUG: '1' });
  assert.match(r.stderr, /Stop: transcript unchanged/);

  // A turn that only read files keeps the last git status instead of running it.
  writeFileSync(join(s.dir, 'new.txt'), 'x');
  appendFileSync(s.transcript, jsonl([user('What does the pager do?'), assistant([{ type: 'text', text: 'It pages.' }])]));
  runStop({ ...s.input, last_assistant_message: 'It pages.', tool_calls_in_turn: [{ tool_name: 'Read', tool_input: {}, tool_use_id: 'r1' }] }, s.env);
  assert.deepEqual(JSON.parse(readFileSync(s.file, 'utf8')).git, ['src/pager.js']);
  appendFileSync(s.transcript, jsonl([user('Add a note.')]));
  runStop({ ...s.input, last_assistant_message: 'Added.', tool_calls_in_turn: [{ tool_name: 'Bash', tool_input: {}, tool_use_id: 'b1' }] }, s.env);
  assert.deepEqual(JSON.parse(readFileSync(s.file, 'utf8')).git, ['src/pager.js', 'new.txt']);
});

test('a lagging transcript: a half-written line waits, and the turn text comes from the input', () => {
  const s = session();
  const [a] = turns(s.dir);
  const full = jsonl(a);
  const cut = full.length - 20;
  writeFileSync(s.transcript, full.slice(0, cut));
  runStop({ ...s.input, last_assistant_message: 'Newest reply.' }, s.env);
  let brief = JSON.parse(readFileSync(s.file, 'utf8'));
  assert.equal(brief.last, 'Newest reply.');
  assert.equal(brief.offset, full.lastIndexOf('\n', cut - 1) + 1);
  appendFileSync(s.transcript, full.slice(cut));
  runStop({ ...s.input, last_assistant_message: 'Newest reply, again.' }, s.env);
  brief = JSON.parse(readFileSync(s.file, 'utf8'));
  assert.equal(brief.offset, Buffer.byteLength(full));
  assert.equal(brief.commands.at(-1).exit, 1);
});

test('reads are bounded: a backlog is caught up over several calls and a huge line is skipped', () => {
  const file = join(tempDir('thinwindow-read-'), 't.jsonl');
  const small = jsonl([user('one'), user('two')]);
  const huge = `${JSON.stringify(user('x'.repeat(5000)))}\n`;
  writeFileSync(file, small + huge + jsonl([user('three')]));
  let r = readNewRecords(file, 0, false, 64);
  assert.deepEqual(r.records.map((x) => x.message.content), ['one']);
  let { offset, skip } = r;
  const seen = [];
  for (let i = 0; i < 200 && offset < readFileSync(file).length; i++) {
    r = readNewRecords(file, offset, skip, 64);
    seen.push(...r.records.map((x) => x.message.content));
    ({ offset, skip } = r);
  }
  assert.deepEqual(seen, ['two', 'three']);
  assert.equal(skip, false);
});

test('the brief is written only when it is on', () => {
  const s = session();
  writeFileSync(s.transcript, jsonl(turns(s.dir)[0]));
  runStop(s.input, { ...s.env, THINWINDOW: 'off' });
  runStop(s.input, { CLAUDE_PROJECT_DIR: s.dir }); // no plugin data dir
  writeFileSync(join(s.dir, '.thinwindow.json'), JSON.stringify({ briefs: false }));
  runStop(s.input, s.env);
  assert.equal(existsSync(join(s.data, 'briefs')), false);
});

test('the Stop hook fails open and silent', () => {
  const s = session();
  for (const input of ['', 'not json', '[]', '{}', JSON.stringify({ ...s.input, transcript_path: join(s.dir, 'missing.jsonl') }), JSON.stringify({ ...s.input, transcript_path: 42 })]) {
    const r = runStop(input, { ...s.env, THINWINDOW_DEBUG: '1' });
    assert.equal(r.status, 0, input);
    assert.equal(r.stdout, '', input);
  }
  const r = runStop(`{"session_id":"s1","x":"${SECRET}`, { ...s.env, THINWINDOW_DEBUG: '1' });
  assert.match(r.stderr, /Stop: error, allowing: SyntaxError/);
  assert.ok(!r.stderr.includes(SECRET), 'an error message that quotes the input is not logged');
});

test('/thinwindow:resume prints the short brief, its age, commits since, and the full path', () => {
  const s = session();
  writeFileSync(s.transcript, jsonl(turns(s.dir).flat()));
  updateBrief({ dataDir: s.data, projectDir: s.dir, sessionId: 's1', transcriptPath: s.transcript, cwd: s.dir, lastMessage: 'Done.', now: Date.now() - 3600_000 });
  git(s.dir, 'commit', '-qam', 'fix: stop the pager at the last page');
  const out = resumeText({ dataDir: s.data, projectDir: s.dir });
  const [shortBrief, rest] = out.split('\nLast message: Done.\n');
  assert.ok(`${shortBrief}\nLast message: Done.`.length <= SHORT.max);
  assert.match(out, /^Brief of an earlier session in this repository, for reference only: check it against `git status`/);
  assert.match(rest, /^Written \d+ min ago; 1 commit since: [0-9a-f]+ fix: stop the pager at the last page\.\nFull brief: .+s1\.json\n$/);
  // Another project sees nothing.
  assert.match(resumeText({ dataDir: s.data, projectDir: tempDir() }), /^No ThinWindow brief/);
  // Expired after 48 hours.
  const old = new Date(Date.now() - 49 * 3600_000);
  utimesSync(s.file, old, old);
  assert.match(resumeText({ dataDir: s.data, projectDir: s.dir }), /^No ThinWindow brief/);
});

test('the resume script exits 0 with or without a brief', () => {
  const script = join(ROOT, 'skills', 'resume', 'resume.mjs');
  for (const args of [[], [tempDir(), tempDir()]]) {
    const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(r.status, 0);
    assert.match(r.stdout, /^No ThinWindow brief/);
  }
});

test('a new session prunes briefs older than 7 days', () => {
  const s = session();
  writeFileSync(s.transcript, jsonl(turns(s.dir)[0]));
  runStop(s.input, s.env);
  const old = new Date(Date.now() - 8 * 86400_000);
  utimesSync(s.file, old, old);
  const tmp = tempDir('thinwindow-tmp-');
  spawnSync(process.execPath, [START], {
    input: JSON.stringify({ session_id: 's2', source: 'startup', cwd: s.dir }),
    env: { ...process.env, ...s.env, TMPDIR: tmp, TEMP: tmp, TMP: tmp, THINWINDOW: '' },
  });
  assert.deepEqual(readdirSync(join(s.data, 'briefs')), []);
});

test('the resume and brief skills are user-invoked only', () => {
  for (const name of ['resume', 'brief']) {
    const skill = readFileSync(join(ROOT, 'skills', name, 'SKILL.md'), 'utf8');
    assert.deepEqual(validateSkill(skill, name), []);
    assert.equal(parseFrontmatter(skill)['disable-model-invocation'], 'true', `${name}: out of the skill listing`);
  }
  const resume = readFileSync(join(ROOT, 'skills', 'resume', 'SKILL.md'), 'utf8');
  const cmd = 'node "${CLAUDE_PLUGIN_ROOT}/skills/resume/resume.mjs"';
  assert.ok(resume.includes(`\n!\`${cmd} "\${CLAUDE_PLUGIN_DATA}" "\${CLAUDE_PROJECT_DIR}"\`\n`));
  assert.ok(resume.includes(`\n  - Bash(${cmd} *)\n`), 'allowed-tools pre-approves the injected command');
  assert.ok(!readFileSync(join(ROOT, 'skills', 'brief', 'SKILL.md'), 'utf8').includes('!`'), 'the brief skill runs nothing');
});

test('a malformed record is skipped, not fatal', () => {
  const brief = foldRecords(emptyBrief(), [null, 42, { type: 'assistant', message: { content: [null, { type: 'text' }] } }, user('Go on.')]);
  assert.equal(brief.goal, 'Go on.');
});
