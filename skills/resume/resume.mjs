#!/usr/bin/env node
// /thinwindow:resume: prints this project's latest session brief (written by
// the Stop hook) in its ≤ 150-token short form, for a fresh session.
//
//   node resume.mjs <plugin data dir> <project dir>
//
// Always exits 0: a failing injected command aborts the whole skill.
// https://code.claude.com/docs/en/skills#inject-dynamic-context
import { resumeText } from '../../hooks/lib/brief.mjs';

const [dataDir, projectDir] = process.argv.slice(2);
try {
  process.stdout.write(resumeText({ dataDir, projectDir }));
} catch {
  process.stdout.write('No ThinWindow brief could be read for this project.\n');
}
