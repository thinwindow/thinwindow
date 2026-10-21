#!/usr/bin/env node
// PostToolUse hook for Bash: cuts a successful noisy command's output to its
// last lines, with the full log in a temp file. Fails open. See
// lib/handlers.mjs.
import { runHook } from './lib/hook-io.mjs';
import { handlePostToolUse } from './lib/handlers.mjs';

runHook('PostToolUse', (input) => handlePostToolUse(input), { redact: true });
