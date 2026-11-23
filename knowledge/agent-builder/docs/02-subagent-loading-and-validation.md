# How agent files load, get skipped, and how to validate them

Source: https://code.claude.com/docs/en/sub-agents#subagent-files-claude-code-skips ; https://code.claude.com/docs/en/sub-agents#write-subagent-files ; https://code.claude.com/docs/en/sub-agents#what-loads-at-startup
Retrieved: 2026-11-23

## Files Claude Code skips

A file in a project, user or managed `agents` directory is skipped when ([sub-agents#subagent-files-claude-code-skips](https://code.claude.com/docs/en/sub-agents#subagent-files-claude-code-skips)):

| Problem | What happens |
|---|---|
| No `name` | Treated as documentation kept beside the agents (no error) |
| Opening `---` is not the **first line** | Read as having no frontmatter, treated as documentation |
| `name` starts with `-`, contains `:`, or is >256 chars | Skipped, error in debug log |
| `name` but no `description` | Skipped, reason in debug log |
| YAML doesn't parse | No fields read, skipped, parse error in debug log |

- Plugin agents differ: a plugin agent with no `name` or bad YAML still loads, under its filename.
- See skips with `claude --debug`.
- **Pre-session check:** `claude plugin validate .claude/agents` finds files whose frontmatter doesn't parse. It "doesn't flag a file whose frontmatter parses but has no `name`" and checks only the directory you name.

## Hot reload

- "Claude Code watches `~/.claude/agents/` and `.claude/agents/`." Edits are detected "within a few seconds and the next delegation uses the updated definition, with no restart needed."
- Exceptions: `.claude/agents/` inside `--add-dir` directories is not watched, and sessions started with `--disable-slash-commands` don't watch at all. ([sub-agents#write-subagent-files](https://code.claude.com/docs/en/sub-agents#write-subagent-files))

## Description budget

- When the combined `description` fields of custom subagents exceed **15,000 tokens**, Claude Code shows a startup warning with the total. Every subagent still loads.
- Fix: trim descriptions and move detail into the body, "which only loads when that subagent runs". ([sub-agents](https://code.claude.com/docs/en/sub-agents))

## What a subagent actually receives

- The body as system prompt, plus environment details. It does **not** get the Claude Code system prompt.
- The delegation message.
- CLAUDE.md files (unless `omitClaudeMd`).
- A git status snapshot.
- Full preloaded skills.
- A sibling roster, only when the agent has `SendMessage` and named siblings exist.

It does not get the caller's conversation, output style or auto memory. ([sub-agents#what-loads-at-startup](https://code.claude.com/docs/en/sub-agents#what-loads-at-startup))

Missing or disabled preloaded skills are skipped with a debug-log warning. Skills with `disable-model-invocation: true` **cannot be preloaded**. ([sub-agents#preload-skills-into-subagents](https://code.claude.com/docs/en/sub-agents#preload-skills-into-subagents))

## Tools a subagent never gets

These are filtered even when listed: `AskUserQuestion`, `EnterPlanMode`, `ExitPlanMode` (unless `permissionMode: plan`), `EndConversation`, `propose_skills`, `ScheduleWakeup`, `WaitForMcpServers`, `Workflow`, and `Agent` at the depth limit.

Background subagents (the default when spawned from the main conversation) keep only a core set: `Read`, `Grep`, `Glob`, `LSP`, `Bash`, `PowerShell`, `Edit`, `Write`, `NotebookEdit`, `WebFetch`, `WebSearch`, `TodoWrite`, `Skill`, `ToolSearch`, worktree tools, `Monitor`, `TaskStop`, `SendMessage`, `Artifact`, the list/search tools, all MCP tools, and `SubagentHandback`. ([sub-agents#available-tools](https://code.claude.com/docs/en/sub-agents#available-tools))

## Validation checklist (from the docs plus our conventions)

| Check | Why |
|---|---|
| `---` on line 1, closing `---` present | Otherwise the file is treated as docs and silently not loaded |
| YAML parses | Otherwise skipped |
| `name` present, no `:`, no leading `-`, ≤256 chars | Otherwise skipped |
| `description` present | Otherwise skipped |
| Field names exactly as documented (camelCase) | Unknown fields are ignored silently |
| `color` in the 8 allowed values | Documented set |
| `model` is an alias, a full ID, or `inherit` | Documented set |
| `skills` entries exist as `.claude/skills/<name>/SKILL.md`; ≤32 | Missing skills are skipped with only a debug warning |
| `tools` entries resolve to real tools | Zero resolved tools usually means launch fails |
| Combined descriptions ≪ 15k tokens | Startup warning |

`claude --debug` plus `claude plugin validate .claude/agents` are the official tools. Our linter (`examples/02-agent-skill-linter/`) covers the table offline and adds Beach Day conventions.

## Beach Day notes

- **Silent failure is the main risk.** A malformed agent file doesn't error; the agent just isn't there, and the orchestrator's `Agent(...)` call for it fails. Run the linter after every agent or skill change, and include its output in your HANDOFF `tests:` line.
- The Agent Console builds `agents.json` from the same files (`scripts/build-agents.mjs`, docs/03 §2). A file Claude Code skips should also fail the build, not show up in the Console with a missing description. The parser and validation rules should be shared, so flag this to agent-console-engineer through the orchestrator.
- Our 11 descriptions are short (one or two sentences each), far below the 15k-token warning.
- The background-subagent tool set includes everything our experts list (`Read, Grep, Glob, Edit, Write, Bash, WebFetch, WebSearch`). No expert depends on a tool that background mode strips.
- **Changing `.claude/agents/**` or `.claude/skills/**` needs agent-builder + orchestrator review** (change-proposal-protocol). In the Console, `.claude/agents/*.md` and `.claude/skills/**/*.md` are on the allow-list, so proposals there are possible. Each approved one is a commit; whether it is a deploy depends on the `[build] ignore` rule.
