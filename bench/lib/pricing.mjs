// USD per million tokens, Anthropic API list prices, used for the dry-run
// cost estimate and for the cost shares in bench/docs.mjs. Real runs record
// Claude Code's own `total_cost_usd`. Cache writes are 1-hour writes (2x
// input): that is what Claude Code writes, and on every run in
// bench/results/ `total_cost_usd` equals the recorded tokens priced this way.
// Source: https://platform.claude.com/docs/en/about-claude/pricing (Sep 2026).
export const PRICES = {
  'claude-fable-5-1': { input: 10, output: 50, cacheWrite: 20, cacheRead: 0.25 },
  'claude-fable-5': { input: 10, output: 50, cacheWrite: 20, cacheRead: 1 },
  'claude-opus-5-5': { input: 4, output: 20, cacheWrite: 8, cacheRead: 0.2 },
  'claude-opus-5': { input: 5, output: 25, cacheWrite: 10, cacheRead: 0.5 },
  'claude-opus-4-8': { input: 5, output: 25, cacheWrite: 10, cacheRead: 0.5 },
  'claude-opus-4-7': { input: 5, output: 25, cacheWrite: 10, cacheRead: 0.5 },
  'claude-opus-4-6': { input: 5, output: 25, cacheWrite: 10, cacheRead: 0.5 },
  'claude-sonnet-5': { input: 2, output: 10, cacheWrite: 4, cacheRead: 0.2 },
  'claude-sonnet-4-6': { input: 3, output: 15, cacheWrite: 6, cacheRead: 0.3 },
  'claude-haiku-4-5': { input: 1, output: 5, cacheWrite: 2, cacheRead: 0.1 },
};

// What Claude Code's aliases resolve to on the Anthropic API
// (https://code.claude.com/docs/en/model-config). Other providers differ.
export const ALIASES = {
  opus: 'claude-opus-5-5',
  sonnet: 'claude-sonnet-5',
  haiku: 'claude-haiku-4-5',
  fable: 'claude-fable-5-1',
  best: 'claude-fable-5-1',
};

// A rough prior for one agent run, used only until bench/results has runs
// for the model: 5k uncached input, 60k cache-write, 800k cache-read and 8k
// output tokens. Printed with every estimate so nobody mistakes it for data.
export const PRIOR_RUN_TOKENS = { input: 5000, cacheCreation: 60000, cacheRead: 800000, output: 8000 };

export function resolveModel(model) {
  const base = String(model).toLowerCase().replace(/\[1m\]$/, '');
  if (ALIASES[base]) return ALIASES[base];
  // Strip a date suffix such as -20251001.
  const noDate = base.replace(/-\d{8}$/, '');
  return PRICES[noDate] ? noDate : base;
}

export function priceOf(model) {
  return PRICES[resolveModel(model)] || null;
}

export function costOf(tokens, price) {
  return (
    (tokens.input * price.input +
      tokens.cacheCreation * price.cacheWrite +
      tokens.cacheRead * price.cacheRead +
      tokens.output * price.output) /
    1e6
  );
}
