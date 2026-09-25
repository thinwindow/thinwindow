# thinwindow benchmark

## claude-haiku-4-5

Model `claude-haiku-4-5` (requested as `haiku`) · Claude Code 2.1.282 · thinwindow 0.1.0 (05cc89d), 0.1.0 (a6ebe93) · 32 runs, up to 2 per task and condition · 2026-09-25

| Task | Tokens baseline (min–max) | Tokens thinwindow (min–max) | Δ tokens | Cost baseline | Cost thinwindow | Δ cost | Turns baseline | Turns thinwindow | Success baseline | Success thinwindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | 1.51M (1.41M–1.62M) | 1.15M (1.05M–1.26M) | −23.7% | $0.28 | $0.21 | −26.6% | 37 | 32.5 | 2/2 | 2/2 |
| click-footer-year | 259k (187k–331k) | 209k (197k–221k) | −19.5% | $0.06 | $0.06 | −8.3% | 9 | 7.5 | 2/2 | 2/2 |
| click-help-spec | 1.84M (1.67M–2.00M) | 1.63M (1.23M–2.02M) | −11.4% | $0.32 | $0.29 | −8.3% | 41 | 38 | 2/2 | 2/2 |
| commander-ci-config | 129k (96k–162k) | 142k (120k–165k) | +10.3% | $0.04 | $0.05 | +6.2% | 5 | 5 | 2/2 | 2/2 |
| commander-command-clash | 1.80M (1.49M–2.11M) | 1.65M (1.48M–1.82M) | −8.3% | $0.33 | $0.30 | −10.2% | 41 | 41 | 1/2 | 1/2 |
| commander-extract-utils | 1.29M (1.09M–1.48M) | 662k (581k–743k) | −48.6% | $0.27 | $0.15 | −45.0% | 20 | 18 | 2/2 | 2/2 |
| commander-negate-default-order | 1.96M (1.82M–2.10M) | 1.78M (1.45M–2.10M) | −9.3% | $0.37 | $0.34 | −9.8% | 39.5 | 37.5 | 2/2 | 2/2 |
| commander-rename-display-width | 2.31M (2.26M–2.37M) | 1.32M (724k–1.92M) | −42.9% | $0.39 | $0.27 | −31.2% | 38 | 41 | 1/2 | 0/2 |
| **Total** | **11.10M** | **8.54M** | **−23.0%** | **$2.06** | **$1.65** | **−20.2%** | 230.5 | 220.5 | **14/16** | **13/16** |

Tokens are input + cache-creation + cache-read + output, summed over every model the run used. Per task: medians over all runs, failures included; min–max in parentheses. Total: sum of the per-task medians over the 8 tasks that have both conditions; success counts every run. Δ = (thinwindow − baseline) / baseline. Cost is Claude Code's own estimate (`total_cost_usd`), not a bill. Turns is Claude Code's `num_turns`: the top-level agent loop only. A run that delegates to a subagent (the Agent tool) can show few top-level turns while doing much more work inside it; Tokens and Cost already include that subagent work (via `modelUsage`), so they stay the fair comparison — Turns does not. The thinwindow rules and thresholds were tuned on these same tasks.

## claude-opus-5-5

Model `claude-opus-5-5` (requested as `opus`) · Claude Code 2.1.282 · thinwindow 0.1.0 (a6ebe93) · 32 runs, up to 2 per task and condition · 2026-09-25

| Task | Tokens baseline (min–max) | Tokens thinwindow (min–max) | Δ tokens | Cost baseline | Cost thinwindow | Δ cost | Turns baseline | Turns thinwindow | Success baseline | Success thinwindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | 320k (301k–339k) | 278k (261k–294k) | −13.2% | $0.36 | $0.24 | −33.6% | 12.5 | 11.5 | 2/2 | 2/2 |
| click-footer-year | 119k (119k–119k) | 136k (121k–151k) | +14.1% | $0.13 | $0.13 | +3.9% | 4.5 | 5.5 | 2/2 | 2/2 |
| click-help-spec | 444k (412k–475k) | 266k (230k–302k) | −40.1% | $0.34 | $0.25 | −27.2% | 16 | 13 | 2/2 | 2/2 |
| commander-ci-config | 92k (92k–92k) | 107k (91k–123k) | +17.0% | $0.13 | $0.12 | −0.9% | 3 | 3.5 | 2/2 | 2/2 |
| commander-command-clash | 284k (281k–286k) | 275k (273k–278k) | −3.0% | $0.32 | $0.28 | −10.2% | 13 | 10.5 | 2/2 | 2/2 |
| commander-extract-utils | 385k (331k–439k) | 258k (223k–292k) | −33.1% | $0.28 | $0.20 | −27.6% | 13.5 | 8 | 2/2 | 2/2 |
| commander-negate-default-order | 334k (314k–354k) | 340k (301k–379k) | +1.8% | $0.38 | $0.30 | −19.7% | 11 | 12 | 2/2 | 2/2 |
| commander-rename-display-width | 122k (122k–122k) | 107k (92k–123k) | −11.9% | $0.14 | $0.13 | −6.0% | 4 | 3.5 | 2/2 | 2/2 |
| **Total** | **2.10M** | **1.77M** | **−15.8%** | **$2.06** | **$1.66** | **−19.4%** | 77.5 | 67.5 | **16/16** | **16/16** |

Tokens are input + cache-creation + cache-read + output, summed over every model the run used. Per task: medians over all runs, failures included; min–max in parentheses. Total: sum of the per-task medians over the 8 tasks that have both conditions; success counts every run. Δ = (thinwindow − baseline) / baseline. Cost is Claude Code's own estimate (`total_cost_usd`), not a bill. Turns is Claude Code's `num_turns`: the top-level agent loop only. A run that delegates to a subagent (the Agent tool) can show few top-level turns while doing much more work inside it; Tokens and Cost already include that subagent work (via `modelUsage`), so they stay the fair comparison — Turns does not. The thinwindow rules and thresholds were tuned on these same tasks.

## claude-sonnet-5

Model `claude-sonnet-5` (requested as `sonnet`) · Claude Code 2.1.282 · thinwindow 0.1.0 (528598a) · 48 runs, up to 3 per task and condition · 2026-09-25

| Task | Tokens baseline (min–max) | Tokens thinwindow (min–max) | Δ tokens | Cost baseline | Cost thinwindow | Δ cost | Turns baseline | Turns thinwindow | Success baseline | Success thinwindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | 203k (149k–265k) | 194k (142k–233k) | −4.7% | $0.15 | $0.13 | −13.0% | 10 | 12 | 3/3 | 3/3 |
| click-footer-year | 73k (72k–73k) | 73k (72k–74k) | +0.4% | $0.06 | $0.06 | −1.6% | 4 | 4 | 3/3 | 3/3 |
| click-help-spec | 186k (163k–232k) | 83k (80k–107k) | −55.3% | $0.14 | $0.09 | −35.5% | 8 | 5 | 3/3 | 3/3 |
| commander-ci-config | 75k (75k–75k) | 97k (77k–97k) | +29.3% | $0.06 | $0.07 | +12.2% | 4 | 5 | 3/3 | 3/3 |
| commander-command-clash | 180k (159k–220k) | 137k (130k–204k) | −23.8% | $0.16 | $0.15 | −4.0% | 10 | 9 | 3/3 | 3/3 |
| commander-extract-utils | 141k (80k–167k) | 189k (164k–266k) | +33.9% | $0.10 | $0.12 | +15.3% | 9 | 12 | 3/3 | 3/3 |
| commander-negate-default-order | 258k (203k–327k) | 205k (151k–278k) | −20.3% | $0.17 | $0.15 | −8.5% | 13 | 12 | 3/3 | 3/3 |
| commander-rename-display-width | 74k (55k–75k) | 74k (55k–76k) | −0.3% | $0.06 | $0.06 | −1.0% | 4 | 4 | 3/3 | 3/3 |
| **Total** | **1.19M** | **1.05M** | **−11.6%** | **$0.91** | **$0.84** | **−7.4%** | 62 | 63 | **24/24** | **24/24** |

Tokens are input + cache-creation + cache-read + output, summed over every model the run used. Per task: medians over all runs, failures included; min–max in parentheses. Total: sum of the per-task medians over the 8 tasks that have both conditions; success counts every run. Δ = (thinwindow − baseline) / baseline. Cost is Claude Code's own estimate (`total_cost_usd`), not a bill. Turns is Claude Code's `num_turns`: the top-level agent loop only. A run that delegates to a subagent (the Agent tool) can show few top-level turns while doing much more work inside it; Tokens and Cost already include that subagent work (via `modelUsage`), so they stay the fair comparison — Turns does not. The thinwindow rules and thresholds were tuned on these same tasks.
