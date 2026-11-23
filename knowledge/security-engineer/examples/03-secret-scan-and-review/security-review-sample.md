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

### M1: No step-up re-auth on Approve (Medium)
- **Where:** `approve.mts` calls `requireSession` only.
- **Exploit scenario:** someone gets brief access to an unlocked laptop with a live 12 h session. They approve a pending proposal, which goes to production. OWASP Session Management calls for "Reauthentication After Risk Events". Approve is our riskiest action.
- **Fix:**
  - Require `recentlyAuthenticated(claims) ≤ 10 min`. Otherwise return 401 with `{reauth: true}`, and the UI asks for the password again.
  - Allow paste and password managers (WCAG 3.3.8).
  - Test it with fake timers.

### M2: CSRF defence relies on SameSite only (Medium)
- **Where:** `approve.mts` has no `X-BD-CSRF` or `Origin` check.
- **Exploit scenario:** `SameSite=Strict` blocks the classic cross-site POST. But OWASP lists SameSite as defence in depth only, and a same-*site* origin (another app on a sibling subdomain of a custom domain) is not cross-site.
- **Fix:**
  - Verify the `X-BD-CSRF` HMAC token bound to `sid` (`verifyCsrf`).
  - Reject when `Sec-Fetch-Site` is present and not `same-origin`.
  - Fall back to an exact `Origin` match with the site URL (`process.env.URL`).
  - Test: a bad token gets 403, `Origin: https://evil.example` gets 403, and a missing header gets 403.

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
  - The token is a Production-context secret (ADR-0005). Deploy Previews get 500 `not_configured`, which is correct.
- **Git:**
  - `POST /git/trees` always sends `base_tree`.
  - Entries are `mode: "100644", type: "blob"` only.
  - `PATCH` sends `force: false`, with one retry on 409/422 and then `stale`.
- **GitHub requests:** all five headers are set (`Authorization: Bearer`, `Accept`, `X-GitHub-Api-Version: 2022-11-28`, `User-Agent`, `Content-Type`), and the requests are serial.
- **Response headers:** `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, and `Content-Type: application/json` on every return path, including errors.
- **Rate limits:** the Blobs counter for 10 approvals per session per day is checked before any GitHub call.

## Tests required before merge
| Test | Expect |
|---|---|
| No cookie | 401 |
| Bad CSRF / foreign Origin | 403 |
| Session older than 10 min since password | 401 `{reauth:true}` |
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
  H2 (CAS status + in-flight lock), M1 (10-min step-up), M2 (CSRF token + Sec-Fetch-Site/Origin).
files: none changed by security-engineer (review only)
tests: none run on the real diff (sample); listed required tests above
needs: agent-console-engineer — apply H1, H2, M1, M2 and add the tests; qa-engineer — own the test table;
  netlify-engineer — confirm GITHUB_TOKEN is Production-context only and previews return not_configured
risks/questions: Stateless cookies cannot be revoked before exp; if Dr. Lee wants "log out everywhere",
  add a sid deny-list in Blobs (escalate as a product decision).
```
