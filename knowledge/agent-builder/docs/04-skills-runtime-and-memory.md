# Skills at runtime (invocation, preload, lifecycle) and agent memory

Source: https://code.claude.com/docs/en/skills#control-who-invokes-a-skill ; https://code.claude.com/docs/en/skills#skill-content-lifecycle ; https://code.claude.com/docs/en/sub-agents#preload-skills-into-subagents ; https://code.claude.com/docs/en/sub-agents#enable-persistent-memory ; https://code.claude.com/docs/en/memory
Retrieved: 2026-11-23

## Who can invoke, and what is in context

| Frontmatter | User invokes | Claude invokes | In context |
|---|---|---|---|
| (default) | Yes | Yes | Description always; full skill when invoked |
| `disable-model-invocation: true` | Yes | Not on its own | Description **not** in context |
| `user-invocable: false` | No | Yes | Description always; full skill when invoked |

([skills#control-who-invokes-a-skill](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill))

"In a regular session, skill descriptions are loaded into context ... but full skill content only loads when invoked. Subagents with preloaded skills work differently: the full skill content is injected at startup."

## Preloading into subagents (`skills:` in the agent file)

- "The full content of each listed skill is injected into the subagent's context at startup, up to the first 32 distinct names."
- The field controls **preloading only**. Without it, the subagent can still discover and invoke project, user and plugin skills through the Skill tool. To stop a subagent using skills at all, omit `Skill` from `tools` or add it to `disallowedTools`.
- Skills with `disable-model-invocation: true` can't be preloaded.
- A missing or disabled skill is skipped with a debug-log warning. ([sub-agents#preload-skills-into-subagents](https://code.claude.com/docs/en/sub-agents#preload-skills-into-subagents))

| Approach | System prompt | Task | Also loads |
|---|---|---|---|
| Skill with `context: fork` | From the agent type | The SKILL.md content | CLAUDE.md (per agent startup) |
| Subagent with `skills:` | Subagent body | Claude's delegation message | Preloaded skills + CLAUDE.md |

([skills#run-skills-in-a-subagent](https://code.claude.com/docs/en/skills#run-skills-in-a-subagent))

## Lifecycle and compaction

- An invoked skill "enters the conversation as a single message and stays there across later turns". Claude Code "does not re-read the skill file on later turns". So write standing instructions ("Run the tests after every edit"), not one-time steps. ([skills#skill-content-lifecycle](https://code.claude.com/docs/en/skills#skill-content-lifecycle))
- After auto-compaction, the latest invocation of each skill is re-attached, keeping "the first 5,000 tokens of each", within a combined **25,000-token** budget filled from the most recently invoked skill. Older skills can drop out. **Put the most important instructions near the top.**
- The `allowed-tools` grant clears at the next user message, even though the content stays.
- Rules that must hold every time belong in a **hook**, not a skill: "move the rule into a hook ... Claude Code runs that hook when its event occurs ... whether or not Claude is following the skill." ([skills#claude-stops-following-a-skill](https://code.claude.com/docs/en/skills#claude-stops-following-a-skill))
- When many skills exist, the listing budget is about 1% of the context window. Descriptions of the least-used skills are dropped first. `/doctor` estimates the cost; `skillListingBudgetFraction` raises it. ([skills#skill-descriptions-are-cut-short](https://code.claude.com/docs/en/skills#skill-descriptions-are-cut-short))

## Triggering problems

- **Skill not triggering:** put natural keywords in the description, check "What skills are available?", invoke `/name` directly, check refused names, check `paths` scope. Malformed YAML means the description can't be matched.
- **Triggers too often:** make the description more specific, or set `disable-model-invocation: true`.

## Agent memory (`memory:` field)

| Scope | Directory |
|---|---|
| `user` | `~/.claude/agent-memory/<agent-name>/` |
| `project` | `.claude/agent-memory/<agent-name>/` (shareable via git; "recommended default") |
| `local` | `.claude/agent-memory-local/<agent-name>/` (not checked in) |

When enabled ([sub-agents#enable-persistent-memory](https://code.claude.com/docs/en/sub-agents#enable-persistent-memory)):

- The system prompt gets memory read/write instructions plus "the first 200 lines or 25KB of `MEMORY.md`".
- "Read, Write, and Edit tools are automatically enabled".
- If auto memory is off (`autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY`), the field does nothing.
- The docs suggest putting memory upkeep instructions in the body, e.g. "Update your agent memory as you learn ... Write concise notes about what you learned and why it matters."

CLAUDE.md, for comparison ([memory](https://code.claude.com/docs/en/memory)):

- Loads in every session and every subagent (unless `omitClaudeMd`).
- Target under **200 lines**; files over 4 MiB are skipped.
- Add to it when "Claude makes the same mistake a second time". "If an entry is a multi-step procedure or only matters for one part of the codebase, move it to a skill or a path-scoped rule instead."

## Beach Day notes

- **Where should a fix go?** Use the smallest scope that reaches every agent that made the mistake:

| Mistake made by | Put the fix in |
|---|---|
| One agent, its role only | That agent's body |
| Several agents sharing a skill | The shared skill (top of file) |
| Every session, a one-line fact | CLAUDE.md |
| Must never happen, no judgement involved | A hook in `.claude/settings.json` (Dr. Lee approves) |
| Lesson that is only learned, not a rule | agent-builder's `memory: project` |

- agent-builder and orchestrator have `memory: project` → `.claude/agent-memory/<name>/MEMORY.md`. Keep it an index of one-liners. Promote a lesson to a skill once it is confirmed twice.
- **Memory widens tools.** Adding `memory:` to a read-only reviewer (none today) would give it Write/Edit. Flag this to security-engineer if ever proposed.
- Because preloaded skill content is injected at **startup**, every expert spawn pays for its whole `skills:` list. A 300-line skill shared by 5 agents costs 1,500 lines of context per wave. This is why the authoring skill says "Keep shared skills tight".
- Beach Day skills are reference content, so none should use `context: fork`. A future `/release-check` task skill could use it together with `disable-model-invocation: true`.
