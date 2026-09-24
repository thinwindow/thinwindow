// Hook handlers, kept free of process I/O so tests can call them directly.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { debug } from './hook-io.mjs';
import { checkBash } from './bash-guard.mjs';
import { checkRead } from './read-guard.mjs';
import { pruneStates, resetState, updateState } from './state.mjs';

const PLUGIN_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const RULES_PATH = join(PLUGIN_ROOT, 'rules', 'skinflint.md');

function projectDirOf(input, env) {
  return env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

// SessionStart: inject the rules as additional context. After compaction
// (or /clear) the content read earlier is gone from the context, so the
// read-tracking state starts over.
// Output schema: https://code.claude.com/docs/en/hooks#sessionstart-decision-control
export function handleSessionStart(input, { env = process.env, home, stateBase } = {}) {
  const config = loadConfig({ projectDir: projectDirOf(input, env), env, home });
  if (!config.enabled) {
    debug('SessionStart: disabled', env);
    return null;
  }
  if (input.source === 'compact' || input.source === 'clear') {
    resetState(input.session_id, { base: stateBase });
    debug(`SessionStart(${input.source}): read-tracking state reset`, env);
  } else if (input.source === 'startup') {
    pruneStates({ base: stateBase });
  }
  const rules = readFileSync(RULES_PATH, 'utf8').trim();
  return { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: rules } };
}

// PreToolUse for Read and Bash. Returns hook JSON, or null to stay out of
// the way (the normal permission flow applies; skinflint never returns
// "allow", so it can't approve anything the user wouldn't).
// Output schema: https://code.claude.com/docs/en/hooks#pretooluse-decision-control
export function handlePreToolUse(input, { env = process.env, home, stateBase, now = Date.now() } = {}) {
  const tool = input.tool_name;
  if (tool !== 'Read' && tool !== 'Bash') return null;
  const projectDir = projectDirOf(input, env);
  const config = loadConfig({ projectDir, env, home });
  if (!config.enabled) return null;

  const result = updateState(
    input.session_id,
    (state) =>
      tool === 'Read'
        ? checkRead({ input, config, state, projectDir, now })
        : checkBash({ input, config, state, projectDir, now, home }),
    { base: stateBase, now },
  );
  const subject = tool === 'Read' ? input.tool_input?.file_path : input.tool_input?.command;
  debug(`${tool} ${result.action} (${result.kind}): ${subject}`, env);

  if (result.action === 'deny') {
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: result.reason,
      },
    };
  }
  if (result.action === 'rewrite') {
    // updatedInput without permissionDecision: the rewritten command still
    // goes through the normal permission evaluation.
    // https://code.claude.com/docs/en/agent-sdk/hooks#modify-tool-input
    return {
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: { ...input.tool_input, command: result.command },
        additionalContext:
          `skinflint ran this command through skinflint-run (${result.cmds.join('; ')}), so its output is a summary: ` +
          'exit code, last 40 lines, error lines, and the path of the full log.',
      },
    };
  }
  return null;
}
