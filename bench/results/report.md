# thinwindow benchmark

## claude-haiku-4-5

Model `claude-haiku-4-5` (requested as `haiku`) · Claude Code 2.1.287 · thinwindow 0.3.0 (6546385) · 32 runs, up to 2 per task and condition · 2026-10-02

| Task | Tokens baseline (min–max) | Tokens thinwindow (min–max) | Δ tokens | Cost baseline | Cost thinwindow | Δ cost | Turns baseline | Turns thinwindow | Success baseline | Success thinwindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | 1.49M (1.39M–1.58M) | 1.35M (1.35M–1.35M) | −9.3% | $0.27 | $0.25 | −9.1% | 41 | 40.5 | 2/2 | 2/2 |
| click-footer-year | 155k (141k–169k) | 210k (119k–300k) | +35.0% | $0.05 | $0.06 | +23.8% | 6.5 | 8.5 | 2/2 | 2/2 |
| click-help-spec | 1.32M (1.21M–1.44M) | 1.44M (1.40M–1.48M) | +9.0% | $0.26 | $0.27 | +3.3% | 34 | 39.5 | 2/2 | 2/2 |
| commander-ci-config | 96k (96k–96k) | 97k (97k–98k) | +1.3% | $0.04 | $0.04 | +1.6% | 5 | 5 | 2/2 | 2/2 |
| commander-command-clash | 1.69M (1.62M–1.75M) | 1.40M (1.28M–1.52M) | −17.0% | $0.33 | $0.28 | −14.8% | 41 | 38.5 | 0/2 | 0/2 |
| commander-extract-utils | 827k (677k–976k) | 416k (413k–419k) | −49.7% | $0.21 | $0.11 | −49.0% | 14.5 | 14.5 | 2/2 | 2/2 |
| commander-negate-default-order | 1.50M (1.34M–1.67M) | 1.56M (1.50M–1.62M) | +4.0% | $0.31 | $0.32 | +4.4% | 36.5 | 38 | 2/2 | 2/2 |
| commander-rename-display-width | 1.13M (941k–1.33M) | 1.46M (1.35M–1.58M) | +29.1% | $0.25 | $0.26 | +4.2% | 34 | 41 | 0/2 | 0/2 |
| **Total** | **8.21M** | **7.94M** | **−3.3%** | **$1.71** | **$1.58** | **−7.7%** | 212.5 | 225.5 | **12/16** | **12/16** |

Total tokens −3.3% (95% CI −19.1% to +12.2%); cost −7.7% (95% CI −21.8% to +3.5%).

Tokens are input + cache-creation + cache-read + output, summed over every model the run used. Per task: medians over all runs, failures included; min–max in parentheses. Total: sum of the per-task medians over the 8 tasks that have both conditions; success counts every run. Δ = (thinwindow − baseline) / baseline. Cost is Claude Code's own estimate (`total_cost_usd`), not a bill. Turns is Claude Code's `num_turns`: the top-level agent loop only. A run that delegates to a subagent (the Agent tool) can show few top-level turns while doing much more work inside it; Tokens and Cost already include that subagent work (via `modelUsage`), so they stay the fair comparison — Turns does not. The thinwindow rules and thresholds were tuned on these same tasks.

## claude-opus-5-5

Model `claude-opus-5-5` · Claude Code 2.1.287 · thinwindow 0.3.0 (6546385) · 48 runs, up to 3 per task and condition · 2026-10-02

| Task | Tokens baseline (min–max) | Tokens thinwindow (min–max) | Δ tokens | Cost baseline | Cost thinwindow | Δ cost | Turns baseline | Turns thinwindow | Success baseline | Success thinwindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | 304k (282k–307k) | 370k (343k–395k) | +21.7% | $0.27 | $0.28 | +3.7% | 11 | 14 | 3/3 | 3/3 |
| click-footer-year | 123k (91k–186k) | 123k (73k–185k) | +0.1% | $0.13 | $0.13 | −3.7% | 5 | 4 | 3/3 | 3/3 |
| click-help-spec | 412k (356k–451k) | 384k (275k–456k) | −7.0% | $0.33 | $0.29 | −11.7% | 15 | 14 | 3/3 | 3/3 |
| commander-ci-config | 93k (56k–124k) | 94k (56k–126k) | +0.6% | $0.12 | $0.12 | −2.2% | 3 | 3 | 3/3 | 3/3 |
| commander-command-clash | 330k (289k–382k) | 239k (239k–291k) | −27.4% | $0.36 | $0.30 | −16.2% | 13 | 9 | 3/3 | 3/3 |
| commander-extract-utils | 241k (234k–299k) | 267k (262k–307k) | +10.9% | $0.25 | $0.23 | −6.0% | 10 | 13 | 3/3 | 3/3 |
| commander-negate-default-order | 457k (380k–490k) | 423k (269k–501k) | −7.5% | $0.45 | $0.35 | −22.3% | 14 | 15 | 3/3 | 3/3 |
| commander-rename-display-width | 124k (74k–124k) | 125k (76k–125k) | +0.5% | $0.14 | $0.13 | −5.5% | 4 | 4 | 3/3 | 3/3 |
| **Total** | **2.08M** | **2.02M** | **−2.9%** | **$2.05** | **$1.84** | **−10.5%** | 75 | 76 | **24/24** | **24/24** |

Total tokens −2.9% (95% CI −13.3% to +9.3%); cost −10.5% (95% CI −16.5% to −3.0%).

Tokens are input + cache-creation + cache-read + output, summed over every model the run used. Per task: medians over all runs, failures included; min–max in parentheses. Total: sum of the per-task medians over the 8 tasks that have both conditions; success counts every run. Δ = (thinwindow − baseline) / baseline. Cost is Claude Code's own estimate (`total_cost_usd`), not a bill. Turns is Claude Code's `num_turns`: the top-level agent loop only. A run that delegates to a subagent (the Agent tool) can show few top-level turns while doing much more work inside it; Tokens and Cost already include that subagent work (via `modelUsage`), so they stay the fair comparison — Turns does not. The thinwindow rules and thresholds were tuned on these same tasks.

## claude-sonnet-5-5

Model `claude-sonnet-5-5` · Claude Code 2.1.287 · thinwindow 0.3.0 (6546385) · 48 runs, up to 3 per task and condition · 2026-10-02

| Task | Tokens baseline (min–max) | Tokens thinwindow (min–max) | Δ tokens | Cost baseline | Cost thinwindow | Δ cost | Turns baseline | Turns thinwindow | Success baseline | Success thinwindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | 189k (102k–268k) | 127k (97k–226k) | −33.1% | $0.14 | $0.09 | −37.3% | 6 | 6 | 3/3 | 3/3 |
| click-footer-year | 120k (90k–149k) | 153k (74k–215k) | +28.0% | $0.07 | $0.08 | +16.7% | 5 | 6 | 3/3 | 3/3 |
| click-help-spec | 241k (150k–283k) | 129k (83k–268k) | −46.4% | $0.14 | $0.10 | −28.0% | 12 | 5 | 3/3 | 3/3 |
| commander-ci-config | 124k (75k–156k) | 126k (77k–127k) | +2.1% | $0.08 | $0.08 | +2.2% | 4 | 4 | 3/3 | 3/3 |
| commander-command-clash | 208k (125k–239k) | 242k (174k–271k) | +16.7% | $0.16 | $0.16 | −2.4% | 9 | 11 | 3/3 | 3/3 |
| commander-extract-utils | 156k (96k–156k) | 193k (163k–298k) | +24.1% | $0.09 | $0.11 | +17.5% | 6 | 8 | 3/3 | 3/3 |
| commander-negate-default-order | 204k (199k–299k) | 235k (171k–273k) | +15.1% | $0.14 | $0.15 | +4.6% | 11 | 10 | 3/3 | 3/3 |
| commander-rename-display-width | 91k (55k–92k) | 93k (55k–125k) | +1.8% | $0.07 | $0.07 | +2.0% | 3 | 3 | 3/3 | 3/3 |
| **Total** | **1.33M** | **1.30M** | **−2.6%** | **$0.88** | **$0.83** | **−6.5%** | 56 | 53 | **24/24** | **24/24** |

Total tokens −2.6% (95% CI −23.1% to +17.5%); cost −6.5% (95% CI −20.0% to +7.6%).

Tokens are input + cache-creation + cache-read + output, summed over every model the run used. Per task: medians over all runs, failures included; min–max in parentheses. Total: sum of the per-task medians over the 8 tasks that have both conditions; success counts every run. Δ = (thinwindow − baseline) / baseline. Cost is Claude Code's own estimate (`total_cost_usd`), not a bill. Turns is Claude Code's `num_turns`: the top-level agent loop only. A run that delegates to a subagent (the Agent tool) can show few top-level turns while doing much more work inside it; Tokens and Cost already include that subagent work (via `modelUsage`), so they stay the fair comparison — Turns does not. The thinwindow rules and thresholds were tuned on these same tasks.
