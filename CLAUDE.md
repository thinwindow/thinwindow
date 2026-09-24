# thinwindow

Makes coding agents read less. `docs/SPEC.md` is the source of truth — read it before any work.

## Conventions

- Node >= 18, ESM, zero runtime dependencies. Tests: `node --test`.
- Conventional Commits in English (`feat(hooks): …`). No Co-Authored-By trailer or any Claude attribution.
- Hooks fail open: a thinwindow error must never block a tool call.
- `rules/thinwindow.md` stays within the token budget in the spec (CI enforces it).
- Numbers in docs come only from `bench/` results.
- Practice what we preach: grep before reading, read ranges, cap command output.
