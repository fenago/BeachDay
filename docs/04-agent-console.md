# 04 — Agent Console: design, security and long-running jobs

> The Agent Console is a page inside the deployed Beach Day app. It (1) lists every agent in `.claude/agents` with name, model and personality, (2) lets the user chat with any agent — Claude is called **only** from a Netlify Function with the key in an env var — and (3) lets an agent **propose** code changes that are committed to GitHub **only after the user clicks Approve**, which triggers a Netlify redeploy.
>
> Researched 2026-11-23. Companion docs: 03 (Netlify), 05 (Claude API). **[UNVERIFIED]** = not confirmed in primary docs.

## 1. User flow

Owner: agent-console-engineer. Screens, copy and focus rules: Wren's spec, `knowledge/ux-designer-apple-hig/examples/04-console-auth/flow-spec.md` (S1–S9; string ids in its copy deck). Security mechanisms: §4 (this section only says what the browser does with them). The wording is **"Sign in"**, never "log in".

**Who gets in (Dr. Lee, 2026-11-23).** Sign-up stays open: anyone can create an account, and everyone can use the beach app with or without one. A signed-in account without `super_admin` sees "no access" only on the Console's Agents page; chat, jobs, proposals and Approve are refused with `403` by the functions (§2, §4.1). The browser never reads `profiles` (ADR-0006 point 6).

1. **Sign in.** `/console` with no Supabase session shows S1 (email and password, or "Continue with Google"; sign up, confirm email, reset password are S2–S5). Sessions are Supabase's (§4.3). There is no password of ours, no cookie and no `/api/login`.
2. **Checking your access.** With a session, the Console calls `GET /api/agents`, which is the access check. While it runs, the Agents page shows skeleton cards with `aria-busy="true"` on the list and the status line "Checking your access…" (`role="status"`, copy id `console.checking`). The call has a 10 s `AbortController` timeout; a timeout is treated like `503`.
   - `200` → agent cards: name, persona, `personality` (or `description`), model badge, colour (§11).
   - `401` → S7 "Session ended" (see the response table below).
   - `403` → S6 "This account can't use Agents" (heading pending Dr. Lee; fallback "This account can't use the Console"). The browser makes no more `/api/*` calls from that screen.
   - `503` → "Couldn't check your access. Try again in a minute." with Try Again (`role="alert"`). A `503` never shows S6.
3. **Chat.** Pick an agent; replies stream into a `role="log"` list, and the streaming bubble has `aria-busy="true"` until `done` or `error`. Tool activity shows as one-line `tool` events, never raw input. A `refusal` removes the partial bubble and shows a plain message. On `handoff` the UI polls `GET /api/jobs/:id` every 2–3 s (§8).
   - **Draft and transcript are memory-only.** The composer text and the chat transcript live in JS memory and the DOM. They are never written to `localStorage`, `sessionStorage`, IndexedDB, the service worker or a URL, because they may hold sensitive text. They survive in-page screens (S7 with email sign-in, the Approve sheet) but not a full-page navigation. Before a Google redirect (sign-in or step-up) with text in the composer, the Console says the unsent message will be cleared (Wren owns the copy). After a redirect, an open proposal is restored from the server using only its id, kept in `sessionStorage` across the redirect (step 5); the id only navigates, it never acts (§4.4).
   - **Fresh token before long calls.** Before `POST /api/chat` and `POST /api/jobs` the client refreshes the session if the access token has less than 120 s left (rule in §4.1). It applies the same rule before every other `/api/*` call, because it costs nothing and avoids a needless S7.
4. **Proposal card.** When the agent calls `propose_change`, the card shows: a heading with the summary; the file list with sizes; a unified text diff per file with `+`/`−` markers as well as colour; the first 8 characters of `contentHash`; the §6 warnings (`public/**/*.js` and `*.html`, `.claude/**`, `tests/**`); and whether the change deploys (below). Buttons have explicit names ("Approve proposal: …", "Reject proposal: …"). Model output, file contents, diffs and Supabase errors are rendered with `textContent` only (§10).
5. **Approve sheet** (S8, a `<dialog>` opened with `showModal()`). It is built from `GET /api/proposals/:id` (`{proposal, diffs[], deploys, approveEnabled, approvals}`, §2.1). It shows the consequence line (chosen by `deploys`), the usage line "{used31} of 14 approvals used in the last 31 days" from `approvals` (advisory; omitted when `approvals` is `null` because the Blobs read failed, which never blocks Approve), and "Confirm it's you" (§4.2). If `approvals.retryAt` is not `null`, no slot is free now: the card goes straight to S9 instead of opening the sheet. Approve sends `{contentHash}` with the current token.
   - `401 step_up_required` → the sheet stays open in the unconfirmed state. Password path: `signInWithPassword` then Approve again in the same sheet. Google path: `signInWithOAuth` with `redirectTo` exactly `<origin>/console` (no `#`, no query); before leaving, the Console keeps only the proposal id in `sessionStorage` (§4.2). On return it reads and deletes that id, re-validates it (`^p_[0-9A-Z]{26}$`), loads the proposal, reopens the sheet confirmed, and the person clicks Approve again. Nothing approves from a URL or from storage.
   - **Approve off before launch** (S10): until the §4.2 pre-launch tests pass, `GET /api/proposals/:id` returns `approveEnabled: false`, the approve function refuses with `503 unavailable` whatever the client does, and the card shows Review and Approve with `aria-disabled="true"` plus the reason. Reject still works. The switch is a server constant reviewed by security-engineer, not a client flag.
   - `429 approve_cap` → S9: the cap message (`role="alert"`), "The proposal is still waiting.", Review and Approve hidden until `retryAt`, Reject kept.
   - `409 conflict` (hash mismatch or a second Approve) → reload the proposal and show its current status.
   - **`stale` is a card state, not the 409.** Whenever the loaded proposal's status is `stale` (found at Approve or by an earlier one), the card shows "Out of date: main changed after this proposal. No approval was used." with no Approve or Reject button (`stale` is final). The agent proposes again.
6. **Outcome** (all `role="status"`):
   - "Committing to main…" while the request runs.
   - **Deploys:** "Committed {sha}. Deploying…" plus the commit link, then **Live**: the Console polls `GET /version.json` with `cache: "no-store"` every 10 s (paused while the tab is hidden) and shows "Live. The change is on the site." when `commit` equals the full `commitSha`. After 10 minutes it shows "Still deploying. Check Netlify." and stops polling (§7). A 404 or bad JSON from `/version.json` counts as "not yet".
   - **No deploy needed:** "Committed {sha}. No deploy needed." and no Live step (finished state).
7. **Reject** marks the proposal `rejected` (CAS). Every proposal, approve, step-up failure, reject and commit result lands in the audit log (actor = Supabase user id).

**"No deploy needed" uses the build's own path list.** A commit deploys if any changed path is under one of the paths in Nell's `ignore` command (docs/03 §3.1): `public`, `netlify`, `netlify.toml`, `package.json`, `package-lock.json`, `scripts`, `.claude/agents`. Of the agent-writable paths, only `public/**` and `.claude/agents/*.md` deploy; a proposal that touches only `docs/**`, `tests/**` or `.claude/skills/**` does not.
- One constant, `DEPLOY_PATHS`, in `netlify/functions/lib/deploys.mts`, with `deploysOnCommit(paths)`. A unit test parses the `ignore` line in `netlify.toml` and fails if its path list differs from `DEPLOY_PATHS`, so the two can't drift.
- The server computes `deploys: true|false` and returns it with the proposal and the Approve result. The sheet then says before Approve "This commits to main. The live site doesn't change, so no deploy runs." and drops the credits line.
- **A no-deploy approval still uses one of the 14 slots** (ADR-0008 point 4), and the sheet says so next to the usage line (Wren to word it).
- If `deploys` is missing or unknown, the UI uses the deploy wording, which is the safe one. Whether Netlify charges 0 credits for a build skipped by `ignore` is UNVERIFIED (docs/03 §8.2).

**If recording the approval fails after the commit landed:** §7 step 7 and the reconciler decide; the browser only shows it. The response is still `200` with the `commitSha`, so the UI shows the normal outcome (Deploying… or No deploy needed) and the commit link. The proposal may read `committing` until the reconciler, running under the approve lock on the next GET or approve, finds a commit on `main` that passes the full §7 match (final-line trailer, exact author, one parent, equal blob SHAs), records the slot and marks it `committed`. A `502 upstream` from Approve means the outcome is not yet known: the UI shows "Couldn't confirm the commit yet." and re-loads the proposal (which runs the reconciler) instead of offering Approve again.

**How the Console handles `/api/*` responses** (one fetch wrapper in `public/js/console/api.js`; SSE `error` events with the same `code` are handled the same way):

| Response | What the Console does |
|---|---|
| `401` (`unauthorized`) | Auth runs before any work (§4.1), so nothing happened. Refresh the session once and resend the same request once. If the refresh fails or the second answer is `401` again: S7 "Your session ended. Sign in to pick up where you left off.", keeping the route, draft and transcript in memory |
| `401 step_up_required` | Only from Approve: keep the sheet open, unconfirmed (step 5). No refresh, no retry |
| `403` | S6. Stop all Console calls and polling. Never retried |
| `503` (`unavailable`) | "Couldn't check your access. Try again in a minute." with Try Again. Keep the draft, the transcript and any open proposal. Never S6 |
| `429` | `rate_limited`: say when to try again from `retryAt`; `budget_exhausted`: S11, keep the draft, Send `aria-disabled`; `approve_cap`: S9. Never retried automatically |
| `502` (`upstream`) | Chat and jobs: "The agent is unavailable right now", draft kept. Approve: "Couldn't confirm the commit yet." and re-load the proposal; **no Try Again** and never re-send Approve, because the commit may have landed (§7 reconciler) |
| network error or timeout | Same as `503`, with the offline wording if `navigator.onLine` is false |

**`budget_exhausted` (429, chat and jobs) carries `retryAt`, like every 429 (§2.1).** `checkComputeBudget()` derives it from the oldest New York day buckets in `site:compute` (netlify-engineer's design: docs/03 §7, `netlify-blobs` skill, example 03). If the record can't be read, the limit check fails closed with `503 unavailable`, not a 429. The UI keeps the no-date copy only as a fallback for a missing `retryAt`.

**Approve does not count against the compute budget.** The budget covers `/api/chat` and `/api/jobs-run` wall time only (§9). Approve is a few short GitHub calls, is limited by the Approve cap (ADR-0008) and the single approve lock, and is never refused with `budget_exhausted`. Reject, the proposal GET and job polling don't count either.

## 2. Endpoints (Netlify Functions)

Auth on **every** route (ADR-0006): `Authorization: Bearer <Supabase access token>`, verified, then `role === 'super_admin'` read from `profiles` as the caller. Fail closed: `401` no/bad token, `403` wrong role or no row, `503` Supabase unreachable. Sign-up, log-in, log-out and password reset happen in the browser against Supabase Auth — there is **no** `/api/login` or `/api/logout`. Details of the check and step-up: §4 (security-engineer).

| Route | Type | Auth | Purpose |
|---|---|---|---|
| `GET /api/agents` | sync | Bearer + super_admin | Agent list from bundled `agents.json` (no system prompts). A `403` here is how the Console shows "no access" |
| `POST /api/chat` | sync, **streaming** | Bearer + super_admin | One chat turn; SSE back to browser (≤60 s); may end in `handoff` |
| `POST /api/jobs` | sync | Bearer + super_admin | Check limits, create job `j_…` with a single-use nonce, trigger `/api/jobs-run`; returns `202 {jobId}` |
| `POST /api/jobs-run` | **background** (≤15 min) | Bearer + super_admin + job nonce | Internal: called only by `/api/jobs` and the `/api/chat` handoff. Re-checks token and role, consumes the nonce (CAS), runs the job, writes progress to Blobs |
| `GET /api/jobs/:id` | sync | Bearer + super_admin | Poll job status/events |
| `GET /api/proposals/:id` | sync | Bearer + super_admin; production-context check before the reconciler | Proposal + diff, plus `deploys`, `approveEnabled` and the read-only `approvals` usage (§2.1). Also runs the `committing` reconciler (§7), which reads GitHub, so it first checks `context.deploy.context === "production"` (else `503 unavailable`, §4.6) and uses **only the read-only GitHub module** (`GITHUB_TOKEN` read-only module under ADR-0007; `github-read.mts` with `GITHUB_READ_TOKEN` under ADR-0009). It never imports a module that can write |
| `POST /api/proposals/:id/approve` | sync | Bearer + super_admin + step-up (§4) | Body `{contentHash}`. Under the site-wide approve lock: re-validate, **check** the cap (read-only, ADR-0008), commit to GitHub, then **record** the approval only once `main` has moved (§7) |
| `POST /api/proposals/:id/reject` | sync | Bearer + super_admin | Mark rejected |

Background functions can't answer the caller (they return `202` immediately), so the **sync** `/api/jobs` wrapper checks auth and limits and creates the job record, including a random 256-bit nonce. It then calls `/api/jobs-run`, forwarding the caller's `Authorization` header and `{jobId, nonce}`. The background function repeats the token and role check, consumes the nonce with a compare-and-swap, and does nothing if either check fails. No shared signing secret is needed. Deploy status needs no function: the Console polls `/version.json` (ADR-0006 §8, docs/03).

**Shared modules** in `netlify/functions/lib/` (one owner per rule, so handlers stay thin): `guard.mts` (§4.1 check), `ratelimit.mts` (§9 counters, `site:approvals`, `site:compute`), `github.mts` (§7), `claude.mts` (§8), `allowlist.mts` (§6), **`deploys.mts`** (`DEPLOY_PATHS` and `deploysOnCommit(paths)`, §1), and the generated `agents.json` (§11). `DEPLOY_PATHS` is exactly the `ignore` path list in docs/03 §3.1: `public`, `netlify`, `netlify.toml`, `package.json`, `package-lock.json`, `scripts`, `.claude/agents`. So of the agent-writable paths, `docs/**`, `tests/**` and `.claude/skills/**` never deploy; `public/**` and `.claude/agents/*.md` do. A unit test fails if the two lists differ.

### 2.1 Shared contracts (builders code against these)

**IDs:** `p_<ULID>` for proposals, `j_<ULID>` for jobs, matching `^[pj]_[0-9A-Z]{26}$`. Functions reject any other `:id` with `400` before touching Blobs.

**Proposal field names (canonical):** `baseSha` is the `main` head SHA pinned for the turn (ADR-0007); each file's `readBlobSha` is the blob SHA the agent read, or `null` for a new or unread file. Not `baseCommitSha` or `baseBlobSha`. Skills, examples and code use these names (`proposal.schema.json`).

**Proposal status:**

```
pending ──approve──► committing ──► committed
   │                     ├────────► failed   (GitHub error; error recorded; terminal)
   │                     └────────► stale    (main moved under a file the agent read; terminal)
   ├──approve finds base moved──► stale
   └──reject──► rejected
```

Every transition is a Blobs compare-and-swap (`onlyIfMatch`). `committing` is the per-proposal lock. A record stuck in `committing` for more than 120 s is reconciled by the next GET or approve, under the approve lock (§7 "Reconciler"): only a commit on `main` that passes the **full §7 match** (final line exactly `Beach-Day-Proposal: <id>`, author exactly `Beach Day Agent (<agent>)`, one parent, every blob SHA equal to the proposal content) counts, and then the approval is recorded in `site:approvals` and the record becomes `committed`. It becomes `failed` only if `main` was re-read successfully, the search window was fully seen (a page shorter than 50) and no commit matched; otherwise it stays `committing`. Carrying the trailer text alone never matches. `failed`, `stale` and `rejected` are terminal. The agent proposes again to retry.

**Invariant (ADR-0008): `committed` ⇒ counted.** A proposal is moved to `committed` only after its timestamp is in `site:approvals`. The cap may overcount by one in a rare crash (safe); it never undercounts a commit that reached `main`.

**SSE events** (`POST /api/chat`; each message is `event: <type>` plus one `data:` JSON line; the stream ends with exactly one `done` or `error`):

| `type` | Fields |
|---|---|
| `text` | `delta` (string; render as text) |
| `tool` | `name` ∈ `read_file`/`list_files`/`propose_change`, `phase` ∈ `start`/`end`, `summary?` (≤200 chars, never raw input) |
| `proposal` | `proposalId` (`p_…`), `summary`, `files: [{path, bytes}]` (≤20) |
| `handoff` | `jobId` (`j_…`); followed by `done` with `stopReason: "handoff"` |
| `error` | `code` from the error table below; `message` (user-safe, ≤500 chars); `retryable` (bool) |
| `done` | `stopReason?` ∈ `end_turn`, `max_tokens`, `handoff`, `tool_rounds_exhausted` (never `refusal`) |

**Refusals: one rule.** A Claude refusal (`stop_reason: "refusal"`, before or mid-stream) ends the stream with **one** `error {code: "refusal", retryable: false}` and **no** `done`. The UI removes the partial bubble and shows the plain message; the refusal category is logged, never shown. `done.stopReason` has no `refusal` value, so there is only one way to report it. A background job that hits a refusal appends the same `error` event and ends `failed`.

**Errors: one code list for JSON and SSE.** A JSON error body is `{"error": {"code", "message", "retryAt?"}}` (`retryAt` is ISO-8601 UTC, sent with every 429). `message` is user-safe and ≤500 chars. Never include stack traces, env values, tokens or upstream error bodies.

`/api/chat` rule: a check that fails **before the stream opens** (auth, role, Origin, body, per-user limits, compute budget) answers with the HTTP status and the JSON body below, with `content-type: application/json`. The client checks `res.ok` and the content type before parsing SSE. Once `200 text/event-stream` has been sent, failures arrive as one SSE `error` event with the same `code`.

| `code` | HTTP | Sent by | Meaning |
|---|---|---|---|
| `invalid_request` | 400 | all | Bad `:id` (§2.1 IDs), method, content type, size or body shape |
| `unauthorized` | 401 | all | Missing, invalid or expired token (§4.1). Nothing was done |
| `step_up_required` | 401 | approve | Token is valid but the sign-in isn't fresh enough (§4.2). Proposal stays `pending` |
| `forbidden` | 403 | all | Not `super_admin` or no profile row (§4.1), or a cross-site `Sec-Fetch-Site` / foreign `Origin` on POST (§4.4) |
| `not_found` | 404 | jobs/:id, proposals/:id | No such record |
| `conflict` | 409 | approve, reject | CAS lost, the proposal isn't `pending`, or `contentHash` doesn't match |
| `stale` | 409 | approve | `main` moved under a file the agent read; proposal is now `stale` |
| `rate_limited` | 429 | chat, jobs | Per-user daily counter (§9). Netlify's own rate-limit rule also answers 429, with its own body: the client treats any 429 without our JSON as `rate_limited` |
| `budget_exhausted` | 429 | chat, jobs (and a chat `handoff` that can't start its job) | Site-wide compute budget `site:compute` has too little left (§9) |
| `approve_cap` | 429 | approve | ADR-0008 cap reached; proposal stays `pending`; body also carries `approvals` (below) |
| `refusal` | — | SSE and job events only | Claude refused; terminal `error` event (no `done`), discard the partial reply (rule above) |
| `upstream` | 502 | chat, jobs, approve | Claude or GitHub failed. For approve, the proposal is `failed` (or still `committing`, §7) |
| `timeout` | 504 | chat, approve | Our own time budget ran out before a result |
| `unavailable` | 503 | all | Supabase unreachable (§4.1): a throw, or a **returned** `AuthRetryableFetchError` (auth-js returns network/5xx failures instead of throwing; other returned auth errors are `401`). Also: not the production context (§4.6), a limit record that can't be read (fail closed, §1), or Approve switched off before launch |
| `internal` | 500 | all | Anything else |

**Proposal payload for the Approve sheet.** `GET /api/proposals/:id` returns:

```json
{
  "proposal": { "...": "the stored record, exactly as proposal.schema.json" },
  "diffs": [ { "path": "public/js/score.js", "diff": "unified diff text, rendered with textContent" } ],
  "deploys": true,
  "approveEnabled": true,
  "approvals": { "used31": 3, "usedToday": 1, "per31Days": 14, "perDay": 5, "retryAt": null }
}
```

- **`approvals`** is the read-only cap check (`checkApproveCap()`, ADR-0008; netlify-engineer example 03) run **outside** the approve lock. It is advisory, for display only; the check inside the lock at Approve is the one that counts. `retryAt` is `null` when a slot is free now, otherwise the same ISO time a `429 approve_cap` would return. If the Blobs read fails, `approvals` is `null` and the sheet omits the usage line; it does not block Approve.
- **`deploys`** is `deploysOnCommit(paths)` from `netlify/functions/lib/deploys.mts` (§1, which mirrors the `ignore` path list in docs/03 §3.1).
- **`approveEnabled`** is the server-side pre-launch switch (§1 step 5, §4.2).
- The approve `200` returns `{ "proposal": {"id", "status", "commitSha", "decidedAt"}, "deploys", "approvals" }`. `status` is `committed`, or `committing` when the commit landed but recording didn't finish (§1, §7 reconciler). **`deploys`** (required) is `deploysOnCommit()` over the committed paths, the same value the GET returned, and picks the outcome copy (Deploying… then Live, or No deploy needed). `approvals` is read after recording, `null` if that read fails. A `429 approve_cap` body carries `approvals` next to `error`. Schema: `approve-result.schema.json`.
- **A no-deploy approval still uses a cap slot.** `deploys: false` changes the outcome copy only, never the accounting: every `committed` approval counts (ADR-0008 point 4, decided). Excluding no-deploy approvals would need a new ADR superseding 0008, and only after the first skipped build shows 0 credits on the Usage page (ADR-0008 "Revisit when"; docs/03 §8.2, UNVERIFIED today).

Machine-checkable JSON Schemas for these shapes are in `knowledge/software-architect/examples/02-interface-contracts/`.

## 3. Threat model (what we defend against)

Owner: security-engineer. Updated 2026-11-23 for ADR-0006 (Supabase Auth), ADR-0007 (reads from GitHub `main`) ADR-0008 (Approve cap) and the Proposed ADR-0009 (read token); wave 3b added the returned-error 503 rule, the header pre-check and the email-flow settings; wave 4 added trailer forgery, the reconciler's GitHub reads and the compromised-`super_admin` order. Mechanisms are in §4, limits in §9, headers in §10.

**Trust boundary in one paragraph.** Anyone on the internet can create a Supabase account, so "signed in" means nothing on its own. The only privilege is `profiles.role = 'super_admin'`, which only Dr. Lee sets by hand. Every function re-checks it on every request. The browser holds the user's tokens in `localStorage` on the **same origin as the public beach app**, so any script that runs anywhere on the site can read them. Agents can propose changes but never commit, and a human Approve after a fresh sign-in is the only path to `main`.

| Threat | Example | Control |
|---|---|---|
| Stranger or any signed-up user uses the Console | Signs up, finds `/console`, calls `/api/chat` to burn Claude credits, or calls approve | Every `/api/*` function runs the token-and-role check first (§4.1) and fails closed: 401 / 403 / 503. No unauthenticated function exists (ADR-0006). Rate limits and the Anthropic spend limit (§9) |
| Role escalation | User `PATCH`es their own `profiles.role`, sets `role` in `user_metadata`, or sends `role` in a request body | API roles hold **no** INSERT/UPDATE/DELETE privilege on `profiles`; role is read from `profiles` as the caller, never from the JWT, metadata or the body; `super_admin` is set only in the SQL editor (§4.5) |
| Privileged Supabase key leaks | A `sb_secret_…` or legacy `service_role` JWT pasted into an env var, `config.js` or a proposal | No such key is ever created in our config. The build refuses a publishable key that doesn't start `sb_publishable_` (ADR-0006). The secret scan flags `sb_secret_…` and any full JWT (§6, `agent-console-security`) |
| Token theft through XSS | Injected script on **any** page of the origin (beach app or Console) reads the Supabase session from `localStorage` | Strict CSP with `script-src 'self'`, no inline script, no CDN (§10). `textContent` only. 10-minute access tokens (§4.3). Approve needs a fresh sign-in, which a stolen token can't produce (§4.2). Approved `public/**/*.js` and `*.html` changes are reviewed as privileged code; the proposal card warns. **Open for Dr. Lee:** deny `public/console.html` and `public/js/console/**` to agents |
| Stolen or signed-out token replayed | A token copied from a device, or a user who signed out but whose token is still valid | Access tokens live 10 minutes (§4.3). Tokens are never logged or stored server-side. Approve also calls `getUser(token)` (§4.2) |
| Walk-up Approve | Someone uses an unlocked laptop with a live Console tab | Step-up before Approve: a password or Google sign-in no more than 10 minutes old, plus `aal2` if the user has a TOTP factor (§4.2) |
| Account takeover through the auth flows | Open redirect leaks the auth code; reset form reveals which emails exist; weak password; attacker signs up first with Dr. Lee's address | PKCE; `token_hash` email links acted on only by a tap; exact redirect allow-list; Confirm email **and** Confirm phone on, so sign-up doesn't say "already registered"; custom SMTP; default Auth rate limits; reset copy never says whether an address exists; minimum length 12; promote only a confirmed user id; TOTP recommended for `super_admin` (§4.5) |
| Secret leakage to the browser | API key or GitHub token in a bundle, response or `config.js` | Secrets only in function env vars; `config.js` is written from three named non-secret variables only; responses never echo env; Netlify secret scanning; CSP |
| Over-privileged token | The token can touch other repos, or the write token is exposed by the chat code | Fine-grained PAT, this repo only, Contents R/W, no Workflows (ADR-0005), read only by approve. Proposed: a separate public-read-only token for the read tools (ADR-0009, §4.6, awaiting Dr. Lee) |
| Agent writes dangerous files | Proposes `netlify/functions/approve.mts`, `.github/workflows/*`, `netlify.toml`, `public/_headers`, `public/vendor/**` | Server-side allow-list and deny-list, re-checked at Approve (§6); no Workflows permission |
| Agent-written code runs with secrets | A proposed test runs during the Netlify build, where Free gives every step every secret | No `vitest` in the Netlify build; `scripts/**` denied; tests run in GitHub Actions with a read-only token and no secrets (§4.7) |
| Prompt injection | A repo file or chat text says "commit this secret" or "widen the allow-list" | Agents have no commit tool; human Approve with a visible diff; policy in code, re-checked at Approve; secrets never in prompts; read tools refuse `.env*`, `*.pem`, `*.key` (ADR-0007) |
| CSRF, login CSRF and clickjacking | Another site triggers Approve, or frames the Console | Bearer token in a header, not a cookie, so the browser never attaches it on its own; no CORS headers; `Sec-Fetch-Site` / `Origin` check on POST as defence in depth; no state change from a URL; PKCE for OAuth; `frame-ancestors 'none'` (§4.4, §10) |
| Replay or double Approve | Approve clicked twice, or a proposal edited after review | Content hash shown and compared; CAS status; one approve in flight; base-SHA check (§7) |
| Commit-trailer forgery | An agent writes `…\n\nBeach-Day-Proposal: p_<other>` (or a nested or Unicode-line-break variant) into its summary, so the reconciler credits the wrong commit, or none, and the Approve cap undercounts | Summary is one line with no control, format or line-break characters and no trailer text, rejected at `propose_change` (§6); the message is built by the server with the trailer as the last line (§7 step 5); the reconciler requires the final-line trailer **and** the exact author **and** one parent **and** equal blob SHAs, and a full page with no match is "unknown", not "not found" (§7; tested shape: security-engineer example 02, `commitmsg.mjs`) |
| Cost abuse | Loops, huge prompts, too many jobs | Netlify rate rules, per-user counters, per-job caps, a site-wide compute budget, the Approve cap and the Anthropic spend limit (§9) |
| Preview deploys with production powers | A branch deploy reads `GITHUB_TOKEN` and commits | Secrets set for the Production context; Deploy Previews and branch deploys turned off; functions refuse GitHub and Claude calls unless `context.deploy.context === "production"` (§4.6) |
| Supabase down or project paused | Auth or PostgREST unreachable | Fail closed (503), including errors auth-js **returns** rather than throws (§4.1 step 5, §4.2 rule 1). The beach app has no auth code and keeps working |
| `super_admin` account compromised | A phished password or a stolen session approves a malicious `public/**/*.js` that waits for Dr. Lee's next sign-in | Demote first (role read on every request), roll back and lock publishing **before** anyone signs in on the site again, end every session, then reset the password; re-promote last (`docs/runbooks/rollback.md` §3a). TOTP on the account (§4.2) |
| Forged-token flood | Random tokens with unknown `kid` or `HS256` make every `getClaims` call Supabase from the function's IP | Header pre-check (§4.1 step 1) once asymmetric keys are confirmed; Netlify rate rules on chat and jobs (§9) |

**Residual risks (accepted, revisit if the user base grows):**
- An XSS anywhere on the origin, including an approved malicious `public/**/*.js`, can use the tokens for chat and proposals, and can approve within 10 minutes of a real step-up. CSP and diff review are the controls. Moving the Console to its own origin would remove this; it needs an ADR.
- For a Google-only user without TOTP, a step-up proves a live Google session in that browser, not a typed password. Whether `prompt=login` forces a fresh Google login is **UNVERIFIED**. TOTP closes the gap.
- Open sign-up lets anyone create accounts. They get 403, but they cost Supabase MAU and one role lookup per request.

## 4. Supabase Auth and roles

Decision: ADR-0006. Reference code: `knowledge/supabase-auth-engineer/examples/01-token-and-role-check/` (the check) and `knowledge/security-engineer/examples/01-bearer-step-up-and-origin/` (step-up and Origin). Skills: `supabase-auth`, `supabase-rls-profiles`, `agent-console-security`.

### 4.1 The check on every function

Every `/api/*` handler runs this first, before reading the body, counting limits, or touching Blobs, GitHub or Claude:

1. `Authorization: Bearer <access token>` is present and has three dot-separated parts. Otherwise **401**, with `www-authenticate: Bearer`.
   - **Header pre-check (decided; switched on once the project's asymmetric signing keys are confirmed, pre-launch test (f) in §4.2).** Decode only the JWT header. If it isn't a JSON object, if `alg` isn't `ES256` or `RS256`, or if `kid` isn't a non-empty string, answer **401** with no network call. This verifies nothing (step 2 does). It exists because `getClaims` falls back to `GET /auth/v1/user` for an unknown `kid` or an `HS*` alg, so every cheap forgery would cost one Auth call from the function's shared IP, and the per-IP `user` limit (30 per 5 min by default, knowledge/supabase-auth-engineer/docs/06) is the same bucket Approve's `getUser` may draw from (**UNVERIFIED**). A forgery with a plausible `kid` still costs one call; that is accepted. If the project turns out to use the legacy HS256 secret, the pre-check stays off, because it would reject every real token. Reference: security-engineer example 01, `precheckJwtHeader`.
2. `supabase.auth.getClaims(token)` verifies the signature and `exp` against the project's JWKS. The token is passed explicitly. Never `getSession()` on a server, and never `allowExpired`. An invalid token gets **401**.
3. The function checks the claims itself, because `getClaims` doesn't: `iss === <SUPABASE_URL>/auth/v1`, `aud === "authenticated"`, `is_anonymous !== true`, and `sub` is a string. Otherwise **401**.
4. It reads the role with one PostgREST call made as the caller: `GET <SUPABASE_URL>/rest/v1/profiles?select=role&id=eq.<sub>`, with `apikey: <publishable key>` and the caller's Bearer token. A PostgREST 401 means **401**. Anything other than exactly one row with `role === "super_admin"` means **403**.
5. A network error, timeout, 5xx, cold-JWKS fetch failure or any unexpected exception means **503 `unavailable`**. **auth-js returns these as `{ error }` instead of throwing**, so map `isAuthRetryableFetchError(error)` to 503 and any other returned auth error to 401, and treat any throw as 503. Code that only catches throws turns an outage into a 401 and sends the user to sign in again. Never allow, never echo the error.
6. The function logs the user id (`sub`), route, status and `requestId`. It never logs the token or the `Authorization` header.

Rules that go with it:
- The role is **not cached**, so a demotion takes effect on the next request. The JWKS may be cached (auth-js does this per instance).
- Only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are used. The secret key and the legacy `service_role` key are used nowhere.
- **`/api/jobs-run`** (background) can't return a status. It runs the same check on the forwarded token **and** consumes the job nonce with a CAS. If either fails, it writes nothing and exits. Store only the SHA-256 of the nonce in the job record.
- The Console client refreshes its session if the access token expires within 120 s before calling `/api/chat` or `/api/jobs`, so a chat hand-off doesn't reach `/api/jobs-run` with an expired token.

### 4.2 Step-up before Approve (required)

`reauthenticate()` is **not** a step-up: it sends a nonce for password changes only and does nothing for Google-only users (knowledge/supabase-auth-engineer/docs/03). Instead, `POST /api/proposals/:id/approve` runs these checks after §4.1, and all of them must hold:

1. `getUser(token)` succeeds, returns the same id as `sub`, and the user is not banned. `getUser` **returns** network and 5xx failures as `{ error: AuthRetryableFetchError }`; it doesn't throw them. A returned retryable error, or any throw, means **503 `unavailable`**. Any other returned error (for example `session_not_found` after sign-out, `user_banned`) or an empty user means **401 `unauthorized`**. (Fixed 2026-11-23 in example 01, which had mapped only a throw to 503.)
2. The token's `amr` claim has an entry with method `password` or `oauth` whose `timestamp` is **no more than 600 s old** (and no more than 60 s in the future).
3. `user.last_sign_in_at` is no more than 600 s old. This is a server-side corroboration of rule 2, not a substitute (see below).
4. If the user has any verified MFA factor, `aal === "aal2"`.

If any check fails, the response is **401 `{"error":{"code":"step_up_required"}}`**, and the proposal stays `pending`.

Why it is built this way:
- Supabase documents `amr` as the way to require that a user "recently signed in with a password" (auth-mfa guide, read from the `supabase/supabase` docs source on 2026-11-23). `token_refresh`, `recovery`, `otp`, `magiclink` and the other methods don't count.
- **Rule 2 binds the step-up to this session; rule 3 does not.** In the Auth server source, each `amr` timestamp belongs to one session and one method: a sign-in creates a new session and writes it, and a refresh writes nothing (knowledge/supabase-auth-engineer/docs/03). `last_sign_in_at` belongs to the **user**, so a sign-in on any other device, including an attacker's own sign-in elsewhere with stolen credentials, also makes it fresh. Never relax rule 2 on the strength of rule 3.
- **TOTP is additive, never a substitute.** A thief with a stolen aal1 session could enrol their own factor, so a fresh `totp` entry alone never passes (tested in example 01).
- Supabase TOTP MFA "is free to use and is enabled on all Supabase projects by default" (auth-mfa/totp guide). **Recommended to Dr. Lee:** enrol TOTP on the `super_admin` account. A Google step-up then also needs a code, which closes the residual risk in §3.

Browser flow (Wren owns the copy):
- **Password users** re-enter their password in a dialog (`signInWithPassword`), plus a TOTP code if they have a factor. The Console then retries Approve with the new token.
- **Google users** go through `signInWithOAuth` again, with `redirectTo` set to exactly `<origin>/console` (no `#`; the proposal id to return to is kept in `sessionStorage`, id only). After the redirect the Console shows the same proposal and its hash, and the user must **click Approve again**. Nothing is ever approved automatically from a URL.
- Allow paste and password managers (WCAG 3.3.8).

**Pre-launch tests on the real project. Approve stays disabled until they pass** (supabase.com was blocked from the sandbox, so these are **UNVERIFIED**):
- (a) the `password`/`oauth` `amr` timestamp keeps the sign-in time across a token refresh (the server source supports this);
- (b) a new sign-in in the same browser gives a new, current timestamp;
- (c) `last_sign_in_at` changes on password and Google sign-in, and not on refresh (the server source supports this);
- (d) `getUser` after `signOut({scope:'local'})`. If it still succeeds, a signed-out token works until `exp`. That is accepted with 10-minute tokens, but record it;
- (e) a TOTP verify yields `aal2`;
- (f) a real access token's header has `alg` `ES256` or `RS256` and a `kid` (Dashboard shows asymmetric signing keys). Only then is the §4.1 header pre-check switched on;
- (g) with Supabase unreachable from the function, Approve answers `503 unavailable`, not 401;
- (h) Netlify secret scanning does not flag `sb_publishable_…` in `config.js` (fallback `SECRETS_SCAN_OMIT_KEYS`, docs/03 §9.5);
- (i) the RLS Security Advisor shows no warning on `profiles`, and a second throwaway user cannot read or change another row, or their own `role`, through the REST API with the publishable key.

This list (a)–(i) is canonical; docs/06 §3 uses the same letters. **The two switches it gates are server constants in code, reviewed by security-engineer, never env vars or client flags:** `APPROVE_ENABLED` (off until (a)–(e), (g) and (i) pass) and `JWT_HEADER_PRECHECK` (on only after (f)).

If (a) fails, security-engineer re-specifies rule 2 before launch.

### 4.3 Tokens and sessions in the browser

- **Storage: `localStorage`** (the supabase-js default). It stays, deliberately:
  - `sessionStorage` would not stop XSS, which runs in the same tab;
  - it would break PKCE confirmation and reset links that open in a new tab;
  - HttpOnly cookies need server rendering, which ADR-0006 doesn't have.

  The consequence is the XSS row in §3, and the defence is the CSP.
- **Access-token (JWT) expiry: 600 s (10 minutes).** Dr. Lee sets it in Dashboard → Auth → Sessions. Supabase recommends not going below 5 minutes, and says the default of 1 hour suits most apps. 10 minutes bounds how long a stolen or signed-out token works. Our longest request that checks a token takes 60 s; `/api/jobs-run` checks only at its start.
- **Session time-box and inactivity timeout** are "only available on Pro Plans and up" (sessions guide). On Free, sessions last until sign-out, and the step-up is what protects Approve. If the project is ever on Pro, set a time-box of 12 h and an inactivity timeout of 2 h.
- **Client settings:**
  - `flowType: 'pkce'`;
  - `autoRefreshToken: true` in the Console;
  - after the PKCE exchange, remove `code` from the URL with `history.replaceState`;
  - log-out is `signOut({ scope: 'local' })`, and the Console offers "Sign out everywhere" as `scope: 'global'`.
- The public beach app never loads auth code. The service worker never caches `<SUPABASE_URL>/**` or `/api/**`.

### 4.4 CSRF and Origin with Bearer tokens

The browser never attaches an `Authorization` header by itself, and we send **no** `Access-Control-Allow-*` headers. So a page on another origin can't make an authorised request, and the old CSRF token and cookie are gone (ADR-0006). We keep three cheap layers:
- **Origin check.** On every POST, reject with **403** when `Sec-Fetch-Site` is present and not `same-origin`, or when `Origin` is present and not the site URL (including `null`). When both are absent, the call is server to server and passes, because no browser credential can ride along (example 01).
- **No state change from a URL.** No query string, hash or redirect ever triggers Approve, Reject, a chat turn or a job.
- **PKCE** for OAuth protects against login CSRF and code interception. `frame-ancestors 'none'` protects against clickjacking.
- **Email links use `token_hash`, and a tap, not the URL, acts (§4.5).** `/console?token_hash=…&type=…` only shows a "Confirm" screen; `verifyOtp` runs when the person taps the button, and the page then removes `token_hash` and `type` from the URL with `history.replaceState`. That keeps link scanners from using up the link and keeps the rule above. Residual risk, accepted: someone can mail a victim a link for the *attacker's* account (login CSRF). The victim ends up signed in as a non-admin account that gets 403 on Agents; the Console shows which email is signed in. Google `error`, `error_code` and `error_description` parameters are never rendered as raw text; show fixed copy and strip them.

### 4.5 Supabase project settings and roles (Dr. Lee, by hand)

| Setting | Value |
|---|---|
| Confirm email | **On** |
| Confirm phone | **On**, even though phone sign-in stays off. The setting names are exactly "Confirm email" and "Confirm phone": auth-js `signUp` JSDoc, "When both **Confirm email** and **Confirm phone** (even when phone provider is disabled) are enabled ... an obfuscated/fake user object is returned. When either ... is disabled, the error message, `User already registered` is returned." That error is account enumeration. Source quoted in knowledge/supabase-auth-engineer/docs/06; matches the Auth server source; hosted **UNVERIFIED** |
| Custom SMTP | **Required before launch.** The built-in sender mails only members of the project's organisation team, 2 emails an hour, and is "not meant for production use" (auth-smtp guide). Without it, strangers' sign-up and reset emails fail. The SMTP password lives in Supabase only, never in the repo or Netlify |
| Email templates | Confirm signup and Reset password link to our own page with `{{ .TokenHash }}`, for example `{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=email` and `&type=recovery`, as a **query string, never a `#` fragment**. The page calls `verifyOtp({ token_hash, type })` only when the person taps a button (§4.4). A PKCE `?code=` link works only in the browser that started the flow, so it fails in the installed app's mail hand-off. Exact template strings **UNVERIFIED** until tried |
| Auth rate limits | Keep the defaults (Authentication → Rate Limits): confirmation and reset emails one per **60 s** per user; `signup`, `recover`, `resend`, `otp`, `user` 30 per 5 min per IP; `/token` 150 per 5 min per IP; `/verify` 30 per 5 min per IP; MFA verify 15 per minute per IP (fixed). Never raise them to work around a support issue without security-engineer review. The per-user 60 s cooldown may answer 429 only for real addresses (**UNVERIFIED** side channel): the UI shows the same neutral "sent" status for 200 and a per-user 429 on reset and resend |
| Password minimum length | **12**. No character-class rules (our choice); allow paste and password managers |
| Leaked-password protection | Pro plan and above only. On Free it isn't available: the length rule, Google sign-in and TOTP compensate |
| Anonymous sign-ins | **Off** (the check rejects `is_anonymous` anyway) |
| Site URL | `https://<production host>/console` |
| Redirect URLs | Exact entries only: `https://<production host>/console` (the reset link is `/console?token_hash=…&type=recovery`, built from the Site URL in the template, so it needs no extra entry). No `*` or `**`, no Netlify preview pattern, no `localhost` (use a separate dev project). How query strings match the allow-list is **UNVERIFIED**; the Google return route is kept in `sessionStorage`, and `redirectTo` never contains `#` |
| Google provider | Client secret lives in Supabase only, never in the repo or Netlify. Authorised origin is the production origin |
| JWT expiry | 600 s (§4.3) |
| Signing keys | Asymmetric (so `getClaims` verifies locally); confirm in the Dashboard (**UNVERIFIED** for this project) |
| MFA (TOTP) | On (default). Recommended: Dr. Lee enrols a factor |

**Roles and RLS** (`supabase-rls-profiles`, example 02):
- `profiles` has RLS on with one select policy for the user's own row.
- `anon` and `authenticated` hold no INSERT, UPDATE or DELETE privilege on it.
- The sign-up trigger inserts only `id` and never reads `raw_user_meta_data`.

**Promotion.** Dr. Lee promotes himself once, in the SQL editor, and only a user id whose email is confirmed. Promote only after signing in the way he will normally sign in, because Google and email accounts may be separate users (**UNVERIFIED**).

### 4.6 Secrets and environments on the Free plan

Env-var **scopes** (Builds/Functions/Runtime) are Pro+. On Free every build step sees every variable, and per-context values are **UNVERIFIED** (docs/03 §6). So "Production-only secrets" is enforced in four layers:
1. Set `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` with `--context production --secret`. Then check `netlify env:list --context deploy-preview`.
2. **Turn off Deploy Previews and branch deploys.** This is required, not a fallback: ADR-0003 commits to `main` and QA runs on the main deploy, so they're unused. Keep "Build without sensitive variables" for fork builds.
3. **In code:** functions that call GitHub or Claude return **503 `unavailable`** unless `context.deploy.context === "production"`, before reading the secret.
4. **Build:** nothing agent-writable runs during the build, and build scripts never print env (§4.7).

**Read token: [ADR-0009](adr/0009-public-read-token-for-agent-reads.md), Proposed, awaiting Dr. Lee.** Security-engineer recommended it; the ADR is the canonical statement (option C, fail closed, no fallback to the write token, a token-name scan test, a pre-launch read test). Until Dr. Lee accepts it, ADR-0007 stands: same `GITHUB_TOKEN`, read-only module, and `GITHUB_READ_TOKEN` is **not** created. On acceptance it gets the same four layers as the other secrets. Summary of why:
- GitHub states that fine-grained tokens "always include read-only access to all public repositories" (managing-your-personal-access-tokens, read from the `github/docs` source on 2026-11-23). A token with **Public repositories** access and **no permissions** can therefore serve `read_file`/`list_files` while the repo is public.
- If it leaks, it grants nothing an anonymous visitor lacks, apart from its rate budget.
- `chat` and `jobs-run` then load `GITHUB_READ_TOKEN`, and only `approve` loads the write `GITHUB_TOKEN`.
- If the repo goes private, this has to be revisited.

### 4.7 Tests, CI and the build

- **No `vitest` (or any test runner) in the Netlify build** (docs/03 §9.4). On Free the build sees every secret, and `tests/**` is agent-writable.
- **We do not deny `tests/**`** to agents: agents writing tests is how the gates stay green.
- **Tests run in GitHub Actions** with `permissions: contents: read`, no repository secrets, no `pull_request_target`, and actions pinned by SHA. `.github/**` is denied to agents, so the workflow stays human-owned.
- QA reads the result on the main deploy, with rollback ready (ADR-0003). It is a signal after the commit, not a gate before it; the gate is the human diff review.
- **Humans running tests locally** treat an agent-written test as untrusted code. Run it in a shell without real secrets in the environment.

## 5. GitHub token: least privilege

Source: [fine-grained PATs](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens), [permissions per endpoint](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens).

* Settings → Developer settings → Personal access tokens → **Fine-grained** → Resource owner `fenago` → Repository access **Only select repositories → BeachDay**.
* Permissions: **Contents: Read and write** (contents API, blobs, trees, commits, refs). Metadata read is required/added automatically (**[UNVERIFIED]** in the pages read). Add **Pull requests: write** only if using the PR flow. **Do not grant Workflows** — without it the token cannot change `.github/workflows/*`.
* Expiration: GitHub now allows no-expiry tokens unless an org policy forbids it; set **90 days** anyway and rotate (calendar reminder; `netlify env:set GITHUB_TOKEN … --secret`).
* Fine-grained PATs **cannot be limited to paths or branches**. GitHub's "restrict file paths" **push rulesets** exist but only for private/internal repos on GitHub Team+ ([rulesets](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets)). → The **allow-list must be enforced in our function**.
* Still add a ruleset on `main` (available on Free public repos): block force pushes, restrict deletions.
* Store as secret env var `GITHUB_TOKEN`, **Production context only**. Env-var scopes (Builds/Functions/Runtime) are Pro-only, so on Free the build can read it too; how that is contained (production context, previews and branch deploys off, the in-code production check, a build that never prints env) is §4.6. Approve is the only writer; `chat` and `jobs-run` use the same token for reads only, through a module with no write methods (ADR-0007), unless Dr. Lee accepts the separate `GITHUB_READ_TOKEN` (§4.6).
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
- **Validate the exact string sent to GitHub; never normalise or decode it.** Anything that would need normalising is rejected, not repaired. The path must be 1–200 characters from `[A-Za-z0-9._/-]` only (so no backslash, space, `%`, control or non-ASCII character), with no leading `/`, no empty segment (`//`, trailing `/`), no `.` or `..` segment and no segment ending in `.`. The same string is checked, stored, hashed and sent to GitHub. Details: `agent-console-security` skill, "Path allow-list".
- Mode is always `100644` (no symlink `120000`, no submodule, no executable bit). No two paths in one proposal may differ only by case.
- **No deletions.** `propose_change` only creates or replaces whole files; every tree entry carries `content`, and the approve function never sends a tree entry with `sha: null`. Deleting a file is a human change. (If deletions are ever added, they go through this same allow/deny check.)
- DENY is matched case-insensitively, so `Netlify.toml` and `public/_Headers` are denied; ALLOW is exact-case.
- DENY wins over ALLOW.
- At most 20 files, and at most 200 KB per file.
- **Text only:** contents must be well-formed Unicode (`isWellFormed()`, so no lone surrogates) that encodes to UTF-8 with no NUL bytes, whatever the path.
- **Summary:** one line, 20–2000 code points, well-formed (`isWellFormed()`), no control, format or line-break characters (`\p{Cc}`, `\p{Cf}` such as bidi overrides/isolates and zero-width characters, `\p{Zl}`, `\p{Zp}`) and no `Beach-Day-Proposal` text in any case. `propose_change` rejects anything else with `is_error: true` so the agent can rewrite it; the commit message builder (§7 step 5) sanitises again anyway.
- Run a **secret scan** on new contents, at proposal time and again at Approve. The exact rules are owned by security-engineer and live in the `agent-console-security` skill ("Proposal integrity"), with a runnable copy in `knowledge/security-engineer/examples/03-secret-scan-and-review/`. In summary it flags: Anthropic keys (`sk-ant-…`), GitHub tokens (`github_pat_…`, `gh[pousr]_…`), Supabase secret keys (`sb_secret_…`), any **full three-part JWT** (which covers legacy `service_role`/`anon` keys and access tokens), private-key blocks, assignments to `ANTHROPIC_API_KEY`, `GITHUB_TOKEN` or `GITHUB_READ_TOKEN`, and high-entropy strings of 40+ characters next to key, token or secret (lower-case slash paths excluded).
  - It does **not** match the bare word `service_role`, so docs that explain the key stay proposable.
  - There is no `EXAMPLE` exemption. Test fixtures build fake secrets at runtime instead of committing literal strings (`secure-by-design`).
  - Findings are redacted to 6 characters plus the length in the UI, logs and audit.
- Changes to denied paths are made by a human in a normal git workflow.
- GitHub **push protection** applies to REST API commits and may reject a commit that contains a secret. Show that error in the UI ([push protection](https://docs.github.com/en/code-security/concepts/secret-security/push-protection)).

## 7. Commit on Approve (atomic, multi-file)

Use the **Git Database API**, not the Contents API: one commit for N files (one Netlify deploy, 15 credits, instead of N), and no parallel-PUT conflicts (GitHub says Contents PUT/DELETE must be called serially). Sources: [refs](https://docs.github.com/en/rest/git/refs), [commits](https://docs.github.com/en/rest/git/commits), [trees](https://docs.github.com/en/rest/git/trees), [blobs](https://docs.github.com/en/rest/git/blobs).

```
0. Auth + role + step-up (§2, §4). Validate the id (^p_[0-9A-Z]{26}$).
   Take the site-wide approve lock (Blobs `approve-lock`, onlyIfNew; a lock older than 90 s may be
   taken over with onlyIfMatch — longer than any approve can run, since sync functions stop at 60 s).
   Run the reconciler (below) if this proposal is stuck in "committing".
   Load the proposal: status must be "pending". Recompute its content hash and COMPARE it with the
   `contentHash` the client sent (the hash the user saw). Mismatch → 409 conflict.
   CHECK the cap, read-only: checkApproveCap() (ADR-0008). Over → 429 approve_cap {retryAt, approvals};
   status stays "pending"; release the lock. Nothing is written to site:approvals here.
   Re-run the allow-list, size, text-only and secret-scan checks (§6).
   CAS status "pending" → "committing" {decidedAt: now, decidedBy: sub}.
1. GET  /repos/fenago/BeachDay/git/ref/heads/main             → headSha
2. If headSha ≠ proposal.baseSha: for each file, compare the current blob SHA on main with
   readBlobSha. null means a new file or one the agent never read (ADR-0007); either way it must
   not exist on main now, so an unread file that exists goes stale (conservative, never unsafe).
   Any difference → CAS "stale"; 409 stale.
3. GET  /repos/.../git/commits/{headSha}                       → baseTreeSha
4. POST /repos/.../git/trees  { base_tree: baseTreeSha,
        tree: [{path, mode:"100644", type:"blob", content}, …] }   → treeSha
        (ALWAYS send base_tree — omitting it deletes every other file)
5. POST /repos/.../git/commits { message, tree: treeSha, parents:[headSha],
        author:{name:"Beach Day Agent (<agent>)", email:"…"} } → commitSha
        message = buildCommitMessage(summary, id), built by the server only:
          "<summary as ONE line>\n\nBeach-Day-Proposal: p_…"
        The summary line has every control/line-break character (incl. U+2028/2029) replaced by a
        space, every "Beach-Day-Proposal" (any case) removed, and is cut to 200 chars. The trailer
        is always the LAST line, and the agent's text can never produce a trailer line.
6. PATCH /repos/.../git/refs/heads/main { sha: commitSha, force:false }
   a. 200 → main moved; go to 7.
   b. 422 not fast-forward (a definite "no": main moved first) → redo steps 1–6 once, else CAS "stale".
   c. UNKNOWN OUTCOME (timeout, network error, 5xx): never assume failure. Re-read
      GET /git/ref/heads/main (up to 3 tries, serially):
        ref == commitSha              → main moved; go to 7.
        re-read succeeded, ref ≠ commitSha → the update did not land; go to 8.
        every re-read failed           → leave "committing"; release the lock; answer 502 upstream.
                                         The reconciler decides later.
7. RECORD, then mark (the "committed ⇒ counted" invariant, §2.1):
   a. recordApproval(now) — CAS append to site:approvals, pruned to 31 days (ADR-0008).
   b. CAS "committing" → "committed" {commitSha} (decidedAt is kept from step 0).
   c. Audit record (actor = Supabase user id, proposalId, commitSha). Release the lock.
   d. Answer 200 {proposal, deploys, approvals}.
   If 7a or 7b still fails after retries, main HAS moved: answer 200 committed with commitSha anyway
   (it is true on GitHub), log + audit "approve_record_pending", leave the record "committing" and
   release the lock. The reconciler records and marks it. Never retry the commit, never roll back main.
8. Definite GitHub error in 1–5, or 6c "did not land" → CAS "failed" {error}; release the lock;
   answer 502 upstream. Nothing is recorded, so no slot is used.
```

**Reconciler** (runs from `GET /api/proposals/:id` and from approve, for a record in `committing` whose `decidedAt` is more than 120 s old; it takes the approve lock and skips if the lock is held):
1. Look for the proposal's commit on `main`: `GET /repos/.../commits?sha=main&since=<decidedAt − 5 min>&per_page=50`. A commit is **this proposal's commit only if all three hold** (an agent's summary must never be able to claim another proposal's slot):
   - the message's **final** line is exactly `Beach-Day-Proposal: <this id>` (not anywhere in the body);
   - the commit author name is exactly `Beach Day Agent (<proposal.agent>)`;
   - for every file in the proposal, the blob SHA at that commit (`GET /repos/.../contents/{path}?ref=<commitSha>`, serially, ≤20 calls) equals the git blob SHA of the proposal's content (`sha1("blob " + byteLength + "\0" + bytes)`), and the commit has one parent.
   A candidate that fails any check is ignored (logged), never matched.
2. **Found** → record, then mark, exactly as step 7a–7b (the reconciled commit **counts**, ADR-0008). If an earlier 7a had already succeeded, this records it a second time: an overcount of one, which is the safe direction.
3. **Re-read succeeded and not found** → CAS `failed` {error: "commit did not reach main"}. No slot is used.
4. **GitHub unreachable** → leave it `committing` and try again on the next GET.

**Check-then-record, in one place.** The cap is **checked** read-only in step 0, inside the approve lock and before any GitHub call, and **recorded** only in step 7a or the reconciler, when `main` has actually moved. Because only one approve holds the lock, the check and the record can't race (ADR-0008 point 3). `failed`, `stale`, `rejected` and `approve_cap` never record, so nothing is ever refunded (§9). The functions are `checkApproveCap()` and `recordApproval()` in `netlify/functions/lib/limits.mts`, shaped like `knowledge/netlify-engineer/examples/03-cas-rate-limit-counter/`.

**Where the agent's reads come from (ADR-0007):** `read_file` and `list_files` read from GitHub `main`, pinned to the `main` head SHA resolved at the start of the turn or job. `propose_change` records that SHA as `baseSha`, and each file's blob SHA as `readBlobSha` (`null` for a new or unread file). The read tools refuse `.env*`, `*.pem`, `*.key`, `.git/**`, non-UTF-8 files and files over 200 KB. They use a read-only GitHub module, and only the approve function can write. **Proposed (ADR-0009, awaiting Dr. Lee):** the read module would use its own public-read token, `GITHUB_READ_TOKEN`, so only approve loads the write `GITHUB_TOKEN`; until then ADR-0007 stands (same token, read-only module).

Headers: `Authorization: Bearer $GITHUB_TOKEN`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` (supported until 10 Mar 2028; a newer `2026-03-10` exists — read its changelog before switching; [API versions](https://docs.github.com/en/rest/about-the-rest-api/api-versions)). Make requests **serially**; GitHub's secondary limits allow ≤80 content-creating requests/min and ≤500/hour ([rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)); honor `retry-after`.

Netlify auto-deploys the push to `main` ([deploy overview](https://docs.netlify.com/deploy/deploy-overview/)) unless the `ignore` command skips it; the approve response says which (`deploys`, §2.1). Show deploy status without a function (ADR-0006 §8): after `committed` with `deploys: true`, the Console polls `/version.json` (`no-store`, never cached by the service worker) every 10 s until `commit` equals `commitSha` → "Live". After 10 min it shows "Still deploying — check Netlify". Rollback = "Publish deploy" on the previous deploy in Netlify (instant), or a revert commit.

**Decided (ADR-0003): Approve commits straight to `main`** using the steps above. The PR flow below is recorded as a future option only.

**Future option (not adopted) — preview before production.** Step 6 becomes "create `refs/heads/agent/<id>` + open a PR"; Netlify builds a Deploy Preview; QA checks run there; Approve then merges with `PUT /pulls/{n}/merge` passing the reviewed head `sha` (409 if the head changed). Needs Pull requests: write. Note a PAT acts as you, so you can't "approve" your own PR in GitHub — use required status checks with 0 required approvals, or a GitHub App. Recommended once the app has real users.

## 8. Long agent jobs vs Netlify time limits

Netlify: synchronous and **streaming** functions stop at **60 s**; **background** functions run up to **15 min**, return `202` immediately, can't stream, are retried after 1 and 2 min on failure ([limits](https://docs.netlify.com/build/functions/configuration/#default-values), [background](https://docs.netlify.com/build/functions/background-functions/)). Routes and the job nonce: §2. Limits that apply before any of this starts (per-user counts, the compute budget): §9.

| Job | Where it runs | How the UI gets output |
|---|---|---|
| Chat turn (most messages) | `POST /api/chat`, streaming | SSE events directly (§2.1) |
| Turn that needs many tool rounds, or a multi-file proposal | `POST /api/jobs` (sync: auth, limits, job record, nonce) starts `POST /api/jobs-run` (background) | Poll `GET /api/jobs/:id` every 2–3 s; Blobs holds an append-only event list in the same shapes as the SSE events |
| A chat turn that runs out of time | `/api/chat` hands off to `/api/jobs-run` | `handoff` event, then polling as above |
| Anything > 15 min | Split into steps, or move to Claude Managed Agents (doc 05 §9) | Poll |

Patterns:

* **One deadline per chat turn.** `/api/chat` notes its start time. Every Claude call gets an `AbortSignal` for the time left before **55 s**, passed as the SDK request option `signal`, so a retry can't run past the deadline either. The client-level `timeout: 50_000` stays as the per-attempt ceiling. A new tool round starts only if at least 15 s are left; otherwise the turn hands off.
* **Hand-off.** With work remaining, `/api/chat` saves the conversation state (the full `messages`, including `tool_use`, `tool_result` and `thinking` blocks, and the pinned `baseSha`, ADR-0007) to the job record, emits `handoff {jobId}` then `done {stopReason: "handoff"}`, and starts `/api/jobs-run` the same way `/api/jobs` does (forwarded `Authorization`, single-use nonce). The hand-off counts as one of the user's daily jobs (§9). The browser refreshes its token beforehand when it has less than 120 s left (§4.1), because `/api/jobs-run` checks the token only at its start.
* **Anthropic SDK client.** Created once per function instance, after the production-context check (§4.6), as `new Anthropic({ baseURL: "https://api.anthropic.com", apiKey: process.env.ANTHROPIC_API_KEY, timeout, maxRetries })`. Both `baseURL` and `apiKey` are explicit, so an injected `ANTHROPIC_BASE_URL` or AI-Gateway variable can't reroute the calls (docs/03 §5). `timeout: 50_000` and `maxRetries: 1` in chat; `timeout: 840_000` and `maxRetries: 2` in `jobs-run`.
* **Model.** The model ID comes from `agents.json` and must be one of `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` (§11). Anything else is a `500 internal` that never reaches Claude.
* **Idempotency:** `jobs-run` may be retried. It claims the job with a CAS (`queued` → `running`), so a retry finds it taken and exits; step results are written with `onlyIfNew`. **Never commit from a job**: commits happen only in Approve.
* **Caps per job:** ≤ 15 tool rounds, the token cap and the wall clock from §9. At about 14 min (or the compute-budget limit, if lower) the job saves its state and becomes `paused`; the UI offers "Continue", which is a new `POST /api/jobs` and counts as a new job.
* **Streaming format to the browser:** only the §2.1 events (`text`, `tool`, `proposal`, `handoff`, `error`, `done`), never raw Anthropic events, thinking or signatures. Headers: `content-type: text/event-stream`, `cache-control: no-store`, `x-content-type-options: nosniff`. A refusal drops the partial reply and ends with `error {code: "refusal"}`. Netlify's streaming limit is 20 MB per response. Worked example: `knowledge/agent-console-engineer/examples/01-streaming-chat-function/`.
* **Blobs consistency:** use `strong` for job and proposal records (eventual can lag up to 60 s).

## 9. Rate limits & cost controls

Owner: security-engineer, with netlify-engineer for the platform rules. Every limit is checked **after** the token-and-role check (§4.1) and **before** any Claude, GitHub or long-running work. Over a limit → `429` with `{"error":{"code":"rate_limited"|"approve_cap"|"budget_exhausted","message","retryAt"}}`.

| Layer | Limit | Where / how |
|---|---|---|
| Netlify `config.rateLimit` (code-based; **2 rules on Free**) | `/api/chat` 20 per 60 s; `/api/jobs` 10 per 60 s; both `aggregateBy: ["ip","domain"]` | In each function's `config` ([rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)). These are the two routes that start Claude spend and long compute. `/api/login` no longer exists. Approve doesn't need one: it is capped below, and it is serialised by the approve lock. Check the deploy log: a bad rule doesn't fail the deploy |
| Per user per day (Blobs, CAS, key `<action>/<user id>/<YYYY-MM-DD>`, America/New_York day) | **200 chat turns**, **20 jobs** | Counted when the turn or job **starts**, and never refunded, so a failing retry loop still uses up the budget |
| Per chat turn / per job | ≤ **15 tool rounds**; ≤ **1,000,000 tokens** (sum of `input_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` and `output_tokens` over all rounds); `max_tokens` capped per call; user message ≤ 32 KB; job wall clock ≤ 14 min | Checked before each Claude call. On exceeding, stop with `done.stopReason: "tool_rounds_exhausted"` or `"max_tokens"` and keep partial state |
| **Site-wide compute budget** (Blobs, key `site:compute`, CAS, rolling 31 days) | **180 function-minutes** of `/api/chat` + `/api/jobs-run` wall time, about 30 credits at 1024 MB | **New, needs Dr. Lee's confirmation of the number.** Without it, the per-user limits can't bound Netlify credits: one 15-min job is about 2.5 credits, so 20 jobs a day would be about 50 credits a day (knowledge/netlify-engineer/docs/07; billed duration **UNVERIFIED**). Before a chat turn, require ≥ 60 s left; before a job, require ≥ 5 min left and set the job's wall-clock limit to min(14 min, remaining). Record actual elapsed time when the turn or job ends, and at each job progress write. Over → `429 budget_exhausted` |
| **Approve cap (ADR-0008)** | **Site-wide, all users:** at most **14** committed approvals in any rolling 31 days and **5** per America/New_York day | Blobs `ratelimit` key `site:approvals`, checked inside the approve lock. Over → `429 approve_cap`, and the proposal stays `pending` |
| Anthropic | Dedicated workspace with a low monthly **spend limit** (hard stop) | Anthropic console (Dr. Lee) |
| GitHub | Serial requests; ≤ 1 approve in flight (CAS lock in Blobs) | §7 |
| Netlify credits | 300/month on Free; 15 per production deploy | Approve cap = 210 credits; compute budget about 30; the rest is for human pushes and bandwidth (docs/03 §10) |

**Approve slots and failures (decided).** A slot is consumed only when a proposal reaches `committed` (ADR-0008), so `failed`, `stale`, `rejected` and `approve_cap` never use one, and there is nothing to refund. Two edge cases must still count:
- **Reconciliation.** When a record stuck in `committing` is reconciled to `committed` because a commit on `main` passes every §7 reconciler check (final-line trailer, author, one parent, blob SHAs), append its timestamp to `site:approvals` at reconciliation. A full page of commits with no match is "unknown" (stay `committing`), never "not found", so a busy `main` can't hide a landed commit and undercount the cap.
- **Unknown outcome on the ref update.** If step 6 (`PATCH …/refs/heads/main`) times out or errors, re-read `refs/heads/main` before deciding. If it now equals `commitSha`, the outcome is `committed`, and it counts. Only otherwise is it `failed`.

The aim is that the cap never undercounts a commit that actually deployed.

## 10. Headers & browser-side rules

Owner: security-engineer. `public/_headers` is the only place static headers are set (docs/03 §3.2) and is denied to agents.

**Function responses** (`_headers` doesn't apply to them; every function sets its own, on every status including 401, 403, 429 and 503):
- `cache-control: no-store`
- an explicit `content-type`
- `x-content-type-options: nosniff`
- for JSON: `content-security-policy: default-src 'none'; frame-ancestors 'none'`
- `www-authenticate: Bearer` on 401

Never send any `Access-Control-Allow-*` header, and never a `Set-Cookie`.

**Static CSP: one site-wide policy.** The final value, once the Supabase project exists:

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com https://<project-ref>.supabase.co; manifest-src 'self'; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

Decisions behind it:
- **The Supabase host is site-wide, exact, and never a wildcard.** A Console-only `connect-src` would need a second CSP rule for `/console`. How Netlify combines two rules that set the same header on one path is **UNVERIFIED** (docs/03 §3.2), and two policies on one response would both apply, so the narrower one would break sign-in. The cost of the wider rule is small: the beach app has no auth code, and the host is our own project, not `*.supabase.co`.
- **The build checks that the host in `_headers` equals the host of `SUPABASE_URL`.** A mismatch fails the build.
- **`script-src 'self'` holds.** The vendored `public/vendor/supabase-auth-js-<ver>.mjs` contains no `eval` or `new Function` (software-architect example 04). `public/generated/config.js` is a same-origin module. No inline script, no CDN, no `'unsafe-eval'`, no `'unsafe-inline'`.
- **Google needs no CSP entry.** `signInWithOAuth` is a top-level navigation to `<project>/auth/v1/authorize`, then to Google and back. Neither `connect-src` nor `form-action` governs a script-initiated navigation (CSP specification; not a Netlify fact). Never implement sign-in as an HTML `<form action>` that posts to Supabase or Google: `form-action 'self'` would block it, and that is intended.
- **`img-src 'self' data:`.** Don't render Google avatar URLs; show initials instead. That also keeps the Markdown image-exfiltration path closed.
- Any proposal-style change to the CSP is a human change reviewed by security-engineer. Adding a host or `'unsafe-*'` needs a written reason.

**Other static headers** (docs/03 §3.2):
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`, which keeps the PKCE `code` out of cross-origin referrers
- `Permissions-Policy: geolocation=(self), camera=(), microphone=()`
- `Strict-Transport-Security`
- `noindex` and `no-store` on `/console`

Recommended addition: `Cross-Origin-Opener-Policy: same-origin`. It is safe because sign-in uses redirects, not pop-ups.

**Browser rules:**
- Render agent output as **text**, or as Markdown through a sanitizer with no raw HTML and no remote images. Never use `innerHTML` with model output, file contents, diffs or Supabase error messages.
- The service worker never caches `/api/**`, `<SUPABASE_URL>/**` or `/version.json`.
- No URL parameter ever triggers a state change (§4.4).
- **Logging:** log `requestId`, route, status, duration, user id (`sub`), agent, proposal ID and commit SHA. Never log request bodies, the `Authorization` header, tokens, `apikey` values or env.

## 11. Agent list & personality

`scripts/build-agents.mjs` parses `.claude/agents/*.md` (YAML frontmatter + body) into the git-ignored `netlify/functions/lib/agents.json` at build time (docs/03). Per agent it records `name`, `persona` (first name), `description`, `personality` (custom field; Claude Code ignores unknown fields), `model` (alias resolved to an ID), `color`, `skills` (names) and `systemPrompt`.

- **System prompt** = the agent body, then the full `SKILL.md` of each `skills:` entry in listed order (the Console's equivalent of Claude Code's preload). It contains no timestamps or build ids, so it stays cacheable (doc 05 §4). A `skills:` entry without a matching folder fails the build.
- **Model allow-list.** `opus`, `inherit` or a missing `model:` → `claude-opus-5-5`; `sonnet` → `claude-sonnet-5-5`; `haiku` → `claude-haiku-5-5`. Any other value, including `fable` or a full model ID, **fails the build** with the file name, so an approved agent edit can't switch the Console to an unlisted or pricier model. The functions re-check the resolved ID against the same three IDs (§8). Widening the list is a human change to `scripts/**` and `netlify/**`.
- **`GET /api/agents`** returns everything except `systemPrompt`, after the §4.1 check. It is also the Console's access check (§1 step 2): `403` there is the "no access" screen.
- `personality` falls back to `description` when missing. Cards show name, persona, personality, a model badge with text ("Opus", "Sonnet", "Haiku"), and the colour as decoration only.
- `.claude/agents/*.md` is in the deploy path list (§1), so an approved edit to an agent file appears in the Console after that deploy. Details: doc 05 §3.

## 12. Build checklist for `agent-console-engineer` + `security-engineer`

Security items (security-engineer owns them; qa-engineer writes the tests):
- [ ] Every `/api/*` function runs the token-and-role check first (§4.1). On **every** function, tests prove: no token → 401; garbage, expired, bad-signature, wrong-`iss` or anonymous token → 401; role `user` or no row → 403; Supabase or JWKS down → 503; and nothing touches Blobs, GitHub or Claude in any of those cases. For `/api/jobs-run`: no work and no writes.
- [ ] Approve: `getUser` + step-up (§4.2). Tests: primary sign-in 601 s old → 401 `step_up_required`; only `token_refresh` fresh → 401; fresh `totp` with stale sign-in → 401; verified factor with `aal1` → 401; fresh sign-in → passes.
- [ ] `getClaims` and `getUser` failures that auth-js **returns** (`AuthRetryableFetchError`, network or 5xx) → 503 on every function and on Approve, tested with a returned error, not a thrown one. Map with auth-js's own `isAuthRetryableFetchError`, not a `name` string compare. The real guard is supabase-auth-engineer example 01 (`iss`, `aud`, `is_anonymous`, role read); netlify-engineer's `guard.mjs` + `adaptClaimsVerifier` is a shape stand-in and skips those checks, so never ship it as the verifier. Once (f) passes: the header pre-check returns 401 for `HS256`, `none`, a missing `kid` or a non-JSON header with no network call.
- [ ] **Pre-launch on the real project** (§4.2 (a)–(i)). `APPROVE_ENABLED` and `JWT_HEADER_PRECHECK` are server constants in code (not env vars); a test asserts both are `false` in the first build.
- [ ] `POST` routes reject a cross-site `Sec-Fetch-Site` or a foreign `Origin` with 403. No `/api/*` response carries `Access-Control-Allow-*` or `Set-Cookie`.
- [ ] No secret appears in any response, log or bundle. A test greps `public/` and the build output for `sk-ant-`, `github_pat_`, `ghp_`, `sb_secret_` and full JWTs.
- [ ] Allow-list unit tests cover the canonical list (§6), including `public/_headers`, `public/sw.js`, `public/sw/**`, `public/vendor/**`, `public/generated/**`, `public/version.json` and `.claude/settings*`, plus `..`, absolute, backslash, case tricks (`Netlify.toml`, `public/_Headers`) and symlink mode.
- [ ] The secret scan uses the rules in `agent-console-security`, with positives and negatives. The bare word `service_role` in docs must not fire.
- [ ] Approve re-validates the allow-list, size, secret scan and content hash, and uses a CAS status update.
- [ ] Always `base_tree`; `force:false`; stale-base handling; an unknown ref-update outcome is re-read before `failed` (§9).
- [ ] **No deletions:** every tree entry has `content` and mode `100644`; a test fails if the approve code can emit `sha: null` (§6).
- [ ] **Summary and commit message** (§6, §7 step 5): `propose_change` rejects a summary with any `\p{Cc}`, `\p{Cf}`, U+2028/2029 or trailer text; `buildCommitMessage` always ends with exactly one trailer line, removes nested trailer text until stable, and cuts by code point. Content with a lone surrogate is rejected. Reference: security-engineer example 02, `commitmsg.mjs` (6 tests, 5 mutants).
- [ ] **Reconciler** (§7): matches only on final-line trailer + exact author + one parent + equal blob SHAs; near-misses (trailer in the body, human author, merge commit, other content) are ignored; a full page with no match stays `committing`.
- [ ] **`GET /api/proposals/:id` reads GitHub** (it runs the reconciler), so it is a secret-reading function: it runs the production-context check before loading a token, and it uses the **read-only** GitHub module (`GITHUB_TOKEN` under ADR-0007, `GITHUB_READ_TOKEN` if ADR-0009 is accepted), never the write module.
- [ ] At the limit check, an unreadable `site:compute` record (in chat and jobs) or `site:approvals` record (in approve) means a Blobs error or a bad shape → `503 unavailable`, never "allowed" (netlify-engineer example 03, `assertComputeShape`; the approvals record needs the same shape check). The advisory `approvals: null` in `GET /api/proposals/:id` (§1) is display only and is not this check.
- [ ] GitHub and Anthropic secrets are Production-context only; Deploy Previews and branch deploys are off; functions return 503 outside `production` (§4.6).
- [ ] Limits return 429 with a friendly UI message: per-user counters, the compute budget, the Approve cap (5th/6th in a day, 14th/15th in 31 days).
- [ ] The CSP equals §10 exactly (e2e reads the header), and the build fails if the Supabase host in `_headers` differs from `SUPABASE_URL`.
- [ ] No test runner in the Netlify build command; the GitHub Actions workflow has `permissions: contents: read` and no secrets (§4.7).

Other items:
- [ ] Chat stays < 60 s; the hand-off to the background function works; the background function is idempotent.
