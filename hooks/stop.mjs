#!/usr/bin/env node
// Stop hook: keeps this session's brief for /thinwindow:resume, then shows the
// user the setup-cost notice when one is due. Each part fails open on its own.
// See lib/brief.mjs and lib/setup-notice.mjs.
import { debug, errorDetail, runHook } from './lib/hook-io.mjs';
import { handleStop } from './lib/brief.mjs';
import { handleSetupNotice } from './lib/setup-notice.mjs';

runHook(
  'Stop',
  (input) => {
    try {
      handleStop(input);
    } catch (err) {
      debug(`Stop: brief error: ${errorDetail(err, true)}`);
    }
    return handleSetupNotice(input);
  },
  { redact: true },
);
