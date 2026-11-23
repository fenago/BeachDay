---
name: claude-code-agent-authoring
description: How to write and maintain Claude Code project subagents (.claude/agents/*.md) and skills (.claude/skills/<name>/SKILL.md) for Beach Day, including the custom personality field the Agent Console reads. Use when creating, editing, reviewing or parsing agent and skill files.
---
# Authoring agents and skills

Sources:
- https://code.claude.com/docs/en/sub-agents
- https://code.claude.com/docs/en/skills

## Subagent file — `.claude/agents/<name>.md`
```markdown
---
name: kebab-name            # required, unique, no ":" or leading "-"
description: When to delegate to this agent. Keep it short; add "Use proactively" to encourage delegation.
tools: Read, Grep, Glob, Edit, Write, Bash   # allowlist; omit = inherit all
disallowedTools: Agent      # experts must not delegate (hub-and-spoke)
model: sonnet               # sonnet | opus | haiku | fable | full ID | inherit
color: cyan                 # red blue green yellow purple orange pink cyan
skills:                     # full SKILL.md content injected at startup (first 32)
  - beach-day-context
personality: One line the Agent Console shows.   # custom field (Claude Code ignores it)
---
System prompt in Markdown (the body). The agent sees only this prompt, the preloaded skills and basic environment details. It does NOT see the main Claude Code system prompt or the parent conversation.
```

**Required fields.** Only `name` and `description` are required.
- A file is skipped if either is missing, if the YAML is invalid, or if `---` is not on line 1.
- Unknown fields are silently ignored. That is why `personality` is safe, and also why a typo like `skill:` fails silently. Check with `claude --debug`.

**Other useful fields.** `effort`, `maxTurns`, `memory` (`user`/`project`/`local`), `background`, `isolation: worktree`, `permissionMode`, `mcpServers`, `hooks`.

**Restricting which agents an agent may spawn.** Use `tools: Agent(agent-a, agent-b), Read`.
- Nesting is allowed up to 3 layers below the main conversation.
- Run an agent as the main session with `claude --agent <name>` or `"agent": "<name>"` in settings.

## Skill file — `.claude/skills/<skill-name>/SKILL.md`
```markdown
---
name: skill-name            # lowercase-hyphen; defaults to the folder name
description: What it does and when to use it (listing truncates description+when_to_use at 1,536 chars).
---
Instructions / reference. Keep under 500 lines; put detail in sibling files and link them: [reference.md](reference.md).
```
- **Optional fields:** `when_to_use`, `allowed-tools`, `disallowed-tools`, `disable-model-invocation`, `user-invocable`, `model`, `effort`, `context: fork` + `agent`, `paths`, `metadata`.
- **Preloading.** A subagent's `skills:` list injects each skill's **full** content. Keep shared skills tight, because every agent that preloads a skill pays for its tokens.
- **Unlisted skills** can still be invoked with the Skill tool.

## Beach Day conventions
- **Agent names** match `docs/expert-roster.md` exactly. A skill name in `skills:` must match its folder name exactly.
- **Every agent** preloads `beach-day-context` and `change-proposal-protocol`.
- **`model` aliases** map to API IDs for the Agent Console (docs/05 §3):
  - `opus` / `inherit` / missing → `claude-opus-5-5`
  - `sonnet` → `claude-sonnet-5-5`
  - `haiku` → `claude-haiku-5-5`
  - `fable` → `claude-fable-5-2`
- **`personality`** is one line in plain language, using they/them for personas. The Console falls back to `description` if it is missing.
- **System prompt structure:** role → responsibilities → how you work → boundaries → handoff. Keep it short, because the skills carry the how-to.
- **When you change an agent or skill,** keep the roster doc, the agent file and `CLAUDE.md` consistent in the same change.
