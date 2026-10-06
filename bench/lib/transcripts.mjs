// Kept transcripts (#37): a bench run's own session JSONL, scrubbed, written
// next to its results so replays can read every call in full.
//
// The scrub is an allowlist. Record types, fields and content blocks not
// listed are dropped. Attachments of types not listed keep only their type
// and size: that covers the copy of the system prompt, the skill, tool and
// agent listings, the environment and session context, and the account's
// organization. Then paths and names that say whose machine ran it are
// replaced: the clone, the temp dir, the Claude config dir, this checkout
// (the plugin's own skills name their folder), $HOME and the user name.
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { configDir } from './claude.mjs';
import { ROOT_DIR } from './paths.mjs';

const COMMON = ['type', 'uuid', 'parentUuid', 'isSidechain', 'isMeta', 'timestamp', 'sessionId', 'version', 'cwd'];
export const KEEP_FIELDS = {
  user: [...COMMON, 'message', 'sourceToolAssistantUUID'],
  assistant: [...COMMON, 'message'],
  attachment: [...COMMON, 'attachment'],
};
export const KEEP_MESSAGE = ['role', 'model', 'id', 'content', 'stop_reason', 'usage'];
export const KEEP_CONTENT = {
  text: ['type', 'text'],
  thinking: ['type', 'thinking'],
  tool_use: ['type', 'id', 'name', 'input'],
  tool_result: ['type', 'tool_use_id', 'content', 'is_error'],
};
// What the bench and ThinWindow put in the context, kept whole.
export const KEEP_ATTACHMENTS = ['hook_additional_context', 'hook_success', 'max_turns_reached', 'total_tokens_reminder', 'task_reminder', 'budget_usd'];

const pick = (obj, keys) => Object.fromEntries(keys.filter((k) => obj[k] !== undefined).map((k) => [k, obj[k]]));

function content(c) {
  if (!Array.isArray(c)) return c;
  return c.map((b) => {
    const keep = KEEP_CONTENT[b?.type];
    if (!keep) return { type: b?.type ?? null };
    const out = pick(b, keep);
    if (out.type === 'tool_result') out.content = content(out.content);
    return out;
  });
}

export function scrubRecord(r) {
  const keep = KEEP_FIELDS[r?.type];
  if (!keep) return null;
  const out = pick(r, keep);
  if (out.message) out.message = { ...pick(out.message, KEEP_MESSAGE), content: content(out.message.content) };
  if (out.attachment && !KEEP_ATTACHMENTS.includes(out.attachment.type)) {
    out.attachment = { type: String(out.attachment.type ?? ''), chars: JSON.stringify(out.attachment).length };
  }
  return out;
}

const realpath = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
};

// Replaces what says whose machine ran it, longest path first. The user name
// is replaced as a whole word (it shows in `ls -l`), and only when it is long
// enough not to clobber ordinary words.
export function scrubber({ clone = null, home = homedir(), config = configDir(), plugin = ROOT_DIR, user = userInfo().username, tmp = tmpdir() } = {}) {
  const pairs = [
    [clone && realpath(clone), '<clone>'],
    [clone, '<clone>'],
    [realpath(tmp), '<tmp>'],
    [tmp, '<tmp>'],
    [config, '<config>'],
    [plugin, '<plugin>'],
    [home, '~'],
  ]
    .filter(([from]) => from && from.length > 1)
    .sort((a, b) => b[0].length - a[0].length);
  const word = user && user.length >= 4 ? new RegExp(`\\b${user.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g') : null;
  return (text) => {
    let s = pairs.reduce((acc, [from, to]) => acc.split(from).join(to), String(text ?? ''));
    if (word) s = s.replace(word, '<user>');
    return s;
  };
}

export function scrubTranscript(records, scrub) {
  return records.map(scrubRecord).filter(Boolean).map((r) => JSON.parse(scrub(JSON.stringify(r))));
}

// A session's transcript records, found by id under the profile's projects/.
export function sessionRecords(sessionId, root = join(configDir(), 'projects')) {
  for (const dir of existsSync(root) ? readdirSync(root) : []) {
    const file = join(root, dir, `${sessionId}.jsonl`);
    if (!existsSync(file)) continue;
    return readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
  }
  return [];
}

// Only tasks on a public GitHub repo keep their transcript.
export const isPublicRepo = (url) => /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(String(url));

// Writes <outDir>/transcripts/<session id>.jsonl and returns that path
// relative to outDir, or null when there is no transcript to keep.
export function keepTranscript(sessionId, { outDir, clone, root = join(configDir(), 'projects') }) {
  if (!/^[\w-]+$/.test(String(sessionId || ''))) return null;
  const records = sessionRecords(sessionId, root);
  if (!records.length) return null;
  const rel = `transcripts/${sessionId}.jsonl`;
  const file = join(outDir, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${scrubTranscript(records, scrubber({ clone })).map((r) => JSON.stringify(r)).join('\n')}\n`);
  return rel;
}
