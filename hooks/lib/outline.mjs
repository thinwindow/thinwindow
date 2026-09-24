// Line-numbered outline of a source file, handed to the agent with the head
// of a large file so it can Read the range it needs instead of everything.
// Regex only: approximate by design, and silent on formats it doesn't know.
import { readFileSync } from 'node:fs';

const SYMBOL =
  /^\s*(?:export\s+(?:default\s+)?)?(?:(?:public|private|protected|internal|static|final|abstract|override|open|sealed|data|async|unsafe|pub(?:\([^)]*\))?)\s+)*(?:function\*?|class|interface|type|enum|struct|trait|impl|mod|module|def|fn|func|fun|record|namespace|object)\b\s*[A-Za-z_$<(]/;
const ARROW = /^\s*(?:export\s+)?(?:const|let)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/;
const TEST_CASE = /^\s*(?:describe|it|test)(?:\.\w+)?\(\s*['"`]/;
const HEADING = /^#{1,4}\s+\S/;

export const MAX_OUTLINE = 80;

// Returns { entries: ['12: class Foo', ...], total }.
export function outline(path, { maxEntries = MAX_OUTLINE } = {}) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { entries: [], total: 0 };
  }
  const markdown = /\.(md|mdx|markdown)$/i.test(path);
  const entries = [];
  let total = 0;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (markdown ? HEADING.test(line) : SYMBOL.test(line) || ARROW.test(line) || TEST_CASE.test(line)) {
      total++;
      if (entries.length < maxEntries) entries.push(`${i + 1}: ${line.trim().slice(0, 120)}`);
    }
  }
  return { entries, total };
}
