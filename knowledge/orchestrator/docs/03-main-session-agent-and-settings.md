# Running the orchestrator as the main session (`--agent`, `agent` setting)

Source: https://code.claude.com/docs/en/sub-agents#invoke-subagents-explicitly ; https://code.claude.com/docs/en/settings ; https://code.claude.com/docs/en/settings-reference#agent
Retrieved: 2026-11-23

## Three ways to invoke a subagent

From the docs ([sub-agents#invoke-subagents-explicitly](https://code.claude.com/docs/en/sub-agents#invoke-subagents-explicitly)), in order of strength:

1. **Natural language**: name the agent ("Use the orchestrator subagent to ..."). Claude decides whether to delegate.
2. **@-mention**: `@"orchestrator (agent)" plan the 7-day view`, or type `@agent-orchestrator`. This runs that agent for one task. Claude still writes the task prompt from your message.
3. **Session-wide**: `claude --agent orchestrator`, or `"agent": "orchestrator"` in a settings file.

## What `--agent` changes

- "Pass `--agent <name>` to start a session where the main thread itself takes on that subagent's tool restrictions and model."
- "Unless the agent's prompt is empty, a custom subagent's system prompt replaces the default Claude Code system prompt entirely, the same way `--system-prompt` does."
- CLAUDE.md files and project memory "still load through the normal message flow", even if the agent sets `omitClaudeMd`.
- With `-p` and an agent that has its own prompt, the session starts without the git-status snapshot.
- The startup header shows `@<name>`, so you can confirm the agent is active.
- The choice persists on resume: tool restrictions and model are restored. If the agent file no longer exists, the session continues with default tools and shows a warning.
- Frontmatter `initialPrompt` is auto-submitted as the first user turn only when the agent runs as the main session. ([sub-agents#supported-frontmatter-fields](https://code.claude.com/docs/en/sub-agents#supported-frontmatter-fields))
- Frontmatter `hooks` and inline `mcpServers` also apply when the agent is the main session. Hooks from a project agent file run only after the folder's workspace trust dialog is accepted.
- `omitClaudeMd` and `autoCompactWindow` have no effect when the agent is the main session.

## The `agent` settings key

From [settings-reference#agent](https://code.claude.com/docs/en/settings-reference#agent):

- "Run the main thread as a named subagent, so Claude Code applies that subagent's system prompt, tool restrictions, and model to your session."
- **Scope:** any settings file. **Type:** string (name of a built-in or custom agent). **Default:** unset.
- **Per-session override:** `--agent` takes precedence over this key for one session.

```json
{ "agent": "orchestrator" }
```

## Which settings file to use

Settings files and who they affect ([settings](https://code.claude.com/docs/en/settings#settings-files-and-who-they-affect)):

| Scope | File | Affects |
|---|---|---|
| User | `~/.claude/settings.json` | You, every project on this machine |
| Shared project | `.claude/settings.json` | Everyone using the repo, once committed |
| Project local | `.claude/settings.local.json` | Only you, in this project (kept out of git) |
| Managed | `managed-settings.json` / MDM / server-managed | Everyone the org deploys it to |

Precedence, highest first: "managed settings, command line, project local, shared project, user." List keys such as `permissions.allow` **merge** across files instead of overriding. An `env` block in a settings file is an ordinary key and follows this order. ([settings#settings-precedence](https://code.claude.com/docs/en/settings#settings-precedence))

## Environment variables the orchestrator may meet

All are set through a settings `env` block or the shell (sources: [sub-agents](https://code.claude.com/docs/en/sub-agents)):

| Variable | Effect |
|---|---|
| `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH` | Nesting layers below main (default 3; `1` = no nesting) |
| `CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS` | Running-subagent cap (default 20) |
| `CLAUDE_CODE_SUBAGENT_MODEL` / `..._FORCE` | Default or forced model for subagents |
| `CLAUDE_CODE_FORK_SUBAGENT` | `0` turns fork mode off so Claude can wait for a subagent |
| `CLAUDE_CODE_DISABLE_BACKGROUND_TASKS` | `1` makes Claude wait for subagents; disables background tasks |
| `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` | `1` enables agent teams (see doc 04) |

## Beach Day notes

- **Recommended start:** `claude --agent orchestrator`, as CLAUDE.md says. This is the only setup where the orchestrator's `Agent(...)` allowlist is enforced (doc 02). It also replaces the default Claude Code system prompt with the orchestrator's body, so the body must be self-sufficient: role, plan → delegate → route → gate → report.
- **Do not commit `"agent": "orchestrator"` to `.claude/settings.json`** without Dr. Lee's approval. It would make every session in the repo (including quick questions and other people's sessions) run as the orchestrator. If Dr. Lee wants it for himself, put it in `.claude/settings.local.json` or `~/.claude/settings.json`.
- Any change to `.claude/settings.json` is a `.claude/**` change: agent-builder + orchestrator review (`change-proposal-protocol`). It is not on the Agent Console allow-list (only `.claude/agents/*.md` and `.claude/skills/**/*.md` are), so a human makes it outside the Console.
- The orchestrator has `memory: project`, so it also loads `.claude/agent-memory/orchestrator/MEMORY.md` (doc 05). Project memory and CLAUDE.md load even in `--agent` mode.
- If the orchestrator file is renamed, sessions resumed with the old `--agent` name fall back to default tools with a warning. Rename only together with CLAUDE.md, the roster and any settings that name it.
