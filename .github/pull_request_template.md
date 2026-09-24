## What

<!-- One or two sentences. Link the issue if there is one. -->

## Why

## Checklist

- [ ] `node --test` passes
- [ ] `node scripts/check.mjs` passes (manifests, tasks, SKILL.md, rules budget)
- [ ] Commit messages follow Conventional Commits (`feat(hooks): …`)
- [ ] A change to `rules/skinflint.md` or to a hook threshold includes a benchmark delta from `bench/` (see CONTRIBUTING.md)
- [ ] Any number added to the docs comes from `bench/` results
- [ ] Hooks still fail open (an error allows the tool call)
