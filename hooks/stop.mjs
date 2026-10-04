#!/usr/bin/env node
// Stop hook: keeps this session's brief for /thinwindow:resume. Prints
// nothing. Fails open. See lib/brief.mjs.
import { runHook } from './lib/hook-io.mjs';
import { handleStop } from './lib/brief.mjs';

runHook('Stop', (input) => handleStop(input), { redact: true });
