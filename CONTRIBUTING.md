# Contributing to skinflint

Thanks for helping agents read less. `docs/SPEC.md` is the source of truth
for what skinflint is and isn't; read it before larger changes.

## Setup

Node.js 18 or newer. There are no dependencies to install.

```sh
node --test              # unit and end-to-end hook tests
node scripts/check.mjs   # manifests, task files, SKILL.md frontmatter, rules budget
```

To try your checkout in Claude Code, run `claude --plugin-dir .` and follow
`docs/manual-testing.md`.

## Layout

| Path | What |
| --- | --- |
| `rules/skinflint.md` | The rules. Single source of truth, injected at session start. |
| `skills/skinflint/` | The Agent Skill: the rules plus `skinflint-run` (`scripts/skinflint-run.mjs`). |
| `adapters/AGENTS.md` | The rules as a snippet for agents that read AGENTS.md. |
| `.claude-plugin/` | Plugin manifest and marketplace catalog. |
| `hooks/` | `hooks.json` and the Node hook scripts; logic in `hooks/lib/`. |
| `bin/skinflint-run` | Put on the Bash tool's `PATH` by the plugin. |
| `scripts/` | Repository checks and the rules sync. |
| `bench/` | The benchmark: tasks, runner, report and raw results. |
| `test/` | `node --test` suites. |

## Rules of the house

- **A new rule, or a changed rule or threshold, must come with a benchmark
  delta.** Run the benchmark for the baseline and for skinflint with your
  change, on the same model and tasks, and paste the report table in the PR
  (see `bench/README.md`). Savings that cost success rate don't count.
  ```sh
  node bench/run.mjs --condition baseline,skinflint --reps 2 --model sonnet --dry-run
  node bench/run.mjs --condition baseline,skinflint --reps 2 --model sonnet --max-cost 20
  node bench/report.mjs
  ```
- `rules/skinflint.md` stays at or under ~500 tokens (2,000 characters); CI
  enforces it. After editing it, run `node scripts/sync-rules.mjs` so the
  copies in `SKILL.md` and `adapters/AGENTS.md` match.
- Every number in the docs comes from `bench/` results. No estimates,
  testimonials or star counts.
- Hooks fail open: any error must let the tool call proceed. Hooks never
  return `allow`; they only deny, rewrite, or stay silent.
- Zero runtime dependencies. Node 18+, ESM, macOS, Linux and Windows.
- No telemetry, no network calls.
- Practice what we preach: grep before reading, read ranges, cap command
  output.

## Commits and pull requests

- [Conventional Commits](https://www.conventionalcommits.org) in English:
  `feat(hooks): …`, `fix(run): …`, `docs: …`, `test: …`, `ci: …`.
- One topic per PR. Fill in the PR template checklist.
- Labels live in `.github/labels.json`. The Labels workflow creates or
  updates them on GitHub when that file changes on `main`; add a label there
  instead of in the GitHub UI.
- Agent adapters for other tools (label `adapter`) are welcome; link the
  agent's current hook docs and don't claim support that wasn't checked.

## Releases

Bump `version` in `.claude-plugin/plugin.json` and `package.json` together
and move the `Unreleased` notes in `CHANGELOG.md` under the new version.
Plugin users only receive an update when the manifest version changes.
