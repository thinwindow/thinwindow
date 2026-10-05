// Setup-cost notice (#35). Every request re-sends the session's setup: system
// prompt, tools, skill listing, MCP instructions, CLAUDE.md files. After a
// reply, when the session's first request is large, the Stop hook shows the
// user one line with its size and largest parts, at most once a week per
// project. It's a systemMessage: shown to the user, never sent to Claude.
// Claude Code runs Stop hooks synchronously, so this reads only the first
// 256 KB of the transcript, and loads the report script's labels only when a
// notice is due.
// Input and output: https://code.claude.com/docs/en/hooks#stop
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { HOOK_ENV, debug } from './hook-io.mjs';
import { stateDir, updateState } from './state.mjs';
import { firstAttachments, firstRequest, readSlice } from './usage.mjs';

// Replayed on the maintainer's sessions (#35), a daily notice repeated the
// same numbers in 95% of project-days; weekly, it still shows every project.
export const REPEAT_MS = 7 * 24 * 60 * 60 * 1000;
const REPORT = '../../skills/thinwindow/scripts/thinwindow-report.mjs';
const MAX_PARTS = 3;

// When this project last showed the notice. The mark sits with the session
// state files, so it's pruned after a week like them, but isn't a *.json file:
// /thinwindow:report counts those as sessions.
export function markPath(projectDir, base) {
  return join(stateDir(base), `setup-${createHash('sha256').update(String(projectDir)).digest('hex').slice(0, 16)}.mark`);
}

function lastShown(path) {
  try {
    return Number(readFileSync(path, 'utf8')) || 0;
  } catch {
    return 0;
  }
}

const k = (t) => (t >= 1e5 ? `${Math.round(t / 1000)}k` : `${(t / 1000).toFixed(1)}k`);

// One line: the first request's size, then its largest setup parts.
export function noticeText(context, parts = []) {
  const list = parts.length ? ` (${parts.map(([label, t]) => `${label} ${k(t)}`).join(', ')})` : '';
  return `ThinWindow: each request in this session starts at ${Math.round(context / 1000)}k tokens${list}. Run /context to see what you could turn off.`;
}

// Stop: { systemMessage } once a week per project, or null.
export async function handleSetupNotice(input, { env = HOOK_ENV, home, stateBase, now = Date.now() } = {}) {
  // Only shown to someone at the session: CLAUDE_CODE_SESSION_ATTENDED is "1"
  // in terminal, IDE and desktop sessions (undocumented; see cold-resume.mjs).
  if (env.CLAUDE_CODE_SESSION_ATTENDED !== '1' || !input.session_id || typeof input.transcript_path !== 'string') return null;
  const projectDir = env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const config = loadConfig({ projectDir, env, home });
  if (!config.enabled || !config.setupNotice) return null;
  const mark = markPath(projectDir, stateBase);
  if (now - lastShown(mark) < REPEAT_MS) return null;
  const head = readSlice(input.transcript_path, { fromEnd: false });
  // No request yet: the transcript can lag the turn, so a later Stop checks.
  const first = firstRequest(head);
  if (!first || first.context < config.setupNoticeMinTokens) return null;

  const { SETUP, SETUP_LABEL } = await import(REPORT);
  const byKey = {};
  for (const [type, chars] of Object.entries(firstAttachments(head) || {})) {
    if (SETUP[type]) byKey[SETUP[type]] = (byKey[SETUP[type]] || 0) + chars / 4;
  }
  const parts = Object.entries(byKey)
    .filter(([, t]) => t >= 100)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_PARTS)
    .map(([key, t]) => [SETUP_LABEL[key], t]);
  // The mark first: if it can't be written, nothing shows, rather than a
  // notice at every Stop.
  mkdirSync(stateDir(stateBase), { recursive: true });
  // ponytail: two sessions of one project stopping at once can both show it.
  writeFileSync(mark, String(now));
  try {
    updateState(input.session_id, (state) => {
      state.stats = { ...state.stats, 'Setup.notice': (state.stats?.['Setup.notice'] || 0) + 1 };
    }, { base: stateBase, now });
  } catch {
    // A lost count never costs the notice.
  }
  debug(`Stop: setup notice, ${k(first.context)} tokens`, env);
  return { systemMessage: noticeText(first.context, parts) };
}
