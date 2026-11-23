# Agent-builder knowledge base

Date: 2026-11-23 · Owner: agent-builder · Scope: writing, validating and improving `.claude/agents/*.md` and `.claude/skills/*/SKILL.md`, and prompting the current Claude models

Read this index first, then the files the task needs.

## docs/ (reference notes from official documentation)

| File | What it covers | Read when |
|---|---|---|
| [docs/01-subagent-frontmatter-reference.md](docs/01-subagent-frontmatter-reference.md) | Every documented agent frontmatter field (`name` … `experimental`), allowed values, model resolution order, `Agent(...)` limits, scopes and priority | Creating or editing any agent file |
| [docs/02-subagent-loading-and-validation.md](docs/02-subagent-loading-and-validation.md) | When Claude Code silently skips an agent, hot reload, the 15k-token description budget, what a subagent receives, tools filtered from subagents, the validation checklist | Debugging an agent that "isn't there", or before handing off an agent change |
| [docs/03-skills-format.md](docs/03-skills-format.md) | SKILL.md locations and frontmatter (all fields), the 1,536-char description cap, the line-1 rule, broken YAML still loads, under 500 lines, supporting files, portability to the Skills API | Creating or editing a skill |
| [docs/04-skills-runtime-and-memory.md](docs/04-skills-runtime-and-memory.md) | Invocation control, preloading (`skills:`, 32 max, not `disable-model-invocation`), lifecycle and the 5k/25k compaction budget, hooks vs skills, agent `memory:` scopes | Deciding where a fix goes (agent body, skill, CLAUDE.md, hook, memory) |
| [docs/05-prompt-engineering-principles.md](docs/05-prompt-engineering-principles.md) | Anthropic's principles: clear and direct, explain why, examples, structure, role, positive phrasing, no over-triggering, agentic snippets (scope, test-gaming, hallucination, reversibility) | Writing or rewriting any prompt text |
| [docs/06-prompting-current-models.md](docs/06-prompting-current-models.md) | Per-model guides; Opus 5.5: effort (default `medium`), no thinking-disabled (400), `reasoning_extraction`, progress updates in thinking blocks, unattended runs, pasted-text tags | Choosing models and effort, or reviewing Console prompts and API settings |

## examples/ (worked, verified)

| Folder | What it shows | Read when |
|---|---|---|
| [examples/01-model-agent-and-skill/](examples/01-model-agent-and-skill/) | A template expert (`fixture-curator`) and a skill with a supporting `reference.md`, each choice tied to a doc. Lints with 0 errors | Writing a new agent or skill |
| [examples/02-agent-skill-linter/](examples/02-agent-skill-linter/) | `lint-agents.mjs`: Claude Code load rules plus Beach Day conventions, **run on the real repo** (0 errors, 1 warning) and on broken fixtures (13 errors caught) | After every agent or skill change; put its output in your HANDOFF |
| [examples/03-prompt-postmortem/](examples/03-prompt-postmortem/) | Before/after post-mortem: root-cause buckets, smallest fix in the shared skill, a deterministic end-state check (ran: before FAIL, after ok) | Improving an agent after a mistake |

## Open findings from the linter run (2026-11-23)

1. `.claude/skills/claude-code-agent-authoring/SKILL.md`: the description contains `<name>`, which displays as HTML entities in the skill listing. Use `[name]`.
2. The post-mortem in example 03 proposes moving the `beach-day-scoring` safety-line rule to the top and widening it from "screen" to "wherever a verdict appears". This is a proposal only.
