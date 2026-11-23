# Subagent file format and every frontmatter field

Source: https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields (read as https://code.claude.com/docs/en/sub-agents.md)
Retrieved: 2026-11-23

## File shape

```markdown
---
name: code-reviewer
description: Reviews code for quality and best practices
tools: Read, Glob, Grep
model: sonnet
---

You are a code reviewer. ...
```

- YAML frontmatter between `---` markers, then the system prompt as Markdown. "Only `name` and `description` are required."
- "The body becomes the system prompt ... Subagents receive this system prompt plus basic environment details like the working directory, not the Claude Code system prompt."
- Multi-word field names use **camelCase** (`maxTurns`, `disallowedTools`) and "must match the table exactly: Claude Code ignores a field it doesn't recognize without reporting an error."
- Find typos with `claude --debug`, then search the debug log for `does not recognize or apply`. The log names up to five unrecognized top-level fields and suggests the likely intended name (v2.1.296+).

## Field table

All rows are paraphrased from the official table ([sub-agents#supported-frontmatter-fields](https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields)).

| Field | Req. | Values / rules |
|---|---|---|
| `name` | **Yes** | Unique ID, ≤256 chars, such as `code-reviewer`. Cannot contain `:` (reserved for plugin scope like `my-plugin:reviewer`). The filename does not have to match. Hooks receive it as `agent_type` |
| `description` | **Yes** | When Claude should delegate to this agent |
| `tools` | No | Comma-separated string or YAML list. Omitted = inherit every tool available to subagents. If nothing resolves, the agent "usually fails to launch". To preload skills, use `skills`, "rather than listing `Skill` here" |
| `disallowedTools` | No | Same format; removed from the inherited or listed pool. A specifier such as `Bash(git push *)` still removes the **whole** tool |
| `model` | No | `sonnet`, `opus`, `haiku`, `fable`, a full ID such as `claude-opus-5-5`, or `inherit`. Omitted: see the model order below |
| `permissionMode` | No | `default` (alias `manual`), `acceptEdits`, `auto`, `dontAsk`, `bypassPermissions`, `plan`. Ignored for plugin agents |
| `maxTurns` | No | Maximum agentic turns; output is then marked partial and can be resumed (partial marking v2.1.246+) |
| `autoCompactWindow` | No | Token count ≥ `100000`, written as a plain integer (`200k` is read as 200). v2.1.296+ |
| `skills` | No | Skills to **preload**: the full content is injected at startup, up to the first **32** distinct names. Other skills are still available through the Skill tool |
| `mcpServers` | No | Server-name strings, or inline server configs (`stdio`, `http`, `sse`, `ws`). Ignored for plugin agents |
| `hooks` | No | Lifecycle hooks scoped to this agent. Ignored for plugin agents |
| `memory` | No | `user`, `project` or `local`: a persistent memory directory |
| `background` | No | `true` keeps the agent in the background even when Claude asks to wait |
| `omitClaudeMd` | No | `true` starts without the user, project and local CLAUDE.md files. Ignored under `--agent`. v2.1.271+ |
| `effort` | No | `low`, `medium`, `high`, `xhigh`, `max` (depends on the model). `CLAUDE_CODE_EFFORT_LEVEL` overrides it |
| `isolation` | No | `worktree`: a temporary git worktree branched from the default branch, cleaned up if unchanged |
| `color` | No | `red`, `blue`, `green`, `yellow`, `purple`, `orange`, `pink`, `cyan` |
| `initialPrompt` | No | First user turn, auto-submitted when run as the main session (`--agent` or `agent` setting) |
| `experimental` | No | Map. Only key: `cacheTtl: 5m` or `1h` (inside `experimental`, not top level). v2.1.248+ |

The docs also mention a `prompt` field as an alternative to the Markdown body for some definition sources: "Custom subagents define theirs in the markdown body or `prompt` field" ([sub-agents#what-loads-at-startup](https://code.claude.com/docs/en/sub-agents#what-loads-at-startup)). Whether `prompt` is honoured in a `.md` file's frontmatter is **[UNVERIFIED]**; it is clearly used for `--agents` JSON. Use the body.

## Model resolution order

1. The per-invocation `model` on the Agent call (alias only).
2. The `model` field (including `inherit`).
3. `CLAUDE_CODE_SUBAGENT_MODEL`.
4. The main conversation's model (or the spawning subagent's model for nested agents).

A family alias such as `opus` runs the **parent's version** when the parent is in the same family. To pin a version, use a full ID. ([sub-agents#choose-a-model](https://code.claude.com/docs/en/sub-agents#choose-a-model))

## Restricting which agents can be spawned

`tools: Agent(worker, researcher), Read, Bash` is an allowlist of spawnable types, **but** "The `Agent(agent_type)` allowlist syntax applies only to an agent running as the main thread with `claude --agent`. In a subagent definition ... any type list inside the parentheses is ignored." ([sub-agents#restrict-which-subagents-can-be-spawned](https://code.claude.com/docs/en/sub-agents#restrict-which-subagents-can-be-spawned)). `Task(...)` is an alias from before v2.1.63.

## Scopes and priority

| Location | Scope | Priority |
|---|---|---|
| Managed settings | Organization | 1 (highest) |
| `--agents` CLI JSON | Session | 2 |
| `.claude/agents/` | Project | 3 |
| `~/.claude/agents/` | User | 4 |
| Plugin `agents/` | Where enabled | 5 |

- Directories are scanned **recursively**; identity comes "only from the `name` frontmatter field", not the path.
- Nested project `.claude/agents/` directories between the working directory and the repo root are all scanned; the closest definition wins on a name clash. ([sub-agents#choose-the-subagent-scope](https://code.claude.com/docs/en/sub-agents#choose-the-subagent-scope))

## Beach Day notes

- **Required by Claude Code:** `name`, `description`. **Required by us** (`claude-code-agent-authoring` skill): also `tools`, `model`, `color`, `skills` (always including `beach-day-context` and `change-proposal-protocol`), `personality`, and `disallowedTools: Agent` on every expert.
- **`personality` is a custom field.** Claude Code silently ignores unknown fields, which is why it's safe, and why a typo like `skill:` or `disallowedtools:` (wrong case) also fails silently. The linter in `examples/02-agent-skill-linter/` flags unknown keys and close misspellings.
- **Name = filename** is our convention (the Agent Console's `agents.json` build and the orchestrator's `Agent(...)` list assume it), even though Claude Code doesn't require it.
- **Skills cap:** our largest preload list (agent-console-engineer) has 12 skills, well under 32. Each preloaded skill costs tokens on every spawn, so keep skills lean.
- **Model aliases → API IDs for the Console:** `opus` → `claude-opus-5-5`, `sonnet` → `claude-sonnet-5-5`, `haiku` → `claude-haiku-5-5`, `fable` → `claude-fable-5-2` (from the authoring skill / docs/05). Inside Claude Code, an alias may resolve to the parent session's version instead (see above).
- **Don't add `memory:` casually.** It auto-enables Read/Write/Edit (see doc 04), which would widen a read-only reviewer.
- Never give an expert `Agent` in `tools`. Keep `disallowedTools: Agent` even when `tools` is an allowlist without `Agent`; it is a belt-and-braces signal the linter can check.
