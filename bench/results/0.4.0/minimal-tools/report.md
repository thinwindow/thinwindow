# thinwindow benchmark

## claude-sonnet-5-5

Model `claude-sonnet-5-5` · Claude Code 2.1.290 · thinwindow 0.4.0-dev (8b8f813) · 8 runs, up to 1 per task and condition · 2026-10-06

| Task | Tokens baseline (min–max) | Tokens thinwindow (min–max) | Δ tokens | Cost baseline | Cost thinwindow | Δ cost | Turns baseline | Turns thinwindow | Success baseline | Success thinwindow |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| click-choice-brackets | – (–) | 34k (34k–34k) | – | – | $0.05 | – | – | 3 | – | 1/1 |
| click-footer-year | – (–) | 51k (51k–51k) | – | – | $0.05 | – | – | 6 | – | 1/1 |
| click-help-spec | – (–) | 45k (45k–45k) | – | – | $0.06 | – | – | 4 | – | 1/1 |
| commander-ci-config | – (–) | 45k (45k–45k) | – | – | $0.05 | – | – | 4 | – | 1/1 |
| commander-command-clash | – (–) | 80k (80k–80k) | – | – | $0.11 | – | – | 10 | – | 1/1 |
| commander-extract-utils | – (–) | 97k (97k–97k) | – | – | $0.07 | – | – | 8 | – | 1/1 |
| commander-negate-default-order | – (–) | 193k (193k–193k) | – | – | $0.15 | – | – | 17 | – | 1/1 |
| commander-rename-display-width | – (–) | 31k (31k–31k) | – | – | $0.04 | – | – | 3 | – | 1/1 |
| **Total** | **0** | **0** | **–** | **$0.00** | **$0.00** | **–** | 0 | 0 | **–** | **8/8** |

Cost per completed task: n/a.
Total tokens – (95% interval n/a; –); cost – (95% interval n/a; –).
Environment: Claude Code 2.1.290 · effort default · profile .claude-bench-flow · account b510dde27433 · 5 tools (919f748cbb69) · 17 skills (a87c2b9c97c9) + 4 ThinWindow · 5 agents · --disallowedTools Agent,Artifact,AskUserQuestion,CronCreate,CronDelete,CronList,DesignSync,EnterPlanMode,EnterWorktree,ExitWorktree,ListAgents,Monitor,NotebookEdit,PushNotification,RemoteTrigger,ReportFindings,ScheduleWakeup,SendFeedback,SendMessage,SendUserFile,Skill,Task,TaskGet,TaskList,TaskOutput,TaskStop.
First request (median): baseline –, thinwindow 9.7k tokens · cold first requests: baseline 0/0, thinwindow 0/8.

Tokens are input + cache-creation + cache-read + output, summed over every model the run used. Per task: medians over all runs, failures included; min–max in parentheses. Total: sum of the per-task medians over the 0 tasks that have both conditions; success counts every run. Δ = (thinwindow − baseline) / baseline. Cost is Claude Code's own estimate (`total_cost_usd`), not a bill. Turns is Claude Code's `num_turns`: the top-level agent loop only. A run that delegates to a subagent (the Agent tool) can show few top-level turns while doing much more work inside it; Tokens and Cost already include that subagent work (via `modelUsage`), so they stay the fair comparison — Turns does not. The thinwindow rules and thresholds were tuned on these same tasks. Intervals (0.4.0 method, #37): a seeded 95% bootstrap that resamples tasks, then runs within each task and condition. The smallest detectable effect is 2.8 × the bootstrap standard error (a 5% two-sided test with 80% power): a true change smaller than it is likely to go unseen. Cost per completed task: everything a condition's runs cost, failures included, over the runs that passed.
