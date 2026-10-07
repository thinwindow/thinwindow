# Contributing to thinwindow

Thanks for helping agents read less. `docs/SPEC.md` is the source of truth
for what thinwindow is and isn't; read it before larger changes.

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
| `rules/thinwindow.md` | The rules. Single source of truth, injected at session start. |
| `skills/thinwindow/` | The Agent Skill: the rules plus `thinwindow-run` (`scripts/thinwindow-run.mjs`), which the plugin's Bash hook also runs. |
| `adapters/AGENTS.md` | The rules as a snippet for agents that read AGENTS.md. |
| `.claude-plugin/` | Plugin manifest and marketplace catalog. |
| `hooks/` | `hooks.json` and the Node hook scripts; logic in `hooks/lib/`. |
| `scripts/` | Repository checks and the rules sync. |
| `bench/` | The measurements: tasks, runner, report, experiments and raw results (see `bench/README.md`). |
| `test/` | `node --test` suites. |

## Rules of the house

- **A new rule, or a changed rule or threshold, comes with evidence,**
  following Measurement 2.0 in `bench/README.md`:
  - `node bench/compliance.mjs`, which shows how often the recorded runs
    followed each rule, at no model cost;
  - when the decision depends on how the model reacts, a few targeted runs,
    with what counts as a pass or a failure written in the issue before you
    run them.

  Changes that cost success rate don't count as savings.
  ```sh
  node bench/compliance.mjs
  node bench/run.mjs --condition baseline,thinwindow --reps 2 --model claude-sonnet-5-5 --dry-run
  ```
- `rules/thinwindow.md` stays at or under ~500 tokens (2,000 characters); CI
  enforces it. After editing it, run `node scripts/sync-rules.mjs` so the
  copies in `SKILL.md`, `adapters/AGENTS.md` and the site match.
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
- Titles say what is true once the change lands, in the present tense and as
  concretely as the change allows. A PR title is a Conventional Commit:
  `fix(hooks): short concatenations reach the agent whole`, not
  `fix(hooks): update the bash guard`. An issue title states the symptom as
  observed: `Eight task/model pairs still cost more with ThinWindow than
  without it`, not `Benchmark regressions`. Any number in a title or a body
  comes from `bench/`.
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
