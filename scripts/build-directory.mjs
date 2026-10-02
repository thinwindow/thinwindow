#!/usr/bin/env node
// Builds the `directory` branch: only the files the plugin directory needs,
// taken from HEAD, in a worktree next to this checkout. The directory's
// scanner reads everything on the branch it tracks, so bench/, the website,
// images and CLAUDE.md stay out. Relative links and images in the Markdown
// files point on GitHub at the commit the branch is built from, since their
// targets are not on this branch and main can lag behind that commit.
//
//   node scripts/build-directory.mjs [--dir <worktree>] [--no-validate]
//
// Commits the tree on `directory` when it changed; it never pushes.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const BRANCH = 'directory';
const REPO = 'https://github.com/thinwindow/thinwindow';
const RAW = 'https://raw.githubusercontent.com/thinwindow/thinwindow';

// The closed list (PLAN §3). Adding a path here is a decision, not a fix.
export const PATHS = ['.claude-plugin/plugin.json', 'hooks', 'skills', 'rules', 'README.md', 'LICENSE', 'CHANGELOG.md', 'SECURITY.md'];
export const LIMITS = { files: 512, bytes: 256 * 1024 };
const IMAGE = /\.(svg|png|jpe?g|gif|webp|ico)$/i;

// A relative link target in `file` (a repo path) -> its URL at `ref` on
// GitHub, so a build can pin links and images to the commit it packages.
export function absoluteUrl(target, file, isDir = () => false, ref = 'main') {
  if (/^([a-z][a-z0-9+.-]*:|#|\/\/)/i.test(target)) return target;
  const [path, hash] = target.split(/(?=#)/);
  const p = posix.normalize(posix.join(posix.dirname(file), path.replace(/^\//, '')));
  if (IMAGE.test(p)) return `${RAW}/${ref}/${p}${hash || ''}`;
  return `${REPO}/${isDir(p) ? 'tree' : 'blob'}/${ref}/${p}${hash || ''}`;
}

// Markdown links and images, and href/src attributes of inline HTML.
export function absoluteLinks(md, file, isDir, ref) {
  return md
    .replace(/\]\(([^)\s]+)((?:\s+"[^"]*")?)\)/g, (_, url, title) => `](${absoluteUrl(url, file, isDir, ref)}${title})`)
    .replace(/\b(href|src)="([^"]+)"/g, (_, attr, url) => `${attr}="${absoluteUrl(url, file, isDir, ref)}"`);
}

// Every file under `dir`, as paths relative to it, without .git.
function walk(dir, base = dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === '.git') return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p, base) : [relative(base, p).split('\\').join('/')];
  });
}

// What the directory's limits would reject: too many files, a large file,
// or a file that isn't text.
export function treeProblems(dir) {
  const files = walk(dir);
  const problems = [];
  if (files.length >= LIMITS.files) problems.push(`${files.length} files (limit: under ${LIMITS.files})`);
  for (const f of files) {
    const buf = readFileSync(join(dir, f));
    if (buf.length > LIMITS.bytes) problems.push(`${f}: ${buf.length} bytes (limit ${LIMITS.bytes})`);
    if (IMAGE.test(f) || buf.includes(0)) problems.push(`${f}: an image or a binary file`);
  }
  return { files, problems };
}

function git(args, opts = {}) {
  const res = spawnSync('git', args, { cwd: ROOT, encoding: opts.encoding ?? 'utf8', maxBuffer: 1 << 28, ...opts });
  if (res.status !== 0 && !opts.allowFail) throw new Error(`git ${args.join(' ')}: ${String(res.stderr).trim()}`);
  return res;
}

function ensureWorktree(dir) {
  if (existsSync(join(dir, '.git'))) return;
  const has = (ref) => git(['rev-parse', '--verify', '--quiet', ref], { allowFail: true }).status === 0;
  if (has(`refs/heads/${BRANCH}`)) git(['worktree', 'add', dir, BRANCH]);
  else if (has(`refs/remotes/origin/${BRANCH}`)) git(['worktree', 'add', '-b', BRANCH, dir, `origin/${BRANCH}`]);
  else {
    // git < 2.42 has no `worktree add --orphan`.
    git(['worktree', 'add', '--detach', dir]);
    git(['checkout', '-q', '--orphan', BRANCH], { cwd: dir });
  }
}

export function build({ dir, validate = true, log = console.log }) {
  const head = git(['rev-parse', '--short', 'HEAD']).stdout.trim();
  // Links and images pinned to this commit: main can lag behind the version being packaged.
  const sha = git(['rev-parse', 'HEAD']).stdout.trim();
  ensureWorktree(dir);
  const wt = (args, opts) => git(args, { cwd: dir, ...opts });
  wt(['rm', '-r', '-q', '--cached', '--ignore-unmatch', '.']);
  wt(['clean', '-f', '-d', '-x', '-q']);
  const tar = git(['archive', '--format=tar', 'HEAD', '--', ...PATHS], { encoding: 'buffer' }).stdout;
  const untar = spawnSync('tar', ['-x', '-f', '-', '-C', dir], { input: tar });
  if (untar.status !== 0) throw new Error(`tar: ${String(untar.stderr).trim()}`);

  const isDir = (p) => existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).isDirectory();
  for (const f of walk(dir).filter((f) => f.endsWith('.md'))) {
    const p = join(dir, f);
    writeFileSync(p, absoluteLinks(readFileSync(p, 'utf8'), f, isDir, sha));
  }
  const { files, problems } = treeProblems(dir);
  if (problems.length) throw new Error(`the tree breaks the directory's limits:\n  ${problems.join('\n  ')}`);
  if (validate) {
    const v = spawnSync('claude', ['plugin', 'validate', '--strict', dir], { encoding: 'utf8' });
    if (v.error || v.status !== 0) throw new Error(`claude plugin validate --strict failed:\n${v.error?.message || `${v.stdout}${v.stderr}`}`);
  }

  wt(['add', '-A', '.']);
  if (wt(['diff', '--cached', '--quiet'], { allowFail: true }).status === 0 && wt(['rev-parse', '--verify', '--quiet', 'HEAD'], { allowFail: true }).status === 0) {
    log(`${BRANCH} already matches ${head} (${files.length} files)`);
    return { head, files, committed: false };
  }
  // The commit carries the author of the commit it was built from.
  const [name, email] = git(['log', '-1', '--format=%an%n%ae', 'HEAD']).stdout.trim().split('\n');
  const who = { GIT_AUTHOR_NAME: name, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: name, GIT_COMMITTER_EMAIL: email };
  wt(['commit', '-q', '-m', `build: directory from ${head}`], { env: { ...process.env, ...who } });
  log(`${BRANCH} at ${wt(['rev-parse', '--short', 'HEAD']).stdout.trim()}: ${files.length} files from ${head}, in ${dir}. Not pushed.`);
  return { head, files, committed: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: { dir: { type: 'string', default: join(ROOT, '..', 'thinwindow-directory') }, 'no-validate': { type: 'boolean', default: false } },
  });
  try {
    build({ dir: values.dir, validate: !values['no-validate'] });
  } catch (err) {
    console.error(String(err.message || err));
    process.exit(1);
  }
}
