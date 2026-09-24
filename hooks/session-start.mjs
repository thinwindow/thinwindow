#!/usr/bin/env node
// SessionStart hook: injects rules/skinflint.md into the context and resets
// read tracking after compaction. See lib/handlers.mjs.
import { runHook } from './lib/hook-io.mjs';
import { handleSessionStart } from './lib/handlers.mjs';

runHook('SessionStart', (input) => handleSessionStart(input));
