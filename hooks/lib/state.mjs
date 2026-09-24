// Per-session state: one JSON file per session_id in the OS temp dir.
// Holds what each agent (main thread or subagent) has read, and the calls
// skinflint recently denied so an identical retry can go through.
import { mkdirSync, readFileSync, renameSync, rmdirSync, statSync, unlinkSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MAX_READS_PER_AGENT = 500;
const MAX_DENIED = 20;
export const RETRY_WINDOW_MS = 10 * 60 * 1000;
const LOCK_STALE_MS = 2000;
const STATE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function stateDir(base = tmpdir()) {
  return join(base, 'skinflint', 'state');
}

export function statePath(sessionId, base) {
  const safe = String(sessionId || 'no-session').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 128);
  return join(stateDir(base), `${safe}.json`);
}

function emptyState() {
  return { v: 1, agents: {}, denied: [] };
}

export function loadState(path) {
  try {
    const s = JSON.parse(readFileSync(path, 'utf8'));
    if (s && s.v === 1 && s.agents && Array.isArray(s.denied)) return s;
  } catch {
    // Missing or corrupt state starts fresh.
  }
  return emptyState();
}

function saveState(path, state) {
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, path);
}

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Parallel tool calls run their hooks concurrently, so updates take a
// short mkdir lock. If the lock can't be had quickly, proceed without it:
// a lost update only means one extra read or one extra deny.
function withLock(path, fn) {
  const lock = `${path}.lock`;
  let locked = false;
  for (let i = 0; i < 40 && !locked; i++) {
    try {
      mkdirSync(lock);
      locked = true;
    } catch (err) {
      if (err.code !== 'EEXIST') break;
      try {
        if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmdirSync(lock);
      } catch {
        // Someone else removed it.
      }
      sleep(5);
    }
  }
  try {
    return fn();
  } finally {
    if (locked) {
      try {
        rmdirSync(lock);
      } catch {
        // Ignore.
      }
    }
  }
}

// Loads the state, lets `fn` mutate it, and saves it. Returns fn's result.
export function updateState(sessionId, fn, { base, now = Date.now() } = {}) {
  const path = statePath(sessionId, base);
  mkdirSync(stateDir(base), { recursive: true });
  return withLock(path, () => {
    const state = loadState(path);
    state.denied = state.denied.filter((d) => now - d.at < RETRY_WINDOW_MS);
    const result = fn(state);
    for (const agent of Object.values(state.agents)) {
      const keys = Object.keys(agent.reads || {});
      if (keys.length > MAX_READS_PER_AGENT) {
        keys
          .sort((a, b) => agent.reads[a].at - agent.reads[b].at)
          .slice(0, keys.length - MAX_READS_PER_AGENT)
          .forEach((k) => delete agent.reads[k]);
      }
    }
    if (state.denied.length > MAX_DENIED) state.denied = state.denied.slice(-MAX_DENIED);
    saveState(path, state);
    return result;
  });
}

export function resetState(sessionId, { base } = {}) {
  try {
    unlinkSync(statePath(sessionId, base));
  } catch {
    // Nothing to reset.
  }
}

// Best-effort cleanup of state files from sessions older than a week.
export function pruneStates({ base, now = Date.now() } = {}) {
  const dir = stateDir(base);
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const p = join(dir, name);
    try {
      if (now - statSync(p).mtimeMs > STATE_MAX_AGE_MS) unlinkSync(p);
    } catch {
      // Ignore races with other sessions.
    }
  }
}

export function agentState(state, agentKey) {
  if (!state.agents[agentKey]) state.agents[agentKey] = { reads: {} };
  return state.agents[agentKey];
}

// Soft block: a call identical to one denied in the last RETRY_WINDOW_MS is
// allowed once. Returns true (and forgets the denial) when this is a retry.
export function consumeDenied(state, key) {
  const i = state.denied.findIndex((d) => d.key === key);
  if (i === -1) return false;
  state.denied.splice(i, 1);
  return true;
}

export function recordDenied(state, key, now = Date.now()) {
  state.denied = state.denied.filter((d) => d.key !== key);
  state.denied.push({ key, at: now });
}
