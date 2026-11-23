# Example 01: A model agent file and a model skill (Beach Day conventions)

## What it demonstrates

- `agents/fixture-curator.md` is a complete expert agent written to every convention in `claude-code-agent-authoring`. It is a **template**, not a roster agent; nothing installs it, and it lives outside `.claude/` so Claude Code never loads it.
- `skills/fixture-capture/SKILL.md` plus `reference.md` form a model skill that uses the official **supporting-file** pattern: a short `SKILL.md` with always-on rules at the top, and detail in a sibling file that is loaded only when needed.

## Why this is "what good looks like"

| Choice | Reason (doc) |
|---|---|
| `---` on line 1; only documented fields plus the two custom ones (`persona`, `personality`) | Otherwise the file is skipped, or the field is silently ignored (docs/01, docs/02) |
| `name` = filename = how the orchestrator will call it | Beach Day convention; `name` is the identity (docs/01) |
| Description: one sentence on the job, then "Use when ..." with concrete triggers | Claude delegates on the description; keep it short because there is a 15k-token budget across all agents (docs/02) |
| `tools` is an allowlist with **no `Edit`**, plus `disallowedTools: Agent` | Least privilege for a narrow role; experts never delegate (hub-and-spoke) |
| `model: haiku` | The authoring skill: `haiku` for small, well-defined jobs. `docs/agent-brains.md` names "a fixture refresher that re-saves Open-Meteo responses" as a future Haiku helper; this template is that helper |
| `skills:` starts with `beach-day-context` and ends with `change-proposal-protocol`; only 4 skills | Required pair; every preloaded skill costs tokens on every spawn (docs/04) |
| `persona: Mo` + one-line `personality` + a `## Who you are` section | House convention (`docs/agent-brains.md`); the Console shows both custom fields and Claude Code ignores them |
| Body: "Who you are" → "Before you answer" → role → responsibilities → how you work → boundaries → HANDOFF | The house structure; it gives the role first and a reason with each rule (docs/05) |
| Positive, calm instructions; no "CRITICAL/MUST" | Current models over-trigger on aggressive wording (docs/05) |
| Skill `name` = folder; description starts with the domain noun and says when to use it | The listing truncates at 1,536 characters, and rarely used descriptions get dropped (docs/03) |
| Standing rules at the **top** of the skill | Only the first 5,000 tokens of a skill are re-attached after compaction (docs/04) |
| Skill frontmatter uses only `name` + `description` | Portable to the Skills API and claude.ai uploads (docs/03) |
| No secrets; fixtures are keyless Open-Meteo data | `secure-by-design` |

## How to run

The files are validated with the linter from example 02:

```bash
node knowledge/agent-builder/examples/02-agent-skill-linter/lint-agents.mjs --root . \
  --agents-dir knowledge/agent-builder/examples/01-model-agent-and-skill/agents \
  --skills-dir knowledge/agent-builder/examples/01-model-agent-and-skill/skills \
  --skills-dir .claude/skills --no-docs
```

To actually adopt the agent, agent-builder would:

1. copy the files into `.claude/agents/` and `.claude/skills/`;
2. add `fixture-curator` to the orchestrator's `Agent(...)` list, `docs/expert-roster.md`, `docs/agent-brains.md` and CLAUDE.md in the same change;
3. create `knowledge/fixture-curator/`;
4. get agent-builder + orchestrator review and Dr. Lee's approval.

## Verified

Run on 2026-11-23, Node v22.23.5, yaml 2.9.1 (installed outside the repo):

```
Linted 1 agent(s) in knowledge/agent-builder/examples/01-model-agent-and-skill/agents and 23 skill(s) in knowledge/agent-builder/examples/01-model-agent-and-skill/skills, .claude/skills
WARN  .claude/skills/claude-code-agent-authoring/SKILL.md: description contains < or >; shown as HTML entities
WARN  knowledge/agent-builder/examples/01-model-agent-and-skill/agents/fixture-curator.md: knowledge/fixture-curator/ referenced but missing

0 error(s), 21 warning(s), 0 info
```

The other 19 warnings are "skill is not preloaded by any agent", which is expected when linting one agent against all 22 repo skills (filtered from the excerpt). The `knowledge/fixture-curator/` warning is expected for a template. The agent was not run inside Claude Code.
