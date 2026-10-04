#!/usr/bin/env node
// UserPromptSubmit hook: before a prompt re-writes a large session whose
// prompt cache expired, holds it once and shows the cost of continuing and of
// a fresh start. Fails open. See lib/cold-resume.mjs.
import { runHook } from './lib/hook-io.mjs';
import { handleUserPromptSubmit } from './lib/cold-resume.mjs';

runHook('UserPromptSubmit', (input) => handleUserPromptSubmit(input), { redact: true });
