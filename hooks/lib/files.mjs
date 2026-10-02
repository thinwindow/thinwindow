// File inspection helpers: line counts, binary sniffing, lockfile and
// minified-file detection. All reads are bounded.
import { closeSync, openSync, readSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';

const CHUNK = 64 * 1024;
// Past this size, counting stops and the file is simply "large".
const COUNT_LIMIT_BYTES = 64 * 1024 * 1024;

export const LOCKFILES = new Set([
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'deno.lock',
  'Cargo.lock',
  'Gemfile.lock',
  'composer.lock',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'pdm.lock',
  'go.sum',
  'mix.lock',
  'pubspec.lock',
  'Podfile.lock',
  'packages.lock.json',
  'flake.lock',
  'gradle.lockfile',
]);

// Extensions the Read tool renders specially (images, PDFs, notebooks); the
// line-based guards don't apply to them.
const READ_SPECIAL_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.svg', '.pdf', '.ipynb',
]);

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.pdf', '.zip', '.gz', '.tgz',
  '.bz2', '.xz', '.7z', '.rar', '.jar', '.war', '.class', '.so', '.dylib', '.dll', '.exe',
  '.o', '.a', '.lib', '.bin', '.wasm', '.pyc', '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp3', '.mp4', '.mov', '.avi', '.webm', '.ogg', '.wav', '.flac', '.sqlite', '.db',
]);

export function fileInfo(path) {
  try {
    const st = statSync(path);
    if (!st.isFile()) return null;
    return { size: st.size, mtimeMs: st.mtimeMs };
  } catch {
    return null;
  }
}

export function isLockfile(path) {
  return LOCKFILES.has(basename(path));
}

export function isReadSpecial(path) {
  return READ_SPECIAL_EXT.has(extname(path).toLowerCase());
}

function readHead(path, bytes) {
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally {
    closeSync(fd);
  }
}

export function isBinary(path) {
  if (BINARY_EXT.has(extname(path).toLowerCase())) return true;
  try {
    return readHead(path, 8192).includes(0);
  } catch {
    return false;
  }
}

// Minified: by name, or a text file whose first 8 KB holds very long lines.
export function isMinified(path) {
  const name = basename(path).toLowerCase();
  if (/\.min\.(js|mjs|cjs|css)$/.test(name) || name.endsWith('.map')) return true;
  if (!/\.(js|mjs|cjs|css|json|html|svg)$/.test(name)) return false;
  try {
    const head = readHead(path, 8192).toString('utf8');
    const lines = head.split('\n');
    const longest = Math.max(...lines.map((l) => l.length));
    return head.length >= 4096 && longest >= 2000;
  } catch {
    return false;
  }
}

// Counts lines the way an editor shows them: a trailing newline doesn't
// start a new line. Returns Infinity for files too big to count cheaply.
export function countLines(path) {
  const info = fileInfo(path);
  if (!info) return 0;
  if (info.size === 0) return 0;
  if (info.size > COUNT_LIMIT_BYTES) return Infinity;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    let lines = 0;
    let last = 10;
    let n;
    let pos = 0;
    while ((n = readSync(fd, buf, 0, CHUNK, pos)) > 0) {
      const view = n === CHUNK ? buf : buf.subarray(0, n);
      for (let i = view.indexOf(10); i !== -1; i = view.indexOf(10, i + 1)) lines++;
      last = view[n - 1];
      pos += n;
    }
    return last === 10 ? lines : lines + 1;
  } finally {
    closeSync(fd);
  }
}
