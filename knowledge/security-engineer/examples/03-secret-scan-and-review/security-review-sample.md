# Security review: `netlify/functions/approve.mts` + `lib/github.mts` (sample)

> **Sample review written to show the format.** The diff it reviews is hypothetical (a first version of the approve function). Line references point to that hypothetical diff. Use this as the template for real reviews.

- **Reviewer:** security-engineer
- **Date:** 2026-11-23
- **Change:** a proposal from agent-console-engineer, "Approve endpoint v1: commit proposal to main via Git Database API". It touches `netlify/functions/approve.mts` (new), `netlify/functions/lib/github.mts` (new) and `netlify.toml` (adds `[functions]` config).
- **Review gate:** `netlify/**` and `netlify.toml` changes need security-engineer and netlify-engineer (`change-proposal-protocol`). This change is made by a human in Claude Code. It cannot come through the Console, because both paths are on the deny list.

## Verdict: **APPROVE WITH CHANGES**

The overall design matches ADR-0003 and ADR-0005:
- one atomic commit;
- `base_tree` is always sent;
- `force: false`;
- the token is read only from `process.env.GITHUB_TOKEN`.

Four changes are required before merge (H1, H2, M1, M2). L1 and L2 can follow in a later commit.

## Findings (most severe first)

### H1: Approve does not re-run the allow-list and secret scan (High)
- **Where:** `approve.mts`, `handler`, roughly lines 40–55. The handler loads the proposal from Blobs and goes straight to `commitFiles(proposal.files)`.
- **Exploit scenario:** the allow-list ran at `propose_change` time with an older `allowlist.mts`. Later we tightened it, adding `public/sw.js` to `SENSITIVE`. A proposal stored before that change can still be approved under the old rules. Separately, anyone who can write to the proposals Blobs store, for example through a future bug in `/api/proposals`, can swap `files` after the human looked at the diff.
- **Fix:**
  - At approve time, call `checkProposal(files)` and `scanProposal(files)` again (`knowledge/security-engineer/examples/02` and `03`).
  - Recompute `contentHash` over canonical JSON and compare it with the hash the browser sent, which is the hash the human saw. Mismatch → 409.
  - Tests:
    - a stored proposal with `netlify.toml` gets 403;
    - one with a secret gets 422;
    - one with a hash mismatch gets 409.

### H2: Status update is not compare-and-swap; double Approve makes two commits (High)
- **Where:** `approve.mts`, roughly line 60: `await store.setJSON(id, {...p, status: "committed"})` runs after the commit.
- **Exploit scenario:** a double-click, or two tabs, sends two Approve requests. Both read `status: "pending"`, and both run `commitFiles`. The second commit applies the same files on top of the first, so the content is identical but the commit is empty-diff or duplicated. That costs **two production deploys** (30 credits, ADR-0004), and the audit log is now ambiguous. With a stale-base race it could also re-apply an older version over a human edit made in between.
- **Fix:**
  - Before calling GitHub, flip `pending → committing` with an etag-conditional write (`onlyIfMatch`, `netlify-blobs` skill). The loser gets **409**.
  - Write the final `committed` status with the commit SHA, also conditionally.
  - Keep a single "approve in flight" lock key.
  - Test: two concurrent approves give one 200 and one 409, and exactly one `PATCH /git/refs/heads/main` (use the mock GitHub from `knowledge/agent-console-engineer/examples/03`).

### M1: No step-up before Approve (Medium)
- **Where:** `approve.mts` runs the token-and-role guard only.
- **Exploit scenario:** someone gets brief access to an unlocked laptop where Dr. Lee is signed in to the Console. Supabase sessions refresh silently, so the tab stays usable for days. They approve a pending proposal, and it goes to production. Or an XSS steals the tokens from `localStorage` and approves from elsewhere. OWASP Session Management calls for "Reauthentication After Risk Events", and Approve is our riskiest action.
- **Fix:**
  - Call `getUser(token)`, then `checkStepUp` (`knowledge/security-engineer/examples/01`): a `password` or `oauth` `amr` entry no more than 10 min old, `last_sign_in_at` no more than 10 min old, and `aal2` if the user has a verified factor. Otherwise return 401 `step_up_required`, and the UI asks the user to sign in again.
  - Never accept a fresh `totp` entry on its own: a thief could enrol a factor.
  - Test it with a fixed clock.

### M2: No Origin / Fetch Metadata check on POST (Medium)
- **Where:** `approve.mts` reads neither `Sec-Fetch-Site` nor `Origin`.
- **Exploit scenario:** today this is not exploitable. The Bearer token isn't sent automatically, and we send no CORS headers, so another site can't make an authorised cross-origin POST. But a later change that adds `Access-Control-Allow-Origin` for "debugging", or one that moves the token into a cookie, would silently reopen CSRF. A two-line check keeps that door shut.
- **Fix:**
  - `checkOrigin(req, process.env.URL)` (example 01): reject `Sec-Fetch-Site` when present and not `same-origin`, and reject `Origin` when present and not the site URL. → 403.
  - Assert in a test that no `/api/*` response has any `Access-Control-Allow-*` header.

### L1: GitHub error bodies are returned to the browser (Low)
- **Where:** the `lib/github.mts` error path does `return json(502, {error: e.data})`.
- **Exploit scenario:** this isn't a secret leak by itself, because GitHub never echoes the token. But it exposes internal URLs and messages and makes the UI depend on GitHub wording.
- **Fix:**
  - Map errors to `{code: "stale"|"github_busy"|"push_protection"|"github_auth"}`.
  - Log `status` plus `x-github-request-id` only.
  - For 403/429 with `retry-after`, return `github_busy` with the number of seconds.

### L2: Commit author email (Low / hygiene)
- **Where:** `author.email` is set to Dr. Lee's personal address.
- **Risk:** a personal email in every agent commit on a public repo.
- **Fix:** use a non-routable address such as `agent@beachday.invalid` or the GitHub noreply address. The agent name stays in `author.name`.

## Checked and fine
- **Secrets:**
  - `GITHUB_TOKEN` is read inside the handler and never logged.
  - No `console.log(req)`.
  - The response never includes env values.
  - The token is a Production-context secret (ADR-0005), and the function also refuses with 503 `unavailable` when `context.deploy.context` is not `production`, before touching GitHub (docs/04 §4.6).
- **Git:**
  - `POST /git/trees` always sends `base_tree`.
  - Entries are `mode: "100644", type: "blob"` only.
  - `PATCH` sends `force: false`, with one retry on 409/422 and then `stale`.
- **GitHub requests:** all five headers are set (`Authorization: Bearer`, `Accept`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent`, `Content-Type`), and the requests are serial.
- **Response headers:** `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Content-Type: application/json` on every return path, including errors.
- **Rate limits:** the site-wide Approve cap (ADR-0008: 14 per rolling 31 days, 5 per day) is checked inside the approve lock, before any GitHub call.

## Tests required before merge
| Test | Expect |
|---|---|
| No Bearer token / bad signature / expired | 401 |
| Valid token, role `user` | 403 |
| Supabase unreachable | 503 |
| `Sec-Fetch-Site: cross-site` or foreign `Origin` | 403 |
| Last primary sign-in 11 min ago | 401 `step_up_required` |
| Stored proposal touching `netlify.toml` | 403, no GitHub call |
| Stored proposal containing a generated `github_pat_…` fixture | 422, no GitHub call |
| Hash mismatch | 409 |
| Two concurrent approves | one 200, one 409, one ref PATCH |
| Mock GitHub 422 twice on PATCH | `stale`, proposal stays `pending` |
| Mock GitHub 403 + `retry-after: 30` | `github_busy`, 30 s shown |

```
HANDOFF
status: needs-review
summary: Reviewed approve.mts + lib/github.mts v1. Verdict APPROVE WITH CHANGES.
  Must fix before merge: H1 (re-validate allow-list/secret scan/content hash at approve),
  H2 (CAS status + in-flight lock), M1 (getUser + 10-min step-up), M2 (Sec-Fetch-Site/Origin check).
files: none changed by security-engineer (review only)
tests: none run on the real diff (sample); listed required tests above
needs: agent-console-engineer — apply H1, H2, M1, M2 and add the tests; qa-engineer — own the test table;
  netlify-engineer — confirm GITHUB_TOKEN is Production-context only and previews return not_configured
risks/questions: Supabase access tokens cannot be revoked before exp (10 min); whether getUser rejects a
  signed-out session is UNVERIFIED and is a pre-launch test on the real project.
```
