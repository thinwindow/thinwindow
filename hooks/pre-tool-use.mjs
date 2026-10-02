#!/usr/bin/env node
// PreToolUse hook for Read and Bash: blocks wasteful calls and suggests a
// cheaper one. Fails open. See lib/handlers.mjs.
import { runHook } from './lib/hook-io.mjs';
import { handlePreToolUse } from './lib/handlers.mjs';

runHook('PreToolUse', (input) => handlePreToolUse(input));
