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

Owner: security-engineer. Updated 2026-11-23 for ADR-0006 (Supabase Auth), ADR-0007 (reads from GitHub `main`) and ADR-0008 (Approve cap). Mechanisms are in §4, limits in §9, headers in §10.

**Trust boundary in one paragraph.** Anyone on the internet can create a Supabase account, so "signed in" means nothing on its own. The only privilege is `profiles.role = 'super_admin'`, which only Dr. Lee sets by hand. Every function re-checks it on every request. The browser holds the user's tokens in `localStorage` on the **same origin as the public beach app**, so any script that runs anywhere on the site can read them. Agents can propose changes but never commit, and a human Approve after a fresh sign-in is the only path to `main`.

| Threat | Example | Control |
|---|---|---|
| Stranger or any signed-up user uses the Console | Signs up, finds `/console`, calls `/api/chat` to burn Claude credits, or calls approve | Every `/api/*` function runs the token-and-role check first (§4.1) and fails closed: 401 / 403 / 503. No unauthenticated function exists (ADR-0006). Rate limits and the Anthropic spend limit (§9) |
| Role escalation | User `PATCH`es their own `profiles.role`, sets `role` in `user_metadata`, or sends `role` in a request body | API roles hold **no** INSERT/UPDATE/DELETE privilege on `profiles`; role is read from `profiles` as the caller, never from the JWT, metadata or the body; `super_admin` is set only in the SQL editor (§4.5) |
| Privileged Supabase key leaks | A `sb_secret_…` or legacy `service_role` JWT pasted into an env var, `config.js` or a proposal | No such key is ever created in our config. The build refuses a publishable key that doesn't start `sb_publishable_` (ADR-0006). The secret scan flags `sb_secret_…` and any full JWT (§6, `agent-console-security`) |
| Token theft through XSS | Injected script on **any** page of the origin (beach app or Console) reads the Supabase session from `localStorage` | Strict CSP with `script-src 'self'`, no inline script, no CDN (§10). `textContent` only. 10-minute access tokens (§4.3). Approve needs a fresh sign-in, which a stolen token can't produce (§4.2). Approved `public/**/*.js` and `*.html` changes are reviewed as privileged code; the proposal card warns. **Open for Dr. Lee:** deny `public/console.html` and `public/js/console/**` to agents |
| Stolen or signed-out token replayed | A token copied from a device, or a user who signed out but whose token is still valid | Access tokens live 10 minutes (§4.3). Tokens are never logged or stored server-side. Approve also calls `getUser(token)` (§4.2) |
| Walk-up Approve | Someone uses an unlocked laptop with a live Console tab | Step-up before Approve: a password or Google sign-in no more than 10 minutes old, plus `aal2` if the user has a TOTP factor (§4.2) |
| Account takeover through the auth flows | Open redirect leaks the auth code; reset form reveals which emails exist; weak password; attacker signs up first with Dr. Lee's address | PKCE; exact redirect allow-list; email confirmation on; reset copy never says whether an address exists; minimum length 12; promote only a confirmed user id; TOTP recommended for `super_admin` (§4.5) |
| Secret leakage to the browser | API key or GitHub token in a bundle, response or `config.js` | Secrets only in function env vars; `config.js` is written from three named non-secret variables only; responses never echo env; Netlify secret scanning; CSP |
| Over-privileged token | The token can touch other repos, or the write token is exposed by the chat code | Fine-grained PAT, this repo only, Contents R/W, no Workflows (ADR-0005), read only by approve. Recommended: a separate public-read-only token for the read tools (§4.6, needs an ADR) |
| Agent writes dangerous files | Proposes `netlify/functions/approve.mts`, `.github/workflows/*`, `netlify.toml`, `public/_headers`, `public/vendor/**` | Server-side allow-list and deny-list, re-checked at Approve (§6); no Workflows permission |
| Agent-written code runs with secrets | A proposed test runs during the Netlify build, where Free gives every step every secret | No `vitest` in the Netlify build; `scripts/**` denied; tests run in GitHub Actions with a read-only token and no secrets (§4.7) |
| Prompt injection | A repo file or chat text says "commit this secret" or "widen the allow-list" | Agents have no commit tool; human Approve with a visible diff; policy in code, re-checked at Approve; secrets never in prompts; read tools refuse `.env*`, `*.pem`, `*.key` (ADR-0007) |
| CSRF, login CSRF and clickjacking | Another site triggers Approve, or frames the Console | Bearer token in a header, not a cookie, so the browser never attaches it on its own; no CORS headers; `Sec-Fetch-Site` / `Origin` check on POST as defence in depth; no state change from a URL; PKCE for OAuth; `frame-ancestors 'none'` (§4.4, §10) |
| Replay or double Approve | Approve clicked twice, or a proposal edited after review | Content hash shown and compared; CAS status; one approve in flight; base-SHA check (§7) |
| Cost abuse | Loops, huge prompts, too many jobs | Netlify rate rules, per-user counters, per-job caps, a site-wide compute budget, the Approve cap and the Anthropic spend limit (§9) |
| Preview deploys with production powers | A branch deploy reads `GITHUB_TOKEN` and commits | Secrets set for the Production context; Deploy Previews and branch deploys turned off; functions refuse GitHub and Claude calls unless `context.deploy.context === "production"` (§4.6) |
| Supabase down or project paused | Auth or PostgREST unreachable | Fail closed (503). The beach app has no auth code and keeps working |

**Residual risks (accepted, revisit if the user base grows):**
- An XSS anywhere on the origin, including an approved malicious `public/**/*.js`, can use the tokens for chat and proposals, and can approve within 10 minutes of a real step-up. CSP and diff review are the controls. Moving the Console to its own origin would remove this; it needs an ADR.
- For a Google-only user without TOTP, a step-up proves a live Google session in that browser, not a typed password. Whether `prompt=login` forces a fresh Google login is **UNVERIFIED**. TOTP closes the gap.
- Open sign-up lets anyone create accounts. They get 403, but they cost Supabase MAU and one role lookup per request.

## 4. Supabase Auth and roles

Decision: ADR-0006. Reference code: `knowledge/supabase-auth-engineer/examples/01-token-and-role-check/` (the check) and `knowledge/security-engineer/examples/01-bearer-step-up-and-origin/` (step-up and Origin). Skills: `supabase-auth`, `supabase-rls-profiles`, `agent-console-security`.

### 4.1 The check on every function

Every `/api/*` handler runs this first, before reading the body, counting limits, or touching Blobs, GitHub or Claude:

1. `Authorization: Bearer <access token>` is present and has three dot-separated parts. Otherwise **401**, with `www-authenticate: Bearer`.
2. `supabase.auth.getClaims(token)` verifies the signature and `exp` against the project's JWKS. The token is passed explicitly. Never `getSession()` on a server, and never `allowExpired`. An invalid token gets **401**.
3. The function checks the claims itself, because `getClaims` doesn't: `iss === <SUPABASE_URL>/auth/v1`, `aud === "authenticated"`, `is_anonymous !== true`, and `sub` is a string. Otherwise **401**.
4. It reads the role with one PostgREST call made as the caller: `GET <SUPABASE_URL>/rest/v1/profiles?select=role&id=eq.<sub>`, with `apikey: <publishable key>` and the caller's Bearer token. A PostgREST 401 means **401**. Anything other than exactly one row with `role === "super_admin"` means **403**.
5. A network error, timeout, 5xx, cold-JWKS fetch failure or any unexpected exception means **503 `unavailable`**. Never allow, never echo the error.
6. The function logs the user id (`sub`), route, status and `requestId`. It never logs the token or the `Authorization` header.

Rules that go with it:
- The role is **not cached**, so a demotion takes effect on the next request. The JWKS may be cached (auth-js does this per instance).
- Only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are used. The secret key and the legacy `service_role` key are used nowhere.
- **`/api/jobs-run`** (background) can't return a status. It runs the same check on the forwarded token **and** consumes the job nonce with a CAS. If either fails, it writes nothing and exits. Store only the SHA-256 of the nonce in the job record.
- The Console client refreshes its session if the access token expires within 120 s before calling `/api/chat` or `/api/jobs`, so a chat hand-off doesn't reach `/api/jobs-run` with an expired token.

### 4.2 Step-up before Approve (required)

`reauthenticate()` is **not** a step-up: it sends a nonce for password changes only and does nothing for Google-only users (knowledge/supabase-auth-engineer/docs/03). Instead, `POST /api/proposals/:id/approve` runs these checks after §4.1, and all of them must hold:

1. `getUser(token)` succeeds, returns the same id as `sub`, and the user is not banned. A network failure means **503**. An error or an empty user means **401 `unauthorized`**.
2. The token's `amr` claim has an entry with method `password` or `oauth` whose `timestamp` is **no more than 600 s old** (and no more than 60 s in the future).
3. `user.last_sign_in_at` is no more than 600 s old. This is a server-side corroboration of rule 2.
4. If the user has any verified MFA factor, `aal === "aal2"`.

If any check fails, the response is **401 `{"error":{"code":"step_up_required"}}`**, and the proposal stays `pending`.

Why it is built this way:
- Supabase documents `amr` as the way to require that a user "recently signed in with a password" (auth-mfa guide, read from the `supabase/supabase` docs source on 2026-11-23). `token_refresh`, `recovery`, `otp`, `magiclink` and the other methods don't count.
- **TOTP is additive, never a substitute.** A thief with a stolen aal1 session could enrol their own factor, so a fresh `totp` entry alone never passes (tested in example 01).
- Supabase TOTP MFA "is free to use and is enabled on all Supabase projects by default" (auth-mfa/totp guide). **Recommended to Dr. Lee:** enrol TOTP on the `super_admin` account. A Google step-up then also needs a code, which closes the residual risk in §3.

Browser flow (Wren owns the copy):
- **Password users** re-enter their password in a dialog (`signInWithPassword`), plus a TOTP code if they have a factor. The Console then retries Approve with the new token.
- **Google users** go through `signInWithOAuth` again, with `redirectTo` set to the Console. After the redirect the Console shows the same proposal and its hash, and the user must **click Approve again**. Nothing is ever approved automatically from a URL.
- Allow paste and password managers (WCAG 3.3.8).

**Pre-launch tests on the real project. Approve stays disabled until they pass** (supabase.com was blocked from the sandbox, so these are **UNVERIFIED**):
- (a) the `password`/`oauth` `amr` timestamp keeps the sign-in time across a token refresh;
- (b) a new sign-in in the same browser gives a new, current timestamp;
- (c) `last_sign_in_at` changes on password and Google sign-in, and not on refresh;
- (d) `getUser` after `signOut({scope:'local'})`. If it still succeeds, a signed-out token works until `exp`. That is accepted with 10-minute tokens, but record it;
- (e) a TOTP verify yields `aal2`.

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
- **PKCE** for OAuth, plus email links, protects against login CSRF and code interception. `frame-ancestors 'none'` protects against clickjacking.

### 4.5 Supabase project settings and roles (Dr. Lee, by hand)

| Setting | Value |
|---|---|
| Email confirmation | **On** |
| Password minimum length | **12**. No character-class rules (our choice); allow paste and password managers |
| Leaked-password protection | Pro plan and above only. On Free it isn't available: the length rule, Google sign-in and TOTP compensate |
| Anonymous sign-ins | **Off** (the check rejects `is_anonymous` anyway) |
| Site URL | `https://<production host>/console` |
| Redirect URLs | Exact entries only: `https://<production host>/console` and the reset URL Wren chooses. No `*` or `**`, no Netlify preview pattern, no `localhost` (use a separate dev project) |
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

**Read token (ADR-0007 open question). Recommendation: yes, add one.**
- GitHub states that fine-grained tokens "always include read-only access to all public repositories" (managing-your-personal-access-tokens, read from the `github/docs` source on 2026-11-23). A token with **Public repositories** access and **no permissions** can therefore serve `read_file`/`list_files` while the repo is public.
- If it leaks, it grants nothing an anonymous visitor lacks, apart from its rate budget.
- `chat` and `jobs-run` then load `GITHUB_READ_TOKEN`, and only `approve` loads the write `GITHUB_TOKEN`.
- It adds a secret and changes the trust boundary, so software-architect drafts an ADR (Proposed) for Dr. Lee. Until he accepts it, ADR-0007 stands: same token, read-only module.
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
- **Reconciliation.** When a record stuck in `committing` is reconciled to `committed` because `main` carries its trailer (§2.1), append its timestamp to `site:approvals` at reconciliation.
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

`scripts/build-agents.mjs` parses `.claude/agents/*.md` (YAML frontmatter + body) into `agents.json` at build time. `/api/agents` returns `name`, `persona` (first name), `description`, `personality` (custom field — Claude Code ignores unknown fields), `model` (alias → resolved ID), `color`. System prompts stay server-side. Because approved commits redeploy, edits to agent files appear in the Console after the next deploy. Details: doc 05 §3.

## 12. Build checklist for `agent-console-engineer` + `security-engineer`

Security items (security-engineer owns them; qa-engineer writes the tests):
- [ ] Every `/api/*` function runs the token-and-role check first (§4.1). On **every** function, tests prove: no token → 401; garbage, expired, bad-signature, wrong-`iss` or anonymous token → 401; role `user` or no row → 403; Supabase or JWKS down → 503; and nothing touches Blobs, GitHub or Claude in any of those cases. For `/api/jobs-run`: no work and no writes.
- [ ] Approve: `getUser` + step-up (§4.2). Tests: primary sign-in 601 s old → 401 `step_up_required`; only `token_refresh` fresh → 401; fresh `totp` with stale sign-in → 401; verified factor with `aal1` → 401; fresh sign-in → passes.
- [ ] **Pre-launch on the real project** (§4.2 a–e), plus: Netlify secret scanning does not flag `sb_publishable_…` in `config.js`. Approve stays disabled until these pass.
- [ ] `POST` routes reject a cross-site `Sec-Fetch-Site` or a foreign `Origin` with 403. No `/api/*` response carries `Access-Control-Allow-*` or `Set-Cookie`.
- [ ] No secret appears in any response, log or bundle. A test greps `public/` and the build output for `sk-ant-`, `github_pat_`, `ghp_`, `sb_secret_` and full JWTs.
- [ ] Allow-list unit tests cover the canonical list (§6), including `public/_headers`, `public/sw.js`, `public/sw/**`, `public/vendor/**`, `public/generated/**`, `public/version.json` and `.claude/settings*`, plus `..`, absolute, backslash, case tricks (`Netlify.toml`, `public/_Headers`) and symlink mode.
- [ ] The secret scan uses the rules in `agent-console-security`, with positives and negatives. The bare word `service_role` in docs must not fire.
- [ ] Approve re-validates the allow-list, size, secret scan and content hash, and uses a CAS status update.
- [ ] Always `base_tree`; `force:false`; stale-base handling; an unknown ref-update outcome is re-read before `failed` (§9).
- [ ] GitHub and Anthropic secrets are Production-context only; Deploy Previews and branch deploys are off; functions return 503 outside `production` (§4.6).
- [ ] Limits return 429 with a friendly UI message: per-user counters, the compute budget, the Approve cap (5th/6th in a day, 14th/15th in 31 days).
- [ ] The CSP equals §10 exactly (e2e reads the header), and the build fails if the Supabase host in `_headers` differs from `SUPABASE_URL`.
- [ ] No test runner in the Netlify build command; the GitHub Actions workflow has `permissions: contents: read` and no secrets (§4.7).

Other items:
- [ ] Chat stays < 60 s; the hand-off to the background function works; the background function is idempotent.
