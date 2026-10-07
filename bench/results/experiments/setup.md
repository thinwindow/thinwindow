# Setup-cost probe (#35, G3)

Claude Code 2.1.289 · claude-haiku-4-5 · profile 31ed8b6007aa · darwin 22.6.0 · one `claude -p "Reply with OK."` per variant, in an empty folder, no ThinWindow (except the agent variants' throwaway plugin).
First request = input + cache read + cache write tokens of the first API request. Tokens per request only: cache reads are cheap, so this is not a cost claim.

Parts are JSON characters / 4 of the attachments written before the first request, as in `/thinwindow:report`; the system prompt is the transcript's `prompt_snapshot` copy of it.

| Variant | First request | Cut | Tools | system prompt | skill listing | deferred tools | MCP instructions | CLAUDE.md files | agent listing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| defaults | 19.7k | 0.0% | 28 | 7.1k | 1.7k | 0.2k | - | - | 0.5k |
| no-skills | 17.5k | 10.9% | 27 | 7.1k | - | 0.2k | - | - | 0.5k |
| minimal-tools | 12.5k | 36.6% | 9 | 6.9k | - | 0.1k | - | - | - |
| both | 12.5k | 36.6% | 9 | 6.9k | - | 0.1k | - | - | - |
| agent | 12.5k | 36.6% | 9 | 6.9k | - | 0.1k | - | - | - |
| agent-skill | 12.5k | 36.2% | 9 | 6.9k | - | 0.1k | - | - | - |

minimal-tools removes: Agent, Artifact, AskUserQuestion, CronCreate, CronDelete, CronList, DesignSync, EnterPlanMode, EnterWorktree, ExitWorktree, ListAgents, Monitor, NotebookEdit, PushNotification, RemoteTrigger, ReportFindings, ScheduleWakeup, SendFeedback, SendMessage, SendUserFile, Skill, Task, TaskGet, TaskList, TaskOutput, TaskStop.
agent-skill: the typed skill command ran without the Skill tool.

G3: go: ship the opt-in minimal-tools agent (minimal-tools cuts at least 20%).
Spent: US$0.059 at list price, from token usage.
