# Restricting tools, spawnable agents, nesting depth and models
Source: https://code.claude.com/docs/en/sub-agents (sections "Control subagent capabilities", "Let subagents spawn their own subagents", "Choose a model")
Retrieved: 2026-11-23

## `tools` and `disallowedTools`

- `tools` is an **allowlist**: a comma-separated string (`Read, Grep, Bash`) or a YAML list. If omitted, the subagent "inherits every tool available to subagents". ([sub-agents#supported-frontmatter-fields](https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields))
- `disallowedTools` is a **denylist**. "If both are set, `disallowedTools` is applied first, then `tools` is resolved against the remaining pool. A tool listed in both is removed." ([sub-agents#restrict-which-tools-a-subagent-can-use](https://code.claude.com/docs/en/sub-agents#restrict-which-tools-a-subagent-can-use))
- A `disallowedTools` entry with a specifier, such as `Bash(git push *)`, **removes the whole tool**. To block only some commands, use a `permissions.deny` rule in settings instead.
- If nothing in `tools` resolves to a real tool, Claude Code usually refuses to launch the subagent ("Agent would be spawned with zero tools").
- MCP entries: `mcp__github__*` in `tools` grants one server; `mcp__github` or `mcp__*` in `disallowedTools` withholds one or all servers.
- Tools that are always removed from subagents, even if listed: `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode` (unless `permissionMode: plan`), `EndConversation`, `ScheduleWakeup`, `Workflow` and a few others, plus `Agent` at the depth limit. ([sub-agents#available-tools](https://code.claude.com/docs/en/sub-agents#available-tools))

## `Agent(type, ...)`: restricting which agents can be spawned

Exact rule from the docs ([sub-agents#restrict-which-subagents-can-be-spawned](https://code.claude.com/docs/en/sub-agents#restrict-which-subagents-can-be-spawned)):

- "When an agent runs as the main thread with `claude --agent`, it can spawn subagents using the Agent tool. To restrict which subagent types it can spawn, use `Agent(agent_type)` syntax in the `tools` field."
- `tools: Agent(worker, researcher), Read, Bash` is an allowlist: "If the agent tries to spawn any other type, the request fails and the agent sees only the allowed types in its prompt."
- `tools: Agent, Read, Bash` (no parentheses) allows any type. Omitting `Agent` from `tools` means the agent cannot spawn subagents.
- **Important limitation:** "The `Agent(agent_type)` allowlist syntax applies only to an agent running as the main thread with `claude --agent`. In a subagent definition, listing `Agent` in `tools` lets that subagent spawn subagents of its own while the depth limit allows it, but any type list inside the parentheses is ignored."
- Version note: in Claude Code 2.1.63 the Task tool was renamed `Agent`; `Task(...)` still works as an alias.

To **block** specific agents everywhere, use a settings deny rule: `"permissions": {"deny": ["Agent(Explore)", "Agent(my-custom-agent)"]}`, or `claude --disallowedTools "Agent(Explore)"`. ([sub-agents#disable-specific-subagents](https://code.claude.com/docs/en/sub-agents#disable-specific-subagents))

## Nesting depth

- "By default, a subagent can spawn subagents of its own, up to three layers below the main conversation." At the limit, Claude Code withholds `Agent` from every subagent except a fork. ([sub-agents#let-subagents-spawn-their-own-subagents](https://code.claude.com/docs/en/sub-agents#let-subagents-spawn-their-own-subagents))
- Change the limit with `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` (e.g. `"2"` in a settings `env` block). `"1"` turns nesting off.
- "To keep one subagent from spawning while nesting is on, such as a reviewer that should stay read-only, omit `Agent` from its `tools` list or add it to `disallowedTools`."
- In an interactive session, a subagent that launches background subagents waits for their results before it finishes, so only the top-level summary returns to the user.

## Which model a subagent runs on

Resolution order, first match wins ([sub-agents#choose-a-model](https://code.claude.com/docs/en/sub-agents#choose-a-model)):

1. The per-invocation `model` parameter on the Agent call (an alias only: not a full ID, not `inherit`).
2. The agent file's `model` field (`sonnet`, `opus`, `haiku`, `fable`, a full ID such as `claude-opus-5-5`, or `inherit`).
3. `CLAUDE_CODE_SUBAGENT_MODEL`.
4. The main conversation's model (or, for a nested subagent, the spawning subagent's model).

Further rules:

- With a family alias such as `opus`, if the parent already runs that family, the subagent uses the **parent's version**. To pin a version, use the full model ID.
- `CLAUDE_CODE_SUBAGENT_MODEL` plus `CLAUDE_CODE_SUBAGENT_MODEL_FORCE=1` forces one model for every subagent and ignores `model` fields (v2.1.257+).
- Subagents inherit the main conversation's extended-thinking configuration; "There is no per-subagent thinking setting."
- `effort` in frontmatter sets the agent's effort level (`low`, `medium`, `high`, `xhigh`, `max`); `CLAUDE_CODE_EFFORT_LEVEL` overrides it. ([sub-agents#choose-an-effort-level](https://code.claude.com/docs/en/sub-agents#choose-an-effort-level))

## Permission modes

- `permissionMode` accepts `default` (alias `manual`), `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions` and `plan`.
- If the main conversation is in `bypassPermissions`, `acceptEdits` or auto mode, the subagent runs in that same mode and the field is ignored.
- If the main conversation is in `plan`, the subagent stays in plan mode. ([sub-agents#permission-modes](https://code.claude.com/docs/en/sub-agents#permission-modes))

## Beach Day notes

Our orchestrator frontmatter has:

```yaml
tools: Agent(agent-builder, software-architect, open-meteo-integrator, pwa-mobile-engineer, security-engineer, agent-console-engineer, supabase-auth-engineer, ui-designer-apple-liquid-glass, ux-designer-apple-hig, qa-engineer, netlify-engineer), Read, Grep, Glob, Bash, Edit, Write, WebFetch, WebSearch, Skill
```

and every expert has `disallowedTools: Agent`.

| How the orchestrator runs | Is the `Agent(...)` list enforced? | Depth used |
|---|---|---|
| `claude --agent orchestrator` (recommended in CLAUDE.md) | **Yes.** Only the 10 listed experts can be spawned | Main thread → experts at layer 1 |
| As a subagent from an ordinary session | **No.** The type list is ignored; `Agent` simply lets it spawn while depth allows | Main → orchestrator (1) → experts (2) |

- So the allowlist is a real guardrail only in the `--agent` setup. In the subagent setup, the hub-and-spoke shape is kept by the experts' `disallowedTools: Agent` (they can't delegate) and by the orchestrator's prompt.
- With the default depth of 3, both setups work. Do **not** set `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` in project settings: it would stop the orchestrator-as-subagent from reaching the experts.
- `Skill` in the orchestrator's `tools` lets it invoke skills on demand. Preloading is done by `skills:`, and the docs say to use that field "rather than listing `Skill` here" for preloading.
- `Bash(git push *)` cannot be used in `disallowedTools` to block only pushes, because it would remove all of Bash. Our "experts never commit" rule is a prompt rule plus the `change-proposal-protocol` skill. If it needs enforcement, add a `permissions.deny` rule or a hook (that is a settings change: agent-builder + orchestrator review, and Dr. Lee's approval).
- Model aliases: the experts use `opus`/`sonnet`. If the main session runs Opus, `model: opus` experts run on the same Opus version as the main session.
- Keep the `Agent(...)` list identical to the files in `.claude/agents/` (minus the orchestrator). The linter in `knowledge/agent-builder/examples/02-agent-skill-linter/` checks this.
