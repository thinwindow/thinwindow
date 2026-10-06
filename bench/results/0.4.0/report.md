# thinwindow benchmark

## claude-sonnet-5-5 (chains)

Model `claude-sonnet-5-5 (chains)` (requested as `claude-sonnet-5-5`) · Claude Code 2.1.290 · thinwindow 0.4.0-dev (8b8f813) · 18 runs, up to 3 per task and condition · 2026-10-06

| Task | Tokens baseline (min–max) | Tokens thinwindow (min–max) | Δ tokens | Cost baseline | Cost thinwindow | Δ cost | Turns baseline | Turns thinwindow | Success baseline | Success thinwindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| chain-1 (commander-ci-config → commander-rename-display-width) | 172k (153k–172k) | 133k (117k–137k) | −22.6% | $0.18 | $0.15 | −16.9% | 8 | 7 | 3/3 | 3/3 |
| chain-2 (commander-rename-display-width → commander-extract-utils) | 260k (204k–260k) | 197k (177k–225k) | −24.2% | $0.20 | $0.16 | −18.5% | 13 | 11 | 3/3 | 3/3 |
| chain-3 (commander-extract-utils → commander-rename-display-width) | 215k (195k–217k) | 175k (157k–316k) | −18.3% | $0.19 | $0.16 | −15.5% | 10 | 9 | 3/3 | 3/3 |
| **Total** | **647k** | **505k** | **−21.8%** | **$0.57** | **$0.48** | **−17.0%** | 31 | 27 | **9/9** | **9/9** |

Cost per completed chain: −13.3% (95% interval −17.3% to −6.5%; smallest detectable effect ±9.5%).
Total tokens −21.8% (95% interval −28.1% to +16.6%; ±46.6%); cost −17.0% (95% interval −18.7% to −4.8%; ±13.3%).
Environment: Claude Code 2.1.290 · effort default · profile .claude-bench-flow · account b510dde27433 · 22 tools (c213e06c5aea) · 17 skills (a87c2b9c97c9) + 4 ThinWindow · 5 agents.
First request (median): baseline 17k tokens, thinwindow 18k tokens · cold first requests: baseline 0/9, thinwindow 0/9.

Tokens are input + cache-creation + cache-read + output, summed over every model the run used. Per task: medians over all runs, failures included; min–max in parentheses. Total: sum of the per-task medians over the 3 tasks that have both conditions; success counts every run. Δ = (thinwindow − baseline) / baseline. Cost is Claude Code's own estimate (`total_cost_usd`), not a bill. Turns is Claude Code's `num_turns`: the top-level agent loop only. A run that delegates to a subagent (the Agent tool) can show few top-level turns while doing much more work inside it; Tokens and Cost already include that subagent work (via `modelUsage`), so they stay the fair comparison — Turns does not. The thinwindow rules and thresholds were tuned on these same tasks. Intervals (0.4.0 method, #37): a seeded 95% bootstrap that resamples tasks, then runs within each task and condition. The smallest detectable effect is 2.8 × the bootstrap standard error (a 5% two-sided test with 80% power): a true change smaller than it is likely to go unseen. Cost per completed task: everything a condition's runs cost, failures included, over the runs that passed. A chain run is task A, then task B in the same clone: the baseline continues A's session, thinwindow starts fresh with `/thinwindow:resume`. It completes when A passes, B passes and A still passes after B. Its cost is priced from token usage, with B's first request re-written at the 1-hour cache-write price, as after an expired cache.

## claude-sonnet-5-5

Model `claude-sonnet-5-5` · Claude Code 2.1.290 · thinwindow 0.4.0-dev (8b8f813) · 48 runs, up to 3 per task and condition · 2026-10-06

| Task | Tokens baseline (min–max) | Tokens thinwindow (min–max) | Δ tokens | Cost baseline | Cost thinwindow | Δ cost | Turns baseline | Turns thinwindow | Success baseline | Success thinwindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | 138k (98k–145k) | 78k (77k–96k) | −43.8% | $0.09 | $0.07 | −24.5% | 7 | 4 | 3/3 | 3/3 |
| click-footer-year | 91k (90k–111k) | 111k (92k–117k) | +22.8% | $0.07 | $0.07 | +9.7% | 6 | 7 | 3/3 | 3/3 |
| click-help-spec | 84k (84k–228k) | 80k (79k–82k) | −4.2% | $0.09 | $0.08 | −7.7% | 4 | 5 | 3/3 | 3/3 |
| commander-ci-config | 76k (76k–76k) | 78k (78k–79k) | +3.4% | $0.06 | $0.07 | +3.7% | 4 | 4 | 3/3 | 3/3 |
| commander-command-clash | 155k (153k–296k) | 136k (109k–196k) | −12.6% | $0.17 | $0.13 | −19.1% | 12 | 10 | 3/3 | 3/3 |
| commander-extract-utils | 142k (99k–159k) | 168k (122k–207k) | +18.5% | $0.10 | $0.10 | +4.6% | 8 | 9 | 3/3 | 3/3 |
| commander-negate-default-order | 146k (143k–200k) | 190k (150k–196k) | +29.6% | $0.13 | $0.13 | +2.5% | 8 | 10 | 3/3 | 3/3 |
| commander-rename-display-width | 56k (55k–56k) | 55k (55k–57k) | −0.9% | $0.06 | $0.05 | −7.0% | 3 | 3 | 3/3 | 3/3 |
| **Total** | **887k** | **896k** | **+1.0%** | **$0.76** | **$0.71** | **−6.5%** | 52 | 52 | **24/24** | **24/24** |

Cost per completed task: −9.5% (95% interval −20.5% to +3.1%; smallest detectable effect ±20.8%).
Total tokens +1.0% (95% interval −31.5% to +19.5%; ±49.7%); cost −6.5% (95% interval −22.1% to +5.1%; ±24.3%).
Environment: Claude Code 2.1.290 · effort default · profile .claude-bench-flow · account b510dde27433 · 22 tools (c213e06c5aea) · 17 skills (a87c2b9c97c9) + 4 ThinWindow · 5 agents.
First request (median): baseline 17k tokens, thinwindow 18k tokens · cold first requests: baseline 0/24, thinwindow 0/24.

Tokens are input + cache-creation + cache-read + output, summed over every model the run used. Per task: medians over all runs, failures included; min–max in parentheses. Total: sum of the per-task medians over the 8 tasks that have both conditions; success counts every run. Δ = (thinwindow − baseline) / baseline. Cost is Claude Code's own estimate (`total_cost_usd`), not a bill. Turns is Claude Code's `num_turns`: the top-level agent loop only. A run that delegates to a subagent (the Agent tool) can show few top-level turns while doing much more work inside it; Tokens and Cost already include that subagent work (via `modelUsage`), so they stay the fair comparison — Turns does not. The thinwindow rules and thresholds were tuned on these same tasks. Intervals (0.4.0 method, #37): a seeded 95% bootstrap that resamples tasks, then runs within each task and condition. The smallest detectable effect is 2.8 × the bootstrap standard error (a 5% two-sided test with 80% power): a true change smaller than it is likely to go unseen. Cost per completed task: everything a condition's runs cost, failures included, over the runs that passed.
