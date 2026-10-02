// PreToolUse guard for the Read tool.
// Read input: { file_path (absolute), offset?, limit? }
// https://code.claude.com/docs/en/hooks#read
import { relative, isAbsolute } from 'node:path';
import { countLines, fileInfo, isBinary, isReadSpecial } from './files.mjs';
import { outline } from './outline.mjs';
import { agentState, consumeDenied, recordDenied } from './state.mjs';

export function displayPath(path, projectDir) {
  if (!projectDir) return path;
  const rel = relative(projectDir, path);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.replace(/\\/g, '/') : path;
}

export function isAllowlistedPath(path, config, projectDir) {
  if (!config.allowPathPatterns || config.allowPathPatterns.length === 0) return false;
  const abs = path.replace(/\\/g, '/');
  const rel = displayPath(path, projectDir);
  return config.allowPathPatterns.some((re) => re.test(abs) || re.test(rel));
}

function rangeLabel(ti) {
  if (ti.offset == null && ti.limit == null) return 'whole file';
  const start = ti.offset ?? 1;
  return ti.limit == null ? `from line ${start}` : `lines ${start}-${start + ti.limit - 1}`;
}

// Lines a large whole-file read returns in rewrite mode.
export const READ_HEAD_LINES = 120;

// Decides one Read call. Mutates `state` (records reads and denials).
// Returns { action: 'allow' | 'deny' | 'rewrite', kind, reason?, updatedInput?, context? }.
export function checkRead({ input, config, state, projectDir, now = Date.now() }) {
  const ti = input.tool_input || {};
  const path = ti.file_path;
  if (typeof path !== 'string' || path === '') return { action: 'allow', kind: 'no-path' };
  if (isAllowlistedPath(path, config, projectDir)) return { action: 'allow', kind: 'allowlist' };
  if (isReadSpecial(path)) return { action: 'allow', kind: 'special-file' };
  const info = fileInfo(path);
  if (!info) return { action: 'allow', kind: 'missing' };
  if (isBinary(path)) return { action: 'allow', kind: 'binary' };

  const agent = agentState(state, input.agent_id || 'main');
  const readKey = `${path}\u0000${ti.offset ?? ''}\u0000${ti.limit ?? ''}`;
  const denyKey = `read\u0000${input.agent_id || 'main'}\u0000${readKey}`;
  const record = () => {
    agent.reads[readKey] = { mtimeMs: info.mtimeMs, size: info.size, at: now };
  };

  if (consumeDenied(state, denyKey)) {
    record();
    return { action: 'allow', kind: 'retry' };
  }

  const shown = displayPath(path, projectDir);

  const prev = agent.reads[readKey];
  if (prev && prev.mtimeMs === info.mtimeMs && prev.size === info.size) {
    recordDenied(state, denyKey, now);
    return {
      action: 'deny',
      kind: 'reread',
      reason:
        `thinwindow: ${shown} (${rangeLabel(ti)}) is already in your context and has not changed since you read it. ` +
        'Use what you already have. If it is no longer in your context, repeat this exact Read call and it will go through.',
    };
  }

  if (ti.offset == null && ti.limit == null) {
    const lines = countLines(path);
    if (lines > config.maxReadLines) {
      recordDenied(state, denyKey, now);
      // Rewrite mode: return the head and a map of the file in this same
      // call, so the agent doesn't spend a turn on a denial. Repeating the
      // whole-file Read still gets the full file (the soft block above).
      if (config.rewrite && Number.isFinite(lines)) {
        const map = outline(path);
        const more = map.total > map.entries.length ? `, first ${map.entries.length} of ${map.total}` : '';
        return {
          action: 'rewrite',
          kind: 'large-file',
          updatedInput: { ...ti, limit: READ_HEAD_LINES },
          context:
            `thinwindow: ${shown} has ${lines} lines, so this Read returned lines 1-${READ_HEAD_LINES}. ` +
            'Read the range you need with offset and limit. Repeating the whole-file Read returns the full file.' +
            (map.entries.length ? `\nOutline (line: symbol${more}):\n${map.entries.join('\n')}` : ''),
        };
      }
      const count = Number.isFinite(lines) ? `${lines} lines` : 'more than 64 MB';
      return {
        action: 'deny',
        kind: 'large-file',
        reason:
          `thinwindow: ${shown} has ${count}, over the ${config.maxReadLines}-line limit for whole-file reads. ` +
          `Grep for what you need (grep -n "<symbol>" ${shown}) and Read only that range with offset and limit. ` +
          'If you really need the whole file, repeat this exact Read call and it will go through.',
      };
    }
  }

  record();
  return { action: 'allow', kind: 'ok' };
}
