# Skills: SKILL.md format, frontmatter, size and supporting files

Source: https://code.claude.com/docs/en/skills (read as https://code.claude.com/docs/en/skills.md)
Retrieved: 2026-11-23

## Where skills live

| Location | Path | Loads in |
|---|---|---|
| Enterprise | `.claude/skills/<name>/SKILL.md` in the managed settings dir | All users the org deploys to |
| Personal | `~/.claude/skills/<name>/SKILL.md` | All your projects (not Cowork/cloud) |
| Project | `.claude/skills/<name>/SKILL.md` | Sessions in this repo; commit it |
| Nested | `<dir>/.claude/skills/<name>/SKILL.md` | Sessions started in or below `<dir>` |
| Plugin | `<plugin>/skills/<name>/SKILL.md` | As `/plugin-name:skill-name` |

([skills#choose-where-skills-load](https://code.claude.com/docs/en/skills#choose-where-skills-load))

- Reserved folder names: `synced` (any case) and `anthropic-skills` / `anthropic-skills:*`.
- Folder names with zero-width, control, private-use or bidi characters, `<`, `>`, or irregular spaces are refused.
- `.claude/commands/*.md` is the older format and still works, but skills add supporting files.

## Frontmatter

"All fields are optional. Only `description` is recommended." Field names are lowercase-hyphenated, except `when_to_use`. Unknown fields are ignored silently. Booleans accept `true/false/yes/no/on/off/1/0`. ([skills#frontmatter-reference](https://code.claude.com/docs/en/skills#frontmatter-reference))

| Field | Meaning |
|---|---|
| `name` | Command name in the `/` menu. **Defaults to the directory name** |
| `description` | What it does and when to use it. If omitted, the first non-empty body line. The combined `description` + `when_to_use` is **truncated at 1,536 characters** in the listing. Put the key use case first |
| `when_to_use` | Extra trigger context; counts toward the 1,536 cap |
| `argument-hint` | Autocomplete hint, e.g. `[issue-number]` |
| `arguments` | Named positional args for `$name` substitution |
| `disable-model-invocation` | `true` = only the user can invoke. Also **prevents preloading into subagents** |
| `user-invocable` | `false` = hidden from the `/` menu; only Claude invokes it |
| `allowed-tools` | Tools pre-approved for the turn that invokes the skill (cleared at the next user message). Does not restrict other tools |
| `disallowed-tools` | Tools removed while the skill is active |
| `model`, `effort` | Override for the rest of the current turn (or for the fork with `context: fork`) |
| `context: fork` + `agent` | Run the skill in a subagent of type `agent`. The skill body becomes the task |
| `background` | With `context: fork`: `false` = wait for the result. Default `true` |
| `hooks` | Hooks registered when invoked |
| `paths` | Globs that activate the skill for matching files |
| `shell` | `bash` (default) or `powershell` for inline commands |
| `metadata` | Free-form map, ignored by Claude Code |
| `license`, `compatibility` | Agent Skills spec fields, accepted but not acted on |

**Portability:** claude.ai uploads, the Skills API and `package_skill.py` accept only `name`, `description`, `license`, `compatibility`, `metadata` and `allowed-tools`. Any other key is a **hard error** there: "Unexpected key(s) in SKILL.md frontmatter". ([skills#using-skill-frontmatter-outside-claude-code](https://code.claude.com/docs/en/skills#using-skill-frontmatter-outside-claude-code))

## Parsing rules that bite

- "Claude Code reads the frontmatter only when the opening `---` is the file's first line. Otherwise it treats the whole file, `---` markers included, as skill content."
- "If the YAML between the markers doesn't parse, the skill still loads with no fields set". So `/skill-name` works, but Claude can't match on the description. Unlike agents, a broken skill does **not** disappear. ([skills#frontmatter-reference](https://code.claude.com/docs/en/skills#frontmatter-reference), [skills#skill-not-triggering](https://code.claude.com/docs/en/skills#skill-not-triggering))
- `claude plugin validate .claude/skills` finds `SKILL.md` files whose frontmatter doesn't parse (v2.1.233+).
- `<` and `>` in `description` display as HTML entities; use `[branch]` instead of `<branch>`.

## Size and supporting files

- **"Keep `SKILL.md` under 500 lines. Move detailed reference material to separate files."** ([skills#add-supporting-files](https://code.claude.com/docs/en/skills#add-supporting-files))
- "Keep the body itself concise. Once a skill loads, its content stays in context across turns, so every line is a recurring token cost. State what to do rather than narrating how or why." ([skills#types-of-skill-content](https://code.claude.com/docs/en/skills#types-of-skill-content))
- Layout:

```text
my-skill/
├── SKILL.md      (required - overview and navigation)
├── reference.md  (loaded when needed)
├── examples.md   (loaded when needed)
└── scripts/helper.py (executed, not loaded)
```

- Link supporting files from `SKILL.md` and say what each contains and when to load it.
- Substitutions: `$ARGUMENTS`, `$0`/`$1`, `$name`, `${CLAUDE_SESSION_ID}`, `${CLAUDE_EFFORT}`, `${CLAUDE_SKILL_DIR}` (the skill's folder), `${CLAUDE_PROJECT_DIR}`. Escape a literal `$1` as `\$1`.

## Two kinds of content

- **Reference content** (conventions, domain knowledge) runs inline. This is what all our Beach Day skills are.
- **Task content** (step-by-step actions such as deploy or commit) is often paired with `disable-model-invocation: true`, and sometimes `context: fork`. "`context: fork` only makes sense for skills with explicit instructions". A guidelines-only skill in a fork "returns without meaningful output". ([skills#run-skills-in-a-subagent](https://code.claude.com/docs/en/skills#run-skills-in-a-subagent))

## Beach Day notes

- **Folder name = `name:` = the entry in agents' `skills:` lists.** `name` defaults to the folder, but we set it explicitly and require them to match, so a rename can't half-apply.
- **Never set `disable-model-invocation: true` on a shared Beach Day skill.** It would silently stop the skill from being preloaded into every agent that lists it.
- **Shared skills are preloaded in full into every agent that lists them.** `beach-day-context` and `change-proposal-protocol` go into all 11. Budget: aim for ≤150 lines in shared skills (500 is the hard guidance) and move depth into `docs/`. The skills already point to `docs/0N-*.md` for detail.
- **Description first words matter.** The listing truncates at 1,536 characters combined, and when many skills exist, descriptions of rarely used skills are dropped first. Start each description with the domain noun ("Open-Meteo Forecast and Marine API reference ...").
- **Keep frontmatter to `name` + `description`** in our skills. That keeps them portable to the Skills API. The Agent Console might load skills into API calls later; that is **[UNVERIFIED]** as a plan, but nothing is lost by staying portable.
