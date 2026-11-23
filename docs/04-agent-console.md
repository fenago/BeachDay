# 04 — Agent Console: design, security and long-running jobs

> The Agent Console is a page inside the deployed Beach Day app. It (1) lists every agent in `.claude/agents` with name, model and personality, (2) lets the user chat with any agent — Claude is called **only** from a Netlify Function with the key in an env var — and (3) lets an agent **propose** code changes that are committed to GitHub **only after the user clicks Approve**, which triggers a Netlify redeploy.
>
> Researched 2026-11-23. Companion docs: 03 (Netlify), 05 (Claude API). **[UNVERIFIED]** = not confirmed in primary docs.

## 1. User flow

1. Open `/console` → password screen → session cookie.
2. Agent list (cards): name, `personality` (or `description`), model badge, color.
3. Pick an agent → chat. Replies stream in. The agent can read repo files (read-only tools).
4. The agent calls `propose_change` → the Console shows a **proposal card**: summary, file list, unified diff per file, "allowed path" checks, size.
5. User clicks **Approve** (or Reject). Approve re-validates on the server, commits to `main` as **one atomic commit**, shows the commit link, then "Deploying…" → "Live" (from a deploy-succeeded event or polling).
6. Every action lands in an audit log.

## 2. Endpoints (Netlify Functions)

Auth on **every** route (ADR-0006): `Authorization: Bearer <Supabase access token>`, verified, then `role === 'super_admin'` read from `profiles` as the caller. Fail closed: `401` no/bad token, `403` wrong role or no row, `503` Supabase unreachable. Sign-up, log-in, log-out and password reset happen in the browser against Supabase Auth — there is **no** `/api/login` or `/api/logout`. Details of the check and step-up: §4 (security-engineer).

| Route | Type | Auth | Purpose |
|---|---|---|---|
| `GET /api/agents` | sync | Bearer + super_admin | Agent list from bundled `agents.json` (no system prompts). A `403` here is how the Console shows "no access" |
| `POST /api/chat` | sync, **streaming** | Bearer + super_admin | One chat turn; SSE back to browser (≤60 s); may end in `handoff` |
| `POST /api/jobs` | sync | Bearer + super_admin | Check limits, create job `j_…` with a single-use nonce, trigger `/api/jobs-run`; returns `202 {jobId}` |
| `POST /api/jobs-run` | **background** (≤15 min) | Bearer + super_admin + job nonce | Internal: called only by `/api/jobs` and the `/api/chat` handoff. Re-checks token and role, consumes the nonce (CAS), runs the job, writes progress to Blobs |
| `GET /api/jobs/:id` | sync | Bearer + super_admin | Poll job status/events |
| `GET /api/proposals/:id` | sync | Bearer + super_admin | Proposal + diff |
| `POST /api/proposals/:id/approve` | sync | Bearer + super_admin + step-up (§4) | Body `{contentHash}`; re-validate, cap check (ADR-0008), commit to GitHub |
| `POST /api/proposals/:id/reject` | sync | Bearer + super_admin | Mark rejected |

Background functions can't answer the caller (they return `202` immediately), so the **sync** `/api/jobs` wrapper checks auth and limits and creates the job record, including a random 256-bit nonce. It then calls `/api/jobs-run`, forwarding the caller's `Authorization` header and `{jobId, nonce}`. The background function repeats the token and role check, consumes the nonce with a compare-and-swap, and does nothing if either check fails. No shared signing secret is needed. Deploy status needs no function: the Console polls `/version.json` (ADR-0006 §8, docs/03).

### 2.1 Shared contracts (builders code against these)

**IDs:** `p_<ULID>` for proposals, `j_<ULID>` for jobs, matching `^[pj]_[0-9A-Z]{26}$`. Functions reject any other `:id` with `400` before touching Blobs.

**Proposal status:**

```
pending ──approve──► committing ──► committed
   │                     ├────────► failed   (GitHub error; error recorded; terminal)
   │                     └────────► stale    (main moved under a file the agent read; terminal)
   ├──approve finds base moved──► stale
   └──reject──► rejected
```

Every transition is a Blobs compare-and-swap (`onlyIfMatch`). `committing` is the per-proposal lock. A record stuck in `committing` for more than 120 s is reconciled by the next GET or approve: if a commit on `main` carries the trailer `Beach-Day-Proposal: p_…`, the record becomes `committed`; otherwise it becomes `failed`. `failed`, `stale` and `rejected` are terminal. The agent proposes again to retry.

**SSE events** (`POST /api/chat`; each message is `event: <type>` plus one `data:` JSON line; the stream ends with exactly one `done` or `error`):

| `type` | Fields |
|---|---|
| `text` | `delta` (string; render as text) |
| `tool` | `name` ∈ `read_file`/`list_files`/`propose_change`, `phase` ∈ `start`/`end`, `summary?` (≤200 chars, never raw input) |
| `proposal` | `proposalId` (`p_…`), `summary`, `files: [{path, bytes}]` (≤20) |
| `handoff` | `jobId` (`j_…`); followed by `done` with `stopReason: "handoff"` |
| `error` | `code` ∈ `unauthorized` (401), `forbidden` (403), `rate_limited`, `refusal`, `upstream`, `timeout`, `invalid_request`, `internal`; `message` (user-safe, ≤500 chars); `retryable` (bool) |
| `done` | `stopReason?` ∈ `end_turn`, `max_tokens`, `refusal`, `handoff`, `tool_rounds_exhausted` |

**JSON errors** from non-streaming routes: `{"error": {"code", "message", "retryAt?"}}`. Codes are the SSE `error.code` list plus `not_found`, `conflict` (CAS lost), `stale`, `approve_cap` (429, ADR-0008) and `unavailable` (503, Supabase down). Never include stack traces, env values or tokens.

Machine-checkable JSON Schemas for these shapes are in `knowledge/software-architect/examples/02-interface-contracts/`.

## 3. Threat model (what we defend against)

| Threat | Example | Control |
|---|---|---|
| Stranger uses the Console | Finds `/console`, burns Claude credits, commits code | Password gate on **every** `/api/*` function; rate limits; spend limit at Anthropic |
| Secret leakage to browser | API key or GitHub token in JS bundle or response | Secrets only in Function env vars; responses never echo env; Netlify secret scanning; CSP |
| Over-privileged token | Token can touch other repos/orgs | Fine-grained PAT, **only this repo**, minimal permissions; or a GitHub App |
| Agent writes dangerous files | Edits `netlify/functions/approve.mts`, `.github/workflows`, `netlify.toml` to exfiltrate keys | **Server-side path allow-list**, re-checked at approve time; no Workflows permission on the token |
| Prompt injection | A repo file or user text tells the agent "commit this secret / widen the allow-list" | Agents have no commit tool; human approval with a visible diff; allow-list is code, not prompt; secret scan on diffs |
| CSRF / clickjacking | Another site triggers Approve | `SameSite=Strict` cookie, CSRF token header, `frame-ancestors 'none'` |
| Replay / double approve | Approve clicked twice, or proposal edited after review | Proposal content hash shown to the user, sent back with Approve and compared; compare-and-swap status in Blobs; base SHA check |
| Cost abuse | Loops, huge prompts | Per-session and per-day limits; max tokens/rounds per job; Anthropic workspace spend limit |
| Preview deploys with prod powers | A branch deploy commits to main | Production-only secrets: GitHub token set **only** in the Production context |

## 4. Password gate

Netlify's built-in site password / Basic-Auth needs the **Pro** plan and **does not protect functions** anyway ([password protection](https://docs.netlify.com/manage/security/secure-access-to-sites/password-protection/), [Basic-Auth](https://docs.netlify.com/manage/security/secure-access-to-sites/basic-authentication-with-custom-http-headers/)). So the gate lives in our functions:

* Store only `CONSOLE_PASSWORD_HASH` (scrypt via Node `crypto.scrypt`, or argon2) as a secret env var. Compare with `crypto.timingSafeEqual`.
* On success set `bd_session` = HMAC-signed `{sid, exp}` (key `SESSION_SECRET`), flags `HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=28800` (8 h). Use `context.cookies.set`.
* Every `/api/*` function starts with `requireSession(req, context)`; unauthenticated → `401`.
* **Login throttling:** 5 failed attempts per IP per 15 min (Blobs counter) plus Netlify `config.rateLimit` on `/api/login`.
* **Re-auth for Approve** (optional but recommended): ask for the password again (or a short PIN) within the last 10 min before committing — satisfies "step-up" for the riskiest action. WCAG 3.3.8: allow paste and password managers.
* Alternative if multiple people need access: **Netlify Identity** (free on credit-based plans, invite-only, roles, server-side verification via `@netlify/identity`) — [Identity](https://docs.netlify.com/manage/security/secure-access-to-sites/identity/overview/). Start with a single password; move to Identity if a second user is added.

## 5. GitHub token: least privilege

Source: [fine-grained PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), [permissions per endpoint](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).

* Settings → Developer settings → Personal access tokens → **Fine-grained** → Resource owner `fenago` → Repository access **Only select repositories → BeachDay**.
* Permissions: **Contents: Read and write** (contents API, blobs, trees, commits, refs). Metadata read is required/added automatically (**[UNVERIFIED]** in the pages read). Add **Pull requests: write** only if using the PR flow. **Do not grant Workflows** — without it the token cannot change `.github/workflows/*`.
* Expiration: GitHub now allows no-expiry tokens unless an org policy forbids it; set **90 days** anyway and rotate (calendar reminder; `netlify env:set GITHUB_TOKEN … --secret`).
* Fine-grained PATs **cannot be limited to paths or branches**. GitHub's "restrict file paths" **push rulesets** exist but only for private/internal repos on GitHub Team+ ([rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)). → The **allow-list must be enforced in our function**.
* Still add a ruleset on `main` (available on Free public repos): block force pushes, restrict deletions.
* Store as secret env var `GITHUB_TOKEN`, **Production context only**, Functions scope (scopes need Pro; on Free keep the build script from printing env).
* **Decided (ADR-0005): fine-grained PAT.** A GitHub App remains the documented upgrade path:
* Upgrade path: a **GitHub App** installed on just this repo, with installation tokens that **expire after 1 hour** and can be narrowed per request ([installation tokens](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app)). Commits show as a bot, and the app can be a separate actor in rulesets. Cost: a private key in env + JWT minting (`@octokit/auth-app`).

## 6. Path allow-list

Single source of truth in `netlify/functions/lib/allowlist.mts`, enforced at proposal time **and again at approve time**. This is the **canonical list**; the `change-proposal-protocol` skill and the contract schema mirror it.

```ts
// Text types only under public/ (the extension check is in addition to the content check below)
export const TEXT_EXT = ["html", "css", "js", "json", "webmanifest", "svg", "txt", "md"];
export const ALLOW = [
  "public/**",               // only files whose extension is in TEXT_EXT
  "tests/**",
  "docs/**",
  ".claude/agents/*.md",
  ".claude/skills/**/*.md",
];
export const DENY = [        // DENY wins over ALLOW
  "public/_headers",         // CSP and security headers
  "public/_redirects",
  "public/sw.js",            // and everything it imports (see the convention below)
  "public/sw/**",
  "public/vendor/**",        // vendored @supabase/auth-js (ADR-0006)
  "public/generated/**",     // build output: config.js (ADR-0006)
  "public/version.json",     // build output (docs/03 §9)
  "netlify/**",              // functions, including this allow-list and approve
  "netlify.toml",
  ".github/**",
  "package.json", "package-lock.json",   // dependency changes = supply-chain risk
  "scripts/**",              // build scripts run with env access
  "**/.env*",
  ".git/**", ".gitmodules",
  ".claude/settings*",       // matches .claude/settings.json and settings.local.json
  "**/*.pem", "**/*.key",
];
```

**Still open (Dr. Lee):** security-engineer recommends also denying `public/console.html` and `public/js/console/**`. They are allowed until he rules.

**Service worker convention:** `public/sw.js` may load other code only from `public/sw/**` (`importScripts("/sw/…")`). That makes "sw.js and every file it imports" a static deny rule. pwa-mobile-engineer owns the convention, and a unit test fails if `sw.js` references any other path.

Rules:
- Normalise paths first. Reject `..`, absolute paths, backslashes, a leading `./`, symlink mode `120000` and submodules.
- Match case-insensitively, so `Netlify.toml` is denied.
- DENY wins over ALLOW.
- At most 20 files, and at most 200 KB per file.
- **Text only:** contents must decode as UTF-8 with no NUL bytes, whatever the path.
- Run a **secret scan** on new contents. Patterns: `sk-ant-`, `github_pat_`, `ghp_`, `sb_secret_`, `service_role`, JWT-shaped `eyJ…` strings and private-key blocks.
- Changes to denied paths are made by a human in a normal git workflow.
- GitHub **push protection** applies to REST API commits and may reject a commit that contains a secret. Show that error in the UI ([push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection)).

## 7. Commit on Approve (atomic, multi-file)

Use the **Git Database API**, not the Contents API: one commit for N files (one Netlify deploy, 15 credits, instead of N), and no parallel-PUT conflicts (GitHub says Contents PUT/DELETE must be called serially). Sources: [refs](https://docs.github.com/en/rest/git/refs), [commits](https://docs.github.com/en/rest/git/commits), [trees](https://docs.github.com/en/rest/git/trees), [blobs](https://docs.github.com/en/rest/git/blobs).

```
0. Auth + role + step-up (§2, §4). Validate the id (^p_[0-9A-Z]{26}$).
   Take the site-wide approve lock (Blobs `approve-lock`, onlyIfNew; a lock older than 90 s may be taken over with onlyIfMatch).
   Load the proposal: status must be "pending". Recompute its content hash and COMPARE it with the
   `contentHash` the client sent (the hash the user saw). Mismatch → 409 conflict.
   Check the cap (ADR-0008): over → 429 approve_cap, status stays "pending".
   Re-run the allow-list, size, text-only and secret-scan checks (§6).
   CAS status "pending" → "committing".
1. GET  /repos/fenago/BeachDay/git/ref/heads/main             → headSha
2. If headSha ≠ proposal.baseSha: for each file, compare the current blob SHA on main with
   readBlobSha (null = the file must still not exist). Any difference → CAS "stale"; the agent proposes again.
3. GET  /repos/.../git/commits/{headSha}                       → baseTreeSha
4. POST /repos/.../git/trees  { base_tree: baseTreeSha,
        tree: [{path, mode:"100644", type:"blob", content}, …] }   → treeSha
        (ALWAYS send base_tree — omitting it deletes every other file)
5. POST /repos/.../git/commits { message (ends with the trailer "Beach-Day-Proposal: p_…"),
        tree: treeSha, parents:[headSha], author:{name:"Beach Day Agent (<agent>)", email:"…"} } → commitSha
6. PATCH /repos/.../git/refs/heads/main { sha: commitSha, force:false }
        (not fast-forward → main moved → redo steps 1–6 once, else CAS "stale")
7. CAS "committing" → "committed" {commitSha, decidedAt}; append to the approve cap record;
   write the audit record (actor = Supabase user id); release the lock.
   Any GitHub error in 1–6 → CAS "failed" {error}; release the lock.
```

**Where the agent's reads come from (ADR-0007):** `read_file` and `list_files` read from GitHub `main`, pinned to the `main` head SHA resolved at the start of the turn or job. `propose_change` records that SHA as `baseSha`, and each file's blob SHA as `readBlobSha` (`null` for a new or unread file). The read tools refuse `.env*`, `*.pem`, `*.key`, `.git/**`, non-UTF-8 files and files over 200 KB. They use a read-only GitHub module, and only the approve function can write.

Headers: `Authorization: Bearer $GITHUB_TOKEN`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` (supported until 10 Mar 2028; a newer `2026-03-10` exists — read its changelog before switching; [API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions)). Make requests **serially**; GitHub's secondary limits allow ≤80 content-creating requests/min and ≤500/hour ([rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)); honor `retry-after`.

Netlify auto-deploys the push to `main` ([deploy overview](https://docs.netlify.com/deploy/deploy-overview/)). Show deploy status without a function (ADR-0006 §8): after `committed`, the Console polls `/version.json` (`no-store`, never cached by the service worker) every 10 s until `commit` equals `commitSha` → "Live". After 10 min it shows "Still deploying — check Netlify". Rollback = "Publish deploy" on the previous deploy in Netlify (instant), or a revert commit.

**Decided (ADR-0003): Approve commits straight to `main`** using the steps above. The PR flow below is recorded as a future option only.

**Future option (not adopted) — preview before production.** Step 6 becomes "create `refs/heads/agent/<id>` + open a PR"; Netlify builds a Deploy Preview; QA checks run there; Approve then merges with `PUT /pulls/{n}/merge` passing the reviewed head `sha` (409 if the head changed). Needs Pull requests: write. Note a PAT acts as you, so you can't "approve" your own PR in GitHub — use required status checks with 0 required approvals, or a GitHub App. Recommended once the app has real users.

## 8. Long agent jobs vs Netlify time limits

Netlify: synchronous and **streaming** functions stop at **60 s**; **background** functions run up to **15 min**, return `202` immediately, can't stream, are retried after 1 and 2 min on failure ([limits](https://docs.netlify.com/build/functions/configuration/#default-values), [background](https://docs.netlify.com/build/functions/background-functions/)).

| Job | Where it runs | How the UI gets output |
|---|---|---|
| Chat turn (most messages) | `/api/chat` streaming function | SSE events directly |
| Turn that needs many tool rounds / multi-file proposal | `/api/jobs` background function | Poll `/api/jobs/:id` every 2–3 s; Blobs holds an append-only event list |
| Anything > 15 min | Split into steps, or move to Claude Managed Agents (doc 05 §9) | Poll |

Patterns:

* **Time budget in code:** `/api/chat` tracks elapsed time; at ~45 s with work remaining it saves the conversation state (full `messages`, including tool_use/tool_result blocks) to Blobs, emits `{type:"handoff", jobId}`, and kicks off the background function to continue. The UI switches to polling seamlessly.
* **Anthropic SDK timeout** under the platform limit (`timeout: 50_000` ms in chat; `840_000` in background) and `maxRetries` low so retries don't overrun.
* **Idempotency:** background functions may be retried — key each job by ID, check status before doing work, write step results with `onlyIfNew`, never commit from a job (commits only happen in Approve).
* **Caps per job:** max tool rounds (e.g. 15), `max_tokens`, optional Claude task budget; job wall-clock check at 14 min → save partial state + "paused, continue?".
* **Streaming format to the browser:** simplified SSE events (`text`, `tool`, `proposal`, `handoff`, `error`, `done`). Set `content-type: text/event-stream`, `cache-control: no-store`. Netlify's streaming limit is 20 MB per response.
* **Blobs consistency:** use `strong` for job and proposal records (eventual can lag up to 60 s).

## 9. Rate limits & cost controls

| Layer | Limit (starting values) |
|---|---|
| Netlify `config.rateLimit` (code-based, all plans; 2 rules on Free) | `/api/login` 10/min per IP; `/api/chat` 20/min per IP. `windowSize` max 180 s. Over limit → `429`. [rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/) |
| App counters in Blobs (CAS) | 100 chat turns/day, 20 jobs/day per session (security-engineer is reworking these per user id) |
| **Approve cap (ADR-0008)** | **Site-wide, all users:** at most **14** committed approvals in any rolling 31 days and **5** per America/New_York day. Checked inside the approve lock; over → `429 approve_cap`, proposal stays `pending` |
| Per request | `max_tokens` cap; ≤15 tool rounds; input size cap (e.g. 32 KB user message) |
| Anthropic | Dedicated workspace with a low monthly **spend limit** (hard stop) |
| GitHub | Serial requests; ≤1 approve in flight (CAS lock in Blobs) |
| Netlify credits | ~20 production deploys/month on Free — batch changes; ignore docs-only builds |

## 10. Headers & browser-side rules

* Functions must set their own headers (Netlify `_headers` doesn't apply to function responses): `Cache-Control: no-store`, `Content-Type`, `X-Content-Type-Options: nosniff`.
* Static CSP for the Console: `connect-src 'self'` (the Console talks only to `/api/*`), `script-src 'self'` (no inline), `frame-ancestors 'none'`.
* Render agent output as **text**, or Markdown through a sanitizer — never `innerHTML` raw model output. Render diffs as text.
* The service worker must **never cache** `/api/*`.
* Never log request bodies containing the password; log `context.requestId`, agent, proposal ID, commit SHA.

## 11. Agent list & personality

`scripts/build-agents.mjs` parses `.claude/agents/*.md` (YAML frontmatter + body) into `agents.json` at build time. `/api/agents` returns `name`, `persona` (first name), `description`, `personality` (custom field — Claude Code ignores unknown fields), `model` (alias → resolved ID), `color`. System prompts stay server-side. Because approved commits redeploy, edits to agent files appear in the Console after the next deploy. Details: doc 05 §3.

## 12. Build checklist for `agent-console-engineer` + `security-engineer`

- [ ] All `/api/*` call `requireSession`; tests prove 401 without cookie.
- [ ] No secret appears in any response, log, or bundle (test greps build output).
- [ ] Allow-list unit tests: `..`, absolute, backslash, denied dirs, case tricks (`Netlify.toml`), symlink mode.
- [ ] Approve re-validates allow-list, size, secret scan, content hash, status CAS.
- [ ] Always `base_tree`; `force:false`; stale-base handling.
- [ ] GitHub token only in Production context; previews cannot commit.
- [ ] Chat stays < 60 s; handoff to background works; background idempotent.
- [ ] Rate limits return 429 with a friendly UI message.
- [ ] CSP, `SameSite=Strict`, CSRF header verified in e2e.
