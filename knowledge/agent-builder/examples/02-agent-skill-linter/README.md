# Example 02: Agent and skill linter (run against the real repo)

## What it demonstrates

`lint-agents.mjs` is a read-only Node 22 script (one dependency: `yaml`). It checks every `.claude/agents/*.md` and `.claude/skills/*/SKILL.md` against two sets of rules.

**Claude Code's own load rules** (from `docs/01`–`docs/03`):

| Check | Level |
|---|---|
| `---` on line 1 and a closing `---`; YAML parses to a mapping (else the agent is skipped) | ERROR |
| Agent has `name` (no `:`, no leading `-`, ≤256 chars) and `description` | ERROR |
| Unknown frontmatter field. Claude Code ignores it silently; a close misspelling such as `disalowedTools` is an ERROR, otherwise WARN | ERROR/WARN |
| `model` is an alias, `inherit` or a `claude-*` ID; `color`, `memory`, `effort`, `permissionMode` use the documented values | ERROR |
| Every `skills:` entry exists as a folder with `SKILL.md`, and that skill isn't `disable-model-invocation: true`; more than 32 skills | ERROR / WARN |
| Skill: `name` equals the folder; `description` present; `description` + `when_to_use` ≤ 1,536 chars; ≤ 500 lines; no `<`/`>` in description | ERROR / WARN |

**Beach Day conventions** (`claude-code-agent-authoring`, `team-protocol`, CLAUDE.md):

| Check | Level |
|---|---|
| Agent `name` equals the filename | ERROR |
| `personality` present (one line); `persona` is a capitalised first name | ERROR |
| Body has a `## Who you are` section naming the persona in bold | WARN |
| Every expert has `disallowedTools: Agent` and no `Agent`/`Task` in `tools` | ERROR |
| The orchestrator's `Agent(...)` list equals the set of expert files, with nothing missing and nothing extra | ERROR |
| Every agent preloads `beach-day-context` and `change-proposal-protocol` | ERROR |
| `tools`, `model` and `color` set explicitly; body mentions HANDOFF; body points to `knowledge/<name>/` and the folder exists | WARN |
| Every skill is preloaded by some agent; CLAUDE.md, `docs/expert-roster.md` and `docs/agent-brains.md` mention every agent (and persona or skill) (skip with `--no-docs`) | WARN |
| A token-shaped secret in an agent file | ERROR |

Also included:

- `broken-fixtures/` holds deliberately broken agents and skills that the linter must catch. They live outside `.claude/`, so Claude Code never loads them.
- `package.json` lists the single dependency.

## Why this is "what good looks like"

- **It encodes the silent failures.** Claude Code doesn't error on a skipped agent, an unknown field or a missing preloaded skill; it writes to the debug log at most. The linter turns each into a visible ERROR with the documented consequence ("→ Claude Code skips this agent").
- **Doc rules and house rules are kept separate.** Messages say "convention:" when the rule is ours, not Claude Code's.
- **It is read-only.** It never edits files; it only reports.
- **It closes the loop on CLAUDE.md's rule:** "When you add or rename an agent or skill, update `.claude/agents/`, `.claude/skills/`, `docs/expert-roster.md`, the orchestrator's `Agent(...)` list and this file together".

## How to run

```bash
# from the repo root; needs `yaml` (install it outside the repo, or npm i here — never commit node_modules)
cd knowledge/agent-builder/examples/02-agent-skill-linter && npm install && cd -
node knowledge/agent-builder/examples/02-agent-skill-linter/lint-agents.mjs --root .
node .../lint-agents.mjs --root . --json            # machine-readable
node .../lint-agents.mjs --root . --agents-dir <dir> --skills-dir <dir> --skills-dir .claude/skills --no-docs
```

Official cross-checks to run as well, when the Claude Code CLI is available: `claude plugin validate .claude/agents`, `claude plugin validate .claude/skills`, and `claude --debug` (search the log for `does not recognize or apply`).

## Verified

Run on 2026-11-23, Node v22.23.5, `yaml` 2.9.1 installed in a scratch directory outside the repo (the script was copied there to resolve the dependency). No agent or skill file was modified.

**Real repo (`.claude/`, 11 agents, 22 skills):**

```
Linted 11 agent(s) in .claude/agents and 22 skill(s) in .claude/skills
WARN  .claude/skills/claude-code-agent-authoring/SKILL.md: description contains < or >; shown as HTML entities
INFO  .claude/agents/orchestrator.md: Agent(...) matches the 10 expert files
INFO  .claude/agents/orchestrator.md: Agent(...) is enforced only when run as `claude --agent orchestrator` (docs: sub-agents)

0 error(s), 1 warning(s), 2 info
exit=0
```

Issues to report, not fix here:

1. The `claude-code-agent-authoring` description contains `<name>` (`.claude/skills/<name>/SKILL.md`). The skills docs say angle brackets in `description` display as `&lt;`/`&gt;`, so the listing shows HTML entities. Suggested fix for agent-builder: write `[name]` instead.
2. An earlier run in the same session also warned that `knowledge/software-architect/` was missing. That folder was still being written; the final run above is clean. The repo gained the custom `persona:` field and a `## Who you are` section while this example was being built, so the linter learned both (`persona` is no longer reported as an unknown field).

All 11 agents passed every ERROR check: frontmatter on line 1, YAML parses, name and description, name equals filename, valid model and color, all `skills:` folders exist, both required skills preloaded, personality and persona present (each with a matching "Who you are" section and a mention in `docs/agent-brains.md`), `disallowedTools: Agent` on all 10 experts, and the orchestrator's `Agent(...)` list exactly matches the 10 expert files.

**Wave 4 re-run (2026-11-23, 12 agents, 25 skills):** 0 errors, 0 warnings, 2 info; the `<name>` warning above is fixed.

**Model example (`../01-model-agent-and-skill/`):** 0 errors. The only warnings are the shared one above and the expected `knowledge/fixture-curator/` missing (it is a template, not a roster agent).

**Broken fixtures:** 13 errors caught, exit 1. Excerpt:

```
ERROR broken-fixtures/agents/bad-yaml.md: YAML does not parse: Flow sequence in block collection must be sufficiently indented and end with a ] at line 2, column 23: → Claude Code skips this agent
ERROR broken-fixtures/agents/no-frontmatter.md: '---' is not on line 1 (found "# Notes"); Claude Code treats the file as having no frontmatter → Claude Code skips this agent
ERROR broken-fixtures/agents/reviewer.md: unknown field "disalowedTools" is silently ignored; did you mean "disallowedTools"?
ERROR broken-fixtures/agents/reviewer.md: model "gpt-5" is not an alias (sonnet/opus/haiku/fable/inherit) or a claude-* ID
ERROR broken-fixtures/agents/reviewer.md: color "teal" not in red, blue, green, yellow, purple, orange, pink, cyan
ERROR broken-fixtures/agents/reviewer.md: skill "missing-skill" has no folder with SKILL.md → silently not preloaded
ERROR broken-fixtures/agents/reviewer.md: convention: persona must be a first name (got undefined)
ERROR broken-fixtures/agents/reviewer.md: expert must have disallowedTools: Agent (hub-and-spoke)
ERROR broken-fixtures/agents/orchestrator.md: Agent(...) lists agents with no file: ghost-agent
ERROR broken-fixtures/skills/Wrong_Name/SKILL.md: name "wrong-name" != folder "Wrong_Name"
...
13 error(s), 26 warning(s), 2 info
exit=1
```

Limits: the linter doesn't verify that `tools` entries are real tool names (the tool list depends on the session), and it doesn't run Claude Code itself. `claude plugin validate` and `claude --debug` remain the authority.
