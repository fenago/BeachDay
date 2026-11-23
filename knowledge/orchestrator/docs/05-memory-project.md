# Memory: CLAUDE.md, auto memory and the orchestrator's `memory: project`

Source: https://code.claude.com/docs/en/memory (read as .md) ; https://code.claude.com/docs/en/sub-agents#enable-persistent-memory
Retrieved: 2026-11-23

## Two systems

| | CLAUDE.md files | Auto memory |
|---|---|---|
| Who writes it | You | Claude |
| Contains | Instructions and rules | Learnings and patterns |
| Loaded | Every session | Sessions with auto memory on: the first **200 lines or 25KB** of `MEMORY.md` |

([memory#claude-md-vs-auto-memory](https://code.claude.com/docs/en/memory#claude-md-vs-auto-memory))

Both are **context, not enforcement**: "To block an action regardless of what Claude decides, use a PreToolUse hook instead."

## CLAUDE.md essentials

- Locations, in load order: managed policy (`/etc/claude-code/CLAUDE.md` on Linux), user `~/.claude/CLAUDE.md`, project `./CLAUDE.md` or `./.claude/CLAUDE.md`, local `./CLAUDE.local.md` (gitignored). ([memory#choose-where-to-put-claude-md-files](https://code.claude.com/docs/en/memory#choose-where-to-put-claude-md-files))
- Files in directories above the working directory load at launch. Files in subdirectories load on demand, when Claude reads, writes or edits a file there. All files are **concatenated**, not overridden.
- **Size:** "target under 200 lines per CLAUDE.md file. Longer files consume more context and reduce adherence." A file over **4 MiB** is skipped entirely.
- `@path/to/file` imports load the file together with the CLAUDE.md. Relative paths resolve from the importing file; maximum depth is **four hops**. Imports help organization but not context cost.
- Block-level HTML comments (`<!-- ... -->`) are stripped before injection, so they cost no tokens.
- `.claude/rules/*.md`: modular rules. Rules without `paths:` load at launch; rules with `paths:` globs load only when matching files are touched. ([memory#organize-rules-with-claude/rules/](https://code.claude.com/docs/en/memory#organize-rules-with-claude/rules/))
- When to add to CLAUDE.md: "Claude makes the same mistake a second time", a review catches something Claude should have known, or you retype the same correction. Multi-step procedures belong in a **skill** instead.
- `/doctor prompt-audit` reviews CLAUDE.md, rules, skills and subagents for stale or conflicting instructions (v2.1.283+).

## Auto memory (the main conversation's)

- Stored at `~/.claude/projects/<project>/memory/`, shared by all worktrees of a repo, machine-local. Contains a `MEMORY.md` index plus topic files. ([memory#storage-location](https://code.claude.com/docs/en/memory#storage-location))
- Memory types recorded in frontmatter `type`: `user`, `feedback`, `project`, `reference`. Claude skips anything it can derive from the code or that CLAUDE.md already says.
- Only the first 200 lines / 25KB of `MEMORY.md` load at start; topic files are read on demand.
- Off switches: `autoMemoryEnabled: false` in settings, or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`.
- "The main conversation's auto memory isn't loaded into subagents" (except forks).

## Subagent `memory` field

From [sub-agents#enable-persistent-memory](https://code.claude.com/docs/en/sub-agents#enable-persistent-memory):

| Scope | Location | Use when |
|---|---|---|
| `user` | `~/.claude/agent-memory/<name>/` | Learnings across all projects |
| `project` | `.claude/agent-memory/<name>/` | Project-specific and "shareable via version control" |
| `local` | `.claude/agent-memory-local/<name>/` | Project-specific, not checked in |

When memory is enabled:

- The subagent's system prompt gets instructions for reading and writing its memory directory, plus "the first 200 lines or 25KB of `MEMORY.md`".
- "Read, Write, and Edit tools are automatically enabled so the subagent can manage its memory files."
- The `memory` field is part of auto memory: if auto memory is turned off, the field has no effect.
- Tips from the docs: `project` "is the recommended default scope"; ask the agent to consult memory before work and update it after; put memory instructions in the agent body.

## Beach Day notes

- The orchestrator (and agent-builder) set `memory: project`, so their notes live in `.claude/agent-memory/orchestrator/MEMORY.md` and `.claude/agent-memory/agent-builder/`. They are committed with the repo.
- **What belongs in orchestrator memory:** routing lessons ("Wren needs the verdict table in the brief"), recurring review-gate misses, and deploy/credit counts for the month. **What doesn't:** ADR content (it's in `docs/adr/`), secrets, or anything Dr. Lee hasn't decided yet.
- Keep `MEMORY.md` an index of one-liners under 200 lines; anything past the limit is silently dropped at load.
- **Memory writes are repo changes.** `.claude/agent-memory/**` is not in the Console allow-list (only `.claude/agents/*.md` and `.claude/skills/**/*.md`), so it is edited only in Claude Code sessions. It is committed only when Dr. Lee asks for a commit. The `[build] ignore` command proposed in `docs/03-architecture-netlify.md` (`git diff --quiet $CACHED_COMMIT_REF $COMMIT_REF -- public netlify`) would skip the deploy for a commit that only touches `.claude/**`. Confirm with netlify-engineer that this is what `netlify.toml` actually contains once it exists.
- **Promote, don't hoard:** if the same lesson shows up twice, ask agent-builder to move it into a shared skill (for example `team-protocol`) or CLAUDE.md, per the docs' "same mistake a second time" rule. Remove it from memory afterwards.
- Experts don't have `memory:` (except agent-builder), so they never see the orchestrator's memory. Pass relevant lessons in the task brief.
