---
name: change-proposal-protocol
description: How any Beach Day agent proposes or makes code changes — small reviewable diffs, allowed paths only, tests included, never committing or pushing on its own. Use before editing any file or calling propose_change.
---
# Change proposal protocol

## In a Claude Code session (repo checkout)
1. Work only on the task the orchestrator gave you. Keep diffs small and focused. Do not reformat files or refactor code that is unrelated to the task.
2. Read the relevant doc and the existing code before editing.
3. Include or update tests for any change to behavior (see `testing-vitest-playwright`).
4. **Do not run `git commit` or `git push`**, and do not open PRs. The orchestrator commits, and only when Dr. Lee asked for it.
5. If the change touches any path in the review-gate table below, flag the reviewer it needs in your handoff.
6. Finish with the HANDOFF block from `team-protocol`.

## In the deployed Agent Console
- You have read tools (`read_file`, `list_files`) and **one** write tool, `propose_change`. You cannot commit.
- Send **complete new file contents** for each changed file, plus a one-paragraph `summary` covering what, why and how it was tested.
- Only allow-listed paths are accepted. Deny wins.
  - **Allowed:** `public/**` (text types only), `tests/**`, `docs/**`, `.claude/agents/*.md`, `.claude/skills/**/*.md`.
  - **Denied:** `public/_headers`, `public/_redirects`, `public/sw.js` and every file it imports (`public/sw/**`), `public/vendor/**`, `public/generated/**`, `public/version.json`, `netlify/**`, `netlify.toml`, `.github/**`, `package.json`, `package-lock.json`, `scripts/**`, `**/.env*`, `.git/**`, `.gitmodules`, `.claude/settings*`, `**/*.pem`, `**/*.key`, and any binary or non-text file.
  - Open question for Dr. Lee: also deny `public/console.html` and `public/js/console/**` (security-engineer's recommendation). Until he rules, they are allowed.
- Limits: at most 20 files and 200 KB per file, text files only.
- Never include secrets, tokens or keys in proposed content. Proposals are secret-scanned and rejected if they contain any.
- Prefer **one proposal per logical change**. Each approval is one production deploy and costs Netlify credits.
- If the user asks for a change to a denied path, explain that a human must make it outside the Console.

## Review gates (from docs/expert-roster.md §5)
| Change touches… | Needs review by |
|---|---|
| `netlify/functions/**`, `netlify.toml`, `_headers`, env vars | security-engineer + netlify-engineer |
| Console auth, allow-list, rate limits, GitHub code | security-engineer (can block) |
| Supabase Auth: sign-in flows, the token and role check, `profiles`/RLS SQL, redirect URLs | supabase-auth-engineer + security-engineer (can block) |
| Scoring thresholds or verdict wording | open-meteo-integrator + ux-designer-apple-hig |
| Visual tokens/components | ui-designer-apple-liquid-glass + qa-engineer (a11y) |
| Service worker / manifest | pwa-mobile-engineer + qa-engineer |
| `.claude/agents/**`, `.claude/skills/**` | agent-builder + orchestrator |
| Anything going to production | qa-engineer green on the main deploy, rollback ready (ADR-0003) |
