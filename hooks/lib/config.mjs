// skinflint configuration: defaults, then ~/.skinflint.json, then
// .skinflint.json in the project root. SKINFLINT=off beats everything.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { debug } from './hook-io.mjs';

// Regular expressions, tested against one command of a Bash call after
// leading VAR=value assignments and wrappers (sudo, env, time, timeout...)
// are stripped and the words are joined by single spaces.
export const DEFAULT_NOISY_COMMANDS = [
  // JavaScript / TypeScript
  '^(npm|pnpm|bun) (install|i|ci|add|update|up|upgrade|rebuild)\\b',
  '^yarn( (install|add|upgrade)\\b.*)?$',
  '^(npm|pnpm|yarn|bun)( run)? (test|t|build|lint|typecheck|type-check|check|e2e|compile)\\b',
  '^(npx|bunx|pnpm (exec|dlx)|yarn (exec|dlx)) (jest|vitest|mocha|ava|tap|tsc|eslint|playwright|cypress|webpack|rollup|vite build|next build|nx|turbo)\\b',
  '^(jest|vitest|mocha|ava|tsc|eslint|webpack|rollup|turbo|nx)\\b',
  '^(node|deno|bun) (--test|test)\\b',
  // Python
  '^(pip3?|uv pip|pipx) install\\b',
  '^(poetry|pipenv|uv|pdm|hatch|conda|mamba) (install|sync|add|update|lock)\\b',
  '^(python[0-9.]*|py) -m (pip install|pytest|unittest|tox|nox|mypy|ruff|pylint|flake8|build)\\b',
  '^(pytest|tox|nox|mypy|pylint|flake8|ruff check)\\b',
  '^(uv|poetry|pdm|hatch|pipenv) run (pytest|tox|nox|mypy|pylint|flake8|ruff check|python -m pytest)\\b',
  // Other ecosystems
  '^cargo (build|test|check|clippy|install|bench|doc)\\b',
  '^go (build|test|vet|install|get|generate|mod (download|tidy))\\b',
  '^(\\./)?(gradlew|gradle|mvnw|mvn)\\b',
  '^dotnet (build|test|restore|publish)\\b',
  '^(bundle|bundler) (install|exec (rspec|rake))\\b',
  '^composer (install|update|require)\\b',
  '^(make|ninja|cmake --build|bazel (build|test)|swift (build|test)|xcodebuild|deno (test|lint|check))\\b',
  '^(docker|podman) (build|compose (build|up))\\b',
  '^(apt|apt-get|brew|dnf|yum) (install|upgrade|update)\\b',
];

export const DEFAULTS = Object.freeze({
  enabled: true,
  maxReadLines: 400,
  rewrite: false,
  noisyCommands: [],
  allowlist: Object.freeze({ paths: Object.freeze([]), commands: Object.freeze([]) }),
});

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (err && err.code !== 'ENOENT') debug(`config: ignoring ${path}: ${err.message}`);
    return null;
  }
}

function stringList(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === 'string' && v !== '') : [];
}

// Merges one parsed config object into `acc`, ignoring keys with the wrong
// type so a typo in a config file can't break the hooks.
function merge(acc, raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return acc;
  const out = { ...acc, allowlist: { ...acc.allowlist } };
  if (typeof raw.enabled === 'boolean') out.enabled = raw.enabled;
  if (typeof raw.rewrite === 'boolean') out.rewrite = raw.rewrite;
  if (Number.isInteger(raw.maxReadLines) && raw.maxReadLines > 0) out.maxReadLines = raw.maxReadLines;
  out.noisyCommands = [...acc.noisyCommands, ...stringList(raw.noisyCommands)];
  if (raw.allowlist && typeof raw.allowlist === 'object') {
    out.allowlist.paths = [...acc.allowlist.paths, ...stringList(raw.allowlist.paths)];
    out.allowlist.commands = [...acc.allowlist.commands, ...stringList(raw.allowlist.commands)];
  }
  return out;
}

export function isOffSwitch(env = process.env) {
  const v = String(env.SKINFLINT || '').toLowerCase();
  return v === 'off' || v === '0' || v === 'false' || v === 'disabled';
}

// projectDir: where .skinflint.json is looked up. Claude Code exports
// CLAUDE_PROJECT_DIR to hooks (https://code.claude.com/docs/en/hooks#reference-scripts-by-path).
export function loadConfig({ projectDir, env = process.env, home = homedir() } = {}) {
  let config = merge(DEFAULTS, {});
  if (home) config = merge(config, readJson(join(home, '.skinflint.json')));
  if (projectDir) config = merge(config, readJson(join(projectDir, '.skinflint.json')));
  if (isOffSwitch(env)) config.enabled = false;
  config.noisyPatterns = compilePatterns([...DEFAULT_NOISY_COMMANDS, ...config.noisyCommands]);
  config.allowCommandPatterns = compilePatterns(config.allowlist.commands);
  config.allowPathPatterns = config.allowlist.paths.map(globToRegExp);
  return config;
}

function compilePatterns(list) {
  const out = [];
  for (const src of list) {
    try {
      out.push(new RegExp(src));
    } catch (err) {
      debug(`config: ignoring invalid pattern ${JSON.stringify(src)}: ${err.message}`);
    }
  }
  return out;
}

// Minimal glob: `**` spans directories, `*` and `?` stay inside one segment.
// A pattern without a slash matches the file name at any depth.
export function globToRegExp(glob) {
  let g = glob.replace(/\\/g, '/');
  if (!g.includes('/')) g = `**/${g}`;
  let re = '';
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
