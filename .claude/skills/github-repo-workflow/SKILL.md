---
name: github-repo-workflow
description: How Beach Day talks to GitHub — the fine-grained PAT, REST headers and API version, the atomic multi-file commit to main via the Git Database API, stale-base and conflict handling, rate limits and push protection. Use when writing or reviewing the approve function or anything that commits to the repo.
---
# GitHub repo workflow (details: docs/04 §5, §7; ADR-0003, ADR-0005)

## Token
- **Type:** fine-grained PAT. Resource owner `fenago`, **only** `fenago/BeachDay`.
- **Permissions:** Contents read/write. No Workflows, no Pull requests.
- **Lifetime:** 90-day expiry, then rotate.
- **Storage:** `GITHUB_TOKEN` as a Netlify secret in the Production context only.
- **Scope gap:** a PAT **cannot be limited to paths**. The allow-list in code is the control.

## Request headers
```
Authorization: Bearer ${GITHUB_TOKEN}
Accept: application/vnd.github+json
X-GitHub-Api-Version: 2022-11-28   # supported until 2028-03-10; 2026-03-10 exists — read its changelog before switching
User-Agent: beach-day-console
```

## Atomic commit to `main`
Make each call **serially**.
1. `GET /repos/fenago/BeachDay/git/ref/heads/main` → `headSha`.
2. If `headSha !== proposal.baseSha`:
   - Compare the current blob SHA of each proposed path with the one the agent read.
   - If any differ, mark the proposal `stale` and stop.
3. `GET /repos/fenago/BeachDay/git/commits/{headSha}` → `tree.sha`.
4. `POST /repos/fenago/BeachDay/git/trees` with `{ base_tree, tree: [{ path, mode: "100644", type: "blob", content }] }`.
   - **Always** send `base_tree`. Leaving it out deletes every other file.
   - **No deletions.** `propose_change` cannot delete, and approve never sends `sha: null` (docs/04 §6). Deleting a file is a human change.
   - Never use mode `120000` (symlink) or `160000` (submodule).
5. `POST /repos/fenago/BeachDay/git/commits` with `{ message, tree, parents: [headSha], author: { name: "Beach Day Agent (<agent>)", email } }`.
6. `PATCH /repos/fenago/BeachDay/git/refs/heads/main` with `{ sha: newCommitSha, force: false }`.
   - If this fails as not fast-forward, `main` moved since step 1. Retry from step 1 once; if it fails again, mark the proposal `stale`.

Commit message: `buildCommitMessage(summary, id)`, built by the server only (docs/04 §7 step 5). It is the one-line cleaned summary, a blank line, and a final line exactly `Beach-Day-Proposal: <id>`. Author name is `Beach Day Agent (<agent>)`. Agent text can never produce the trailer line; the reconciler relies on it.

Do **not** use the Contents API (`PUT /contents/{path}`) for multi-file changes. It makes one commit per file and breaks under parallel calls.

## Errors & limits
| Response | Handling |
|---|---|
| 401 / 403 | Token expired or wrong permissions. Tell the user to rotate the token. Never retry in a loop. |
| 409 / 422 | Conflict or not fast-forward. Retry once as described above. |
| Push protection rejection (a secret was detected) | Mark the proposal `failed` with a clear message. Never bypass it. |
| `retry-after` present, or `x-ratelimit-remaining` is 0 | Wait as told. PAT limit is 5,000/hr. Secondary limits: ≤80 content-creating requests/min, ≤500/hr. |

## Repo hygiene
- Ruleset on `main`: block force pushes and block deletions. Both are available on Free for public repos.
- Humans change denied paths (`netlify/**`, `.github/**`, `package*.json`, `scripts/**`) through normal git.
- Claude Code sessions follow `change-proposal-protocol`. Only the orchestrator commits, and only when Dr. Lee asks.
