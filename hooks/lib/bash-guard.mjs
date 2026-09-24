// PreToolUse guard for the Bash tool.
// Bash input: { command, description?, timeout?, run_in_background? }
// https://code.claude.com/docs/en/hooks#bash
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, parse as parsePath, resolve } from 'node:path';
import { countLines, isBinary, isLockfile, isMinified } from './files.mjs';
import { displayPath, isAllowlistedPath } from './read-guard.mjs';
import { baseName, commandWords, parseShell } from './shell.mjs';
import { consumeDenied, recordDenied } from './state.mjs';

// Later pipeline stages that bound what reaches the agent.
const CAPPING = new Set(['head', 'tail', 'wc', 'grep', 'egrep', 'fgrep', 'rg', 'ag', 'sed', 'awk', 'jq', 'cut', 'uniq']);
const PRINTERS = new Set(['cat', 'bat', 'batcat', 'nl', 'less', 'more', 'tac']);
const QUIET = /^(-q+|--quiet|--silent|--reporter=(dot|dots|silent|min|summary)|--(log-?level)=(error|silent|quiet))$/;

function words(stage) {
  return commandWords(stage).words.map((w) => w.text);
}

function stdoutRedirected(stage) {
  return stage.redirects.some((r) => {
    if (r.op === '&>' || r.op === '&>>') return true;
    if ((r.op === '>' || r.op === '>>') && (r.fd === null || r.fd === '1')) return true;
    // `>& file` (not `>&2`) sends stdout and stderr to a file.
    if (r.op === '>&' && (r.fd === null || r.fd === '1') && r.target && !/^\d+$/.test(r.target)) return true;
    return false;
  });
}

// True when the pipeline's output can't flood the context: a later stage
// filters or truncates it, or stdout goes to a file.
export function pipelineCapped(p) {
  if (p.stages.slice(1).some((s) => CAPPING.has(baseName(words(s)[0] || '')))) return true;
  return stdoutRedirected(p.stages[p.stages.length - 1]);
}

function isDynamic(text) {
  return /[*?[$`~]/.test(text);
}

function findGitRoot(start) {
  let dir = start;
  for (let i = 0; i < 100; i++) {
    if (existsSync(join(dir, '.git'))) return dir;
    const up = dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
  return null;
}

function checkPrinter(argv, ctx) {
  for (const arg of argv.slice(1)) {
    if (arg === '-' || arg.startsWith('-') || isDynamic(arg)) continue;
    const path = resolve(ctx.cwd, arg);
    let st;
    try {
      st = statSync(path);
    } catch {
      continue;
    }
    if (!st.isFile() || isAllowlistedPath(path, ctx.config, ctx.projectDir)) continue;
    const shown = displayPath(path, ctx.projectDir);
    const cmd = argv[0];
    if (isLockfile(path)) {
      return `thinwindow: ${shown} is a lockfile; printing it floods the context. Query it instead: grep -n "<package>" ${shown} | head -n 20, or ask the package manager (npm ls <pkg>, pip show <pkg>, cargo tree -i <crate>).`;
    }
    if (isMinified(path)) {
      return `thinwindow: ${shown} is minified; ${cmd} would print it as a few huge lines. Read the unminified source, or grep -o a short pattern with context (grep -o ".\\{0,80\\}<text>.\\{0,80\\}" ${shown} | head).`;
    }
    if (isBinary(path)) {
      return `thinwindow: ${shown} is a binary file; ${cmd} would print noise. Use file ${shown}, or a tool that understands the format.`;
    }
    const lines = countLines(path);
    if (lines > ctx.config.maxReadLines) {
      const count = Number.isFinite(lines) ? `${lines} lines` : 'more than 64 MB';
      return `thinwindow: ${cmd} would print all ${count} of ${shown}. Grep for what you need (grep -n "<symbol>" ${shown}), then read that range (Read with offset/limit, or sed -n 'X,Yp' ${shown}).`;
    }
  }
  return null;
}

function checkGitLog(argv) {
  if (baseName(argv[0]) !== 'git') return null;
  let k = 1;
  while (k < argv.length && argv[k].startsWith('-')) {
    if (argv[k] === '-C' || argv[k] === '-c') k++;
    k++;
  }
  if (argv[k] !== 'log') return null;
  const args = argv.slice(k + 1);
  for (let j = 0; j < args.length; j++) {
    const a = args[j];
    if (/^-n\d+$/.test(a) || /^-\d+$/.test(a) || /^--max-count=\d+$/.test(a)) return null;
    if ((a === '-n' || a === '--max-count') && /^\d+$/.test(args[j + 1] || '')) return null;
    if (/^--(since|after|until|before)(=|$)/.test(a)) return null;
    if (!a.startsWith('-') && a.includes('..')) return null;
  }
  return 'thinwindow: git log without -n prints the whole history. Use git log -n 10 --oneline, then git show --stat <sha> for the commits that matter.';
}

function checkListing(argv, ctx) {
  const name = baseName(argv[0]);
  if (name === 'ls' && argv.slice(1).some((a) => /^-[A-Za-z1]*R[A-Za-z1]*$/.test(a) || a === '--recursive')) {
    return 'thinwindow: ls -R lists the whole tree. List one directory at a time, use tree -L 2, or git ls-files | head -n 50 (or the Glob tool).';
  }
  if (name === 'tree' && !argv.slice(1).some((a) => /^-L\d*$/.test(a))) {
    return 'thinwindow: tree without -L walks the whole tree. Use tree -L 2 (add -I node_modules), or git ls-files | head -n 50.';
  }
  if (name === 'find') {
    const rest = argv.slice(1);
    if (rest.includes('-maxdepth')) return null;
    const paths = [];
    for (const a of rest) {
      if (a.startsWith('-') || a === '(' || a === '!') break;
      paths.push(a);
    }
    if (paths.length === 0) paths.push('.');
    if (paths.some((p) => isRootish(p, ctx))) {
      return 'thinwindow: find from the repo root without -maxdepth walks every directory (node_modules, .git, build output). Add -maxdepth 3, search a subdirectory, or use git ls-files | grep <pattern> (or the Glob tool).';
    }
  }
  return null;
}

function isRootish(p, ctx) {
  const home = ctx.home || homedir();
  let expanded = p;
  if (p === '~' || p.startsWith('~/')) expanded = join(home, p.slice(1));
  else if (/^\$(HOME|\{HOME\})(\/|$)/.test(p)) expanded = join(home, p.replace(/^\$\{?HOME\}?/, ''));
  else if (/^(\$PWD|\$\{PWD\}|\$\(pwd\)|`pwd`)(\/|$)/.test(p)) expanded = ctx.cwd;
  else if (isDynamic(p)) return false;
  const abs = resolve(ctx.cwd, expanded);
  if (abs === parsePath(abs).root || abs === home) return true;
  const root = findGitRoot(ctx.cwd) || ctx.projectDir;
  return abs === root;
}

function isQuiet(argv) {
  for (let j = 0; j < argv.length; j++) {
    if (QUIET.test(argv[j])) return true;
    if (/^--(log-?level|reporter)$/.test(argv[j]) && /^(error|silent|quiet|dot|dots|min)$/.test(argv[j + 1] || '')) return true;
  }
  return false;
}

// Finds uncapped noisy commands. Returns [{ pipeline, stage, cmd, cmdStart, wrappers }].
function findNoisy(parsed, ctx) {
  const hits = [];
  for (const p of parsed.pipelines) {
    if (p.background || pipelineCapped(p)) continue;
    const stage = p.stages[0];
    const { words: cw, wrappers } = commandWords(stage);
    if (cw.length === 0) continue;
    const argv = cw.map((w) => w.text);
    if (baseName(argv[0]) === 'thinwindow-run' || isQuiet(argv)) continue;
    const cmd = argv.join(' ');
    if (ctx.config.noisyPatterns.some((re) => re.test(cmd))) {
      const text = ctx.source.slice(cw[0].start, stage.end).trim();
      hits.push({ pipeline: p, cmd, text, cmdStart: cw[0].start, wrappers });
    }
  }
  return hits;
}

// Decides one Bash call. Mutates `state` for soft blocks.
// Returns { action: 'allow' | 'deny' | 'rewrite', kind, reason?, command? }.
export function checkBash({ input, config, state, projectDir, now = Date.now(), home }) {
  const ti = input.tool_input || {};
  const command = ti.command;
  if (typeof command !== 'string' || command.trim() === '') return { action: 'allow', kind: 'no-command' };
  if (config.allowCommandPatterns.some((re) => re.test(command))) return { action: 'allow', kind: 'allowlist' };

  const parsed = parseShell(command);
  if (!parsed.ok) return { action: 'allow', kind: 'unparsed' };
  const ctx = { cwd: input.cwd || projectDir || process.cwd(), projectDir, config, home, source: command };

  // Clear anti-patterns: deny and suggest a replacement.
  for (const p of parsed.pipelines) {
    const first = words(p.stages[0]);
    if (p.stages.length === 1 && first[0] === 'cd' && first.length === 2 && !isDynamic(first[1]) && first[1] !== '-') {
      // Follow `cd dir && ...` so relative paths resolve where they will run.
      ctx.cwd = resolve(ctx.cwd, first[1]);
      continue;
    }
    if (pipelineCapped(p)) continue;
    for (const stage of p.stages) {
      const argv = words(stage);
      if (argv.length === 0) continue;
      const reason =
        (PRINTERS.has(baseName(argv[0])) && checkPrinter(argv, ctx)) || checkGitLog(argv) || checkListing(argv, ctx);
      if (reason) return { action: 'deny', kind: 'anti-pattern', reason };
    }
  }

  // Noisy commands that aren't capped: soft block, or rewrite if enabled.
  if (ti.run_in_background === true) return { action: 'allow', kind: 'background' };
  const noisy = findNoisy(parsed, ctx);
  if (noisy.length === 0) return { action: 'allow', kind: 'ok' };

  if (config.rewrite && noisy.every((h) => !h.wrappers.includes('sudo') && !h.wrappers.includes('doas'))) {
    let rewritten = command;
    for (const h of [...noisy].sort((a, b) => b.cmdStart - a.cmdStart)) {
      rewritten = `${rewritten.slice(0, h.cmdStart)}thinwindow-run ${rewritten.slice(h.cmdStart)}`;
    }
    return { action: 'rewrite', kind: 'noisy', command: rewritten, cmds: noisy.map((h) => h.cmd) };
  }

  const key = `bash\u0000${input.agent_id || 'main'}\u0000${command}`;
  if (consumeDenied(state, key)) return { action: 'allow', kind: 'retry' };
  recordDenied(state, key, now);
  const first = noisy[0].text;
  return {
    action: 'deny',
    kind: 'noisy',
    reason:
      `thinwindow: \`${first}\` can print thousands of lines. Run it as \`thinwindow-run ${first}\` instead: ` +
      'the full log goes to a temp file and you get the exit code, the last 40 lines and the error lines. ' +
      'Or cap it yourself (quiet flag, or | tail -n 40). To run it uncapped anyway, repeat the exact same command.',
  };
}
