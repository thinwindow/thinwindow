# Resume experiment (#32)

Task A is done, then task B arrives on a cold cache. Which completes B as
reliably and more cheaply? Raw rows: `resume-2026-10-04.jsonl`, one line per
A run and per B arm. Script: `bench/experiments/resume.mjs`. Regenerate the
tables below with
`node bench/experiments/resume.mjs --analyze bench/results/experiments/resume-2026-10-04.jsonl`.

## Design

- **Chains:** commander.js @ `ba6d13d`. Chain 1: `commander-ci-config` →
  `commander-rename-display-width`. Chain 2: `commander-rename-display-width`
  → `commander-extract-utils`. Chain 3: `commander-extract-utils` →
  `commander-rename-display-width`.
- **Scale:** Sonnet 5.5, 2 repetitions: 6 A runs and 18 B runs, plus one
  `/compact` call per compact arm.
- **Arms**, each from the same A, with the repo restored to A's end state
  (`git checkout -- . && git clean -fd && git apply A.diff`). Their order
  rotates across chains and repetitions.
  - **continue:** `--resume <A> --fork-session`, then B.
  - **compact:** `--resume <A> --fork-session` with `/compact`, then
    `--resume <compacted>` with B.
  - **brief:** a fresh session whose prompt is the brief, then B.
- **Settings:** the benchmark's baseline settings, without ThinWindow:
  sandbox, no user settings, no MCP servers, `--max-turns 40`. The one
  difference is that sessions are kept, so B can resume A.
- **Checks:** after B, both B's and A's hidden checks run. With the
  reference solutions applied in sequence, both pass in all three chains
  (`--check-solutions`).

## Cost definitions

- **Warm:** what the B phase cost as run, from Claude Code's
  `total_cost_usd`. The compact arm adds its `/compact` call.
- **Cold penalty:** the first request of the resume event's cache reads ×
  (1-hour cache write − cache read), at Sonnet 5.5's $4 and $0.2 per million
  tokens. Nobody waits an hour.
  - The same rule applies to all three arms, so the brief arm also pays for
    its prefix.
  - For the compact arm, the first request is the `/compact` call. Its cache
    reads are capped at A's last context, because `/compact` can make more
    than one request and a cold cache re-writes at most that context.
- **Cold:** warm + cold penalty.
- **Cost at the resume event**, in the G2 criteria: the whole cold B phase.
  The cold penalty alone is also shown.
- **Re-reads:** files B read that A had already read. This is the rework
  signal.

## The brief format (#33 reuses it)

Built from A's transcript without calling a model, at most 1,200 characters
(~300 tokens). It is followed by a blank line, `New request:` and B's prompt.

```
Brief of an earlier session in this repository, for reference only: check it against `git status` and the files before relying on it.
Goal: <first prompt, ≤ 200 chars>
Recent requests: <up to 3 later prompts, ≤ 80 chars each, " | "> or none
Files edited: <paths relative to the repo, up to 8, then "+N more"> or none
Commands: <last 4 Bash commands, ≤ 70 chars, "`cmd` → exit N", "; "> or none
Last message: <the last assistant text, truncated to fit>
```

Exit codes come from the tool result: 0 when the call succeeded, otherwise
the "Exit code N" in its output, or 1.

## Results

Claude Code 2.1.289 · claude-sonnet-5-5 · effort default · profile default · darwin 22.6.0 · ThinWindow commit 1a25e7d (not loaded: baseline)

| Chain | Rep | A | A check | Arm | B check | A check after | Turns | Warm | Cold penalty | Cold | Re-reads |
| ---: | ---: | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 1 | $0.055 | pass | continue | pass | pass | 3 | $0.039 | $0.071 | $0.110 | 0 |
| 1 | 1 | $0.055 | pass | compact | pass | pass | 3 | $0.075 | $0.072 | $0.147 | 0 |
| 1 | 1 | $0.055 | pass | brief | pass | pass | 3 | $0.052 | $0.039 | $0.091 | 0 |
| 1 | 2 | $0.056 | pass | continue | pass | pass | 3 | $0.039 | $0.072 | $0.110 | 0 |
| 1 | 2 | $0.056 | pass | compact | pass | pass | 3 | $0.079 | $0.073 | $0.152 | 0 |
| 1 | 2 | $0.056 | pass | brief | pass | pass | 3 | $0.050 | $0.039 | $0.089 | 0 |
| 2 | 1 | $0.054 | pass | continue | pass | pass | 7 | $0.074 | $0.070 | $0.144 | 0 |
| 2 | 1 | $0.054 | pass | compact | pass | pass | 8 | $0.121 | $0.071 | $0.192 | 0 |
| 2 | 1 | $0.054 | pass | brief | pass | pass | 5 | $0.074 | $0.039 | $0.113 | 0 |
| 2 | 2 | $0.054 | pass | continue | pass | pass | 9 | $0.094 | $0.070 | $0.164 | 0 |
| 2 | 2 | $0.054 | pass | compact | pass | pass | 5 | $0.105 | $0.071 | $0.176 | 0 |
| 2 | 2 | $0.054 | pass | brief | pass | pass | 12 | $0.135 | $0.039 | $0.174 | 0 |
| 3 | 1 | $0.083 | pass | continue | pass | pass | 4 | $0.054 | $0.081 | $0.135 | 0 |
| 3 | 1 | $0.083 | pass | compact | pass | pass | 4 | $0.094 | $0.081 | $0.175 | 0 |
| 3 | 1 | $0.083 | pass | brief | pass | pass | 4 | $0.058 | $0.039 | $0.097 | 0 |
| 3 | 2 | $0.097 | pass | continue | pass | pass | 4 | $0.056 | $0.084 | $0.139 | 0 |
| 3 | 2 | $0.097 | pass | compact | pass | pass | 5 | $0.116 | $0.085 | $0.201 | 0 |
| 3 | 2 | $0.097 | pass | brief | pass | pass | 5 | $0.067 | $0.039 | $0.106 | 0 |

| Chain | Arm | Both checks | Warm total | Cold total | Median turns | Re-reads |
| ---: | --- | ---: | ---: | ---: | ---: | ---: |
| 1 | continue | 2/2 | $0.077 | $0.220 | 3 | 0 |
| 1 | compact | 2/2 | $0.154 | $0.299 | 3 | 0 |
| 1 | brief | 2/2 | $0.102 | $0.180 | 3 | 0 |
| 2 | continue | 2/2 | $0.168 | $0.308 | 8 | 0 |
| 2 | compact | 2/2 | $0.226 | $0.368 | 6.5 | 0 |
| 2 | brief | 2/2 | $0.209 | $0.287 | 8.5 | 0 |
| 3 | continue | 2/2 | $0.109 | $0.274 | 4 | 0 |
| 3 | compact | 2/2 | $0.210 | $0.376 | 4.5 | 0 |
| 3 | brief | 2/2 | $0.125 | $0.203 | 4.5 | 0 |

| Overall | Both checks | B check | A check after | Warm total | Cold total | First-request cold penalty | Median turns | Re-reads |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| continue | 6/6 | 6/6 | 6/6 | $0.355 | $0.802 | $0.447 | 4 | 0 |
| compact | 6/6 | 6/6 | 6/6 | $0.591 | $1.044 | $0.453 | 4.5 | 0 |
| brief | 6/6 | 6/6 | 6/6 | $0.436 | $0.670 | $0.234 | 4.5 | 0 |

Brief vs continue, cold, whole B phase: 16.5% less. Compact vs brief, cold: 55.7% apart.
G2: No outcome matched: the brief keeps success but saves between 10% and 25%.

## Reading the result

- **FACT. G2: no outcome matched.**
  - Success is equal: every arm passed both checks in 6 of 6 runs.
  - Cold, the brief arm cost 16.5% less than continuing over the whole B
    phase. That is above the 10% "stop" line and below the 25% "go" line
    written before running. Counting only the agent's visible requests (no
    reported overhead), it is 18.3%: the same gap.
  - The criteria don't decide this case. Nothing was re-run or re-defined to
    move it.
- **FACT. Warm, the brief arm costs more:** $0.436 against $0.355 for
  continuing. It writes a fresh context while a warm resume reads one. It
  only wins when the cache has expired.
- **FACT. Compact cost the most here:** cold, $1.044 against $0.670 for the
  brief. The `/compact` call itself, its own cost, was $0.023–0.030 per run,
  and B then rebuilt context on top. At these context sizes compaction
  doesn't pay. Compact is not "enough".
- **FACT. Rework wasn't observed, but it was barely testable.**
  - Median B turns: brief 4.5, continue 4.
  - The re-read signal had nothing to measure: the A runs made 0–1 `Read`
    calls (they used `grep` and `sed`), so no arm re-read A's files.
- **FACT. The chains are small.**
  - A's context beyond the fixed prefix was ~8–12k tokens. Continuing paid a
    cold penalty of $0.070–0.084 per run; the brief arm's prefix alone (10.3k
    tokens) paid $0.039.
  - The gap between the two penalties grows with the context. At the
    maintainer's median cold-resume context (380k tokens, #30), continuing
    would re-write ~$1.44 at Sonnet 5.5 prices, against ~$0.04 for the brief.
  - **HYPOTHESIS:** that the net saving at real sizes clears 25%. Rework on
    a large session is what this experiment couldn't measure.
- **FACT, for #33.** "Files edited" came out empty in every brief: the
  agents edited with `sed` through Bash, not with Edit or Write. A brief
  built only from Edit and Write calls misses those files. #33 should take
  them from `git status` (the Stop hook knows the working directory).
- **FACT, for #37 and every later measurement.** For a resumed session,
  Claude Code's `total_cost_usd` (and `modelUsage`) includes what the session
  had already cost.
  - Here, a resumed B's reported cost minus A's reported cost matched B's own
    requests, with the same small gap fresh runs show.
  - The analysis subtracts it. The first version of this script didn't. The
    derived `warmUsd` and `coldUsd` were removed from the raw rows, and every
    cost in the tables above is computed from the raw `invocations`.

## Spend

- **Own cost:** $1.78 at list price (A runs $0.40, B phases $1.38).
  - The run's log said $3.13, because it added up the carried costs; its
    `--max-cost` guard did the same, so it was stricter than intended.
  - A Haiku 4.5 probe of `--resume`, `--fork-session` and `/compact` in
    `-p` cost $0.13 before the run.
- **Profile:** Claude Code 2.1.289 with the default profile (the account in
  use). It's run with `--setting-sources project,local` and
  `--strict-mcp-config`, so no user settings, plugins or MCP servers load.
  Account-level skills still load, the same in every arm.
