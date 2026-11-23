# Example 03: Review-gate router (changed paths → required reviewers)

## What it demonstrates

`review-gates.mjs` exports `requiredReviewers(paths)`, a pure function that turns a proposal's changed files into:

- `reviewers`: the agents who must review (deduplicated, in a stable order);
- `blocking`: reviewers who can block (security-engineer for Console security code);
- `gates`: which table rows fired and for which paths;
- `deploys`: whether the change triggers a production deploy (a Netlify credit cost);
- `invalid`: unsafe paths (`..`, absolute, backslashes). These are rejected and escalated to security-engineer.

The rules implement the review-gate table in `.claude/skills/change-proposal-protocol/SKILL.md` (same as `docs/expert-roster.md` §5). The table names some gates by topic, not path, so this example maps each topic to concrete paths. The paths come from the repo layout in `docs/03-architecture-netlify.md` §2 and the allow-list in `docs/04-agent-console.md` §6:

| Table row | Paths used here |
|---|---|
| functions, `netlify.toml`, `_headers`, env vars | `netlify/functions/**`, `netlify.toml`, `public/_headers`, `**/.env*` |
| Console auth, allow-list, rate limits, GitHub code | `netlify/functions/{login,logout,approve}.mts`, `netlify/functions/proposals/**`, `netlify/functions/lib/{auth,allowlist,ratelimit,github}.mts`, `public/js/console/{auth,approve}.js` |
| Scoring thresholds or verdict wording | `public/js/score.js`, `public/js/score-config.js`, `public/js/copy/verdicts.js` |
| Visual tokens/components | `public/css/**` |
| Service worker / manifest | `public/sw.js`, `public/manifest.webmanifest`, `public/offline.html`, `public/icons/**` |
| `.claude/agents/**`, `.claude/skills/**` | same |
| Anything going to production | `public/**`, `netlify/**`, `scripts/**`, `.claude/**`, `netlify.toml`, `package*.json` |

Some of these paths are **assumptions**: `public/js/copy/verdicts.js`, `public/js/console/*.js` and `netlify/functions/proposals/**` don't exist yet, because the repo has no code. Update `GATES` when the real files land. The "production" row uses exactly the paths in the `[build] ignore` command in `docs/03-architecture-netlify.md`. That list includes `.claude/`, because the Console's `agents.json` is rebuilt from it, so agent and skill edits are production deploys too.

## Why this is "what good looks like"

- **One source of truth, testable.** Each `GATES` entry quotes the table row it implements, and a test fails if a row is missing.
- **Deny-by-default on weird input.** Path traversal is never resolved, only rejected. This is the same rule the approve function's allow-list uses (docs/04 §6).
- **Union, not first match.** A file can fire several gates; `allowlist.mts` fires functions-config, console-security and production. Reviewers are deduplicated.
- **Pure function with a tiny CLI.** The orchestrator can pipe `git diff --name-only` into it before routing reviews. It does not commit or call any API.

## How to run

```bash
cd knowledge/orchestrator/examples/03-review-gate-router
node --test                      # runs review-gates.test.mjs (node:test, no deps)
git -C ../../../.. diff --name-only | node review-gates.mjs
node review-gates.mjs public/sw.js .claude/agents/qa-engineer.md
```

## Verified

Run on 2026-11-23 with Node v22.23.5:

```
$ node --test
...
ok 13 - unsafe paths are rejected and escalated to security-engineer
ok 14 - every gate row from the skill table is implemented
1..14
# tests 14
# pass 14
# fail 0

$ printf 'netlify/functions/lib/allowlist.mts\npublic/css/tokens.css\ndocs/README.md\n' | node review-gates.mjs
{
  "reviewers": ["security-engineer", "netlify-engineer", "ui-designer-apple-liquid-glass", "qa-engineer"],
  "blocking": ["security-engineer"],
  "gates": [ functions-config, console-security, production, visual ... ],
  "deploys": true,
  "invalid": []
}
```

(The JSON is trimmed. The real output lists each gate with its `table` text and `paths`.)
