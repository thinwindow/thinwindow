// Cold-resume notice (#34). A prompt sent after the session's prompt cache
// expired re-writes the whole context at the cache-write price. When that
// context is large, the hook holds the prompt once and shows what continuing
// re-writes, next to a fresh start from the session's brief (#33). Sending
// again continues: the notice never acts for the user.
// Claude Code runs UserPromptSubmit hooks synchronously before every prompt,
// so this file loads only what the check needs; the price table and the brief
// lookup load only when a notice is due.
// Input and output: https://code.claude.com/docs/en/hooks#userpromptsubmit
import { join } from 'node:path';
import { loadConfig } from './config.mjs';
import { HOOK_ENV, debug } from './hook-io.mjs';
import { safeId, updateState } from './state.mjs';
import { firstRequest, lastRequest, readSlice } from './usage.mjs';

// The main conversation's cache lives an hour at most
// (https://code.claude.com/docs/en/prompt-caching#cache-lifetime): the report
// script's COLD_GAP_MS, which a test keeps equal to this.
export const IDLE_MS = 60 * 60 * 1000;
// What /thinwindow:resume adds to a fresh session's first request (+372 tokens,
// measured live in #33).
export const RESUME_TOKENS = 400;
const REPORT = '../../skills/thinwindow/scripts/thinwindow-report.mjs';

// A prompt a person sent. Commands are never held, since the advice itself is
// /clear and /thinwindow:resume. Neither are prompts Claude Code writes itself,
// which start with a tag (<task-notification>...); pasted text is tagged too,
// but a person sent it.
export function typedPrompt(prompt) {
  const p = typeof prompt === 'string' ? prompt.trimStart() : '';
  return p !== '' && !p.startsWith('/') && (!p.startsWith('<') || p.startsWith('<pasted_content'));
}

const tokens = (t) => `${t >= 1e6 ? `${(t / 1e6).toFixed(1)}M` : `${Math.round(t / 1000)}k`} tokens`;
const usd = (t, price) => `~US$${((t * price.cacheWrite) / 1e6).toFixed(2)}`;
// claude-opus-5-5 → Opus 5.5
const modelName = (m) => m.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/-(\d+)$/, ' $1').replace(/^\w/, (c) => c.toUpperCase());

function idleFor(ms) {
  const min = Math.round(ms / 60000);
  return min < 120 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} days`;
}

// Three lines: why the prompt was held, then each choice with what it
// re-writes and how to take it. US$ only for a model in the price table.
export function noticeText({ idleMs, context, fresh, model, price, resume }) {
  const after = fresh ? ` re-writes ~${tokens(fresh)}${price ? ` (${usd(fresh, price)})` : ''}` : '';
  return [
    `ThinWindow held this message: this session has been idle ${idleFor(idleMs)}, so its prompt cache has expired.`,
    `Continuing re-writes ~${tokens(context)}${price ? ` (${usd(context, price)} at ${modelName(model)} list price)` : ''}: send it again.`,
    resume
      ? `A fresh start from a short brief${after}: /clear, then /thinwindow:resume <your request>.`
      : `A new session${after}: /clear, then send your request.`,
  ].join('\n');
}

// UserPromptSubmit: the block decision, or null to let the prompt through.
export async function handleUserPromptSubmit(input, { env = HOOK_ENV, home, stateBase, now = Date.now() } = {}) {
  // Only someone at the session can answer. Claude Code sets this to "1" in
  // hooks of its terminal, IDE and desktop sessions and "0" for -p, SDK and
  // background ones. It isn't documented, so without it nothing is held.
  if (env.CLAUDE_CODE_SESSION_ATTENDED !== '1' || !typedPrompt(input.prompt)) return null;
  if (!input.session_id || typeof input.transcript_path !== 'string') return null;
  const projectDir = env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const config = loadConfig({ projectDir, env, home });
  if (!config.enabled || !config.coldResumeNotice) return null;
  const last = lastRequest(readSlice(input.transcript_path));
  if (!last || now - last.at <= IDLE_MS || last.context < config.coldResumeMinTokens) return null;

  const [{ PRICES, resolveModel }, briefs] = await Promise.all([import(REPORT), import('./brief.mjs')]);
  const dataDir = env.CLAUDE_PLUGIN_DATA;
  // /thinwindow:resume takes the project's newest brief: offer it only when
  // that one is this session's.
  const own = dataDir && join(briefs.briefsDir(dataDir, projectDir), `${safeId(input.session_id)}.json`);
  const resume = Boolean(config.briefs && own && briefs.latestBrief(dataDir, projectDir, now)?.path === own);
  const first = firstRequest(readSlice(input.transcript_path, { fromEnd: false }));
  const model = resolveModel(last.model);
  const reason = noticeText({
    idleMs: now - last.at,
    context: last.context,
    fresh: first && first.context + (resume ? RESUME_TOKENS : 0),
    model,
    price: model && PRICES[model],
    resume,
  });
  // Once per idle gap: keyed to the last request, so any prompt after the
  // notice goes through, however long the user takes, until a request runs.
  const show = updateState(
    input.session_id,
    (state) => {
      const key = state.coldNotice === last.at ? 'ColdResume.continue' : 'ColdResume.notice';
      state.stats = { ...state.stats, [key]: (state.stats?.[key] || 0) + 1 };
      state.coldNotice = last.at;
      return key === 'ColdResume.notice';
    },
    { base: stateBase, now },
  );
  // Sizes only, never the prompt.
  debug(show ? `UserPromptSubmit: cold-resume notice, ${tokens(last.context)}` : 'UserPromptSubmit: sent again after a cold-resume notice', env);
  return show ? { decision: 'block', reason } : null;
}
