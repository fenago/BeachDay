# Agent teams vs subagents

Source: https://code.claude.com/docs/en/agent-teams (read as https://code.claude.com/docs/en/agent-teams.md) ; https://code.claude.com/docs/en/sub-agents#subagent-names
Retrieved: 2026-11-23

## What agent teams are

- "Agent teams let you coordinate multiple Claude Code instances working together. One session acts as the team lead ... Teammates work independently, each in its own context window, and communicate directly with each other." ([agent-teams](https://code.claude.com/docs/en/agent-teams))
- **Experimental and off by default.** Enable with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` (shell or a settings `env` block). There are "known limitations around session resumption, task coordination, and shutdown behavior."
- Teammates spawn only in **interactive** sessions. With `-p` or the Agent SDK, a named subagent runs as an ordinary subagent even when teams are enabled.

## Comparison (from the docs' table)

| | Subagents | Agent teams |
|---|---|---|
| Context | Own window; results return to the caller | Own window; fully independent |
| Communication | Return a result to the caller (named subagents can also message each other) | Teammates message each other directly |
| Coordination | Main agent manages all work | Shared task list + messages |
| Best for | "Focused tasks where only the result matters" | "Complex work requiring discussion and collaboration" |
| Token cost | Lower: results summarized back | Higher: each teammate is a separate Claude instance |

Agent teams "add coordination overhead and use significantly more tokens". "For sequential tasks, same-file edits, or work with many dependencies, a single session or subagents are more effective." ([agent-teams#when-to-use-agent-teams](https://code.claude.com/docs/en/agent-teams#when-to-use-agent-teams))

## Side effect of enabling teams on ordinary delegation

- With teams enabled, "a subagent that Claude names launches as a teammate". Claude may name subagents on its own, "so teams can form even when you didn't ask for one". ([agent-teams#enable-agent-teams](https://code.claude.com/docs/en/agent-teams#enable-agent-teams))
- Turn it back off with `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=0`. A user settings value of `0` overrides a shell export, but project, local or managed settings can still set `1`.

## How a subagent definition applies to a teammate

When a teammate is spawned "using the <name> agent type" ([agent-teams#use-subagent-definitions-for-teammates](https://code.claude.com/docs/en/agent-teams#use-subagent-definitions-for-teammates)):

| Definition field | Applied to teammate? |
|---|---|
| `tools` | Yes. In-process teammates also get `SendMessage` and the Task tools added |
| `model` | Yes, unless the spawn prompt names a model |
| `disallowedTools` | In-process teammates only; `SendMessage` and the Task tools stay available |
| Body | In-process: **appended** to the default system prompt. Split-pane: **replaces** it |
| `skills` | **No**, in either display mode. "The teammate loads skills from your project and user settings." |
| `mcpServers` | Split-pane only |

## Team mechanics worth knowing

- Shared task list states: pending, in progress, completed; tasks can depend on other tasks and show as blocked. Claiming uses file locking.
- Mailboxes: `~/.claude/teams/{team-name}/inboxes/{agent-name}.json`. Team config: `~/.claude/teams/{team-name}/config.json`, removed at session end; don't hand-edit it. A project file like `.claude/teams/teams.json` "is not recognized as configuration".
- Quality-gate hooks: `TeammateIdle`, `TaskCreated` and `TaskCompleted`. Exit code 2 blocks the action and sends feedback. ([agent-teams#enforce-quality-gates-with-hooks](https://code.claude.com/docs/en/agent-teams#enforce-quality-gates-with-hooks))
- A message from a teammate is marked as coming from another Claude session. "A teammate can't approve a permission prompt or supply consent on your behalf."
- Limitations: no `/resume` of in-process teammates, one team per session, **no nested teams**, the lead is fixed, no per-teammate permission mode at spawn.

## Sizing advice from the docs

- "Start with 3-5 teammates for most workflows." "Three focused teammates often outperform five scattered ones."
- "Having 5-6 tasks per teammate keeps everyone productive."
- Give enough context in the spawn prompt; teammates "don't inherit the lead's conversation history".
- "Avoid file conflicts": two teammates editing the same file leads to overwrites, so give each teammate its own set of files.

## Beach Day notes

- **Stay on subagents, not agent teams.** Our design is hub-and-spoke: experts never talk to each other, and the orchestrator routes every HANDOFF (`team-protocol`). Agent teams are the opposite model, with direct teammate messaging.
- **Teams would silently drop our preloaded skills.** Every expert depends on `skills:` (for example `beach-day-context`, `change-proposal-protocol`), and teammates ignore that field. Do not set `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in project settings. If someone has it on globally, named subagents may launch as teammates; set it to `0` in user settings.
- The docs' sizing advice still applies to our fan-out: 3–4 parallel experts per wave, each owning **different files**. For example, open-meteo-integrator owns `public/js/api/` and `score.js`, while Wren owns `docs/design/` copy and flow specs. This avoids same-file edits between parallel tasks.
- The "Wait for your teammates" failure mode has a subagent equivalent: the orchestrator must not start implementing a task itself while an expert is still running it.
