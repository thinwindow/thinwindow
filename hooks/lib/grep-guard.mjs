// PreToolUse guard for Claude Code's Grep tool: a content search with no
// head_limit gets one, so a broad pattern can't flood the context.
// Grep input: { pattern, path?, glob?, output_mode?, head_limit?, ... }
// https://code.claude.com/docs/en/tools-reference
export const GREP_HEAD_LIMIT = 100;

export function checkGrepTool({ input, config }) {
  const ti = input.tool_input || {};
  if (!config.rewrite || ti.output_mode !== 'content' || ti.head_limit != null) return { action: 'allow', kind: 'ok' };
  return {
    action: 'rewrite',
    kind: 'grep-cap',
    updatedInput: { ...ti, head_limit: GREP_HEAD_LIMIT },
    context:
      `thinwindow capped this Grep at ${GREP_HEAD_LIMIT} lines. If you need more, narrow the pattern, path or glob, ` +
      'or set head_limit yourself.',
  };
}
