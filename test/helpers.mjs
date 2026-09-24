// Shared test fixtures. Not a test file itself (no .test. in the name and
// kept out of node --test's default patterns via its name).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function tempDir(prefix = 'thinwindow-test-') {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function lines(n, prefix = 'line') {
  return Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';
}

// A fake project: a git root with a big file, a small file, a lockfile, a
// minified file, a binary file and a nested package.
export function makeProject() {
  const root = tempDir('thinwindow-proj-');
  mkdirSync(join(root, '.git'));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'packages', 'app'), { recursive: true });
  writeFileSync(join(root, 'big.txt'), lines(900));
  writeFileSync(join(root, 'src', 'small.ts'), lines(20));
  writeFileSync(join(root, 'package-lock.json'), '{\n  "name": "x"\n}\n');
  writeFileSync(join(root, 'app.min.js'), 'var a=1;');
  writeFileSync(join(root, 'bundle.js'), `${'x'.repeat(5000)}\n`);
  writeFileSync(join(root, 'blob.dat'), Buffer.from([1, 2, 0, 3, 4]));
  writeFileSync(join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0]));
  return {
    root,
    home: tempDir('thinwindow-home-'),
    stateBase: tempDir('thinwindow-state-'),
  };
}
