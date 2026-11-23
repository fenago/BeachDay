# 0006 — Supabase Auth for the Agent Console (supersedes 0001)
- Status: Accepted
- Date: 2026-11-23
- Deciders: Dr. Lee (+ software-architect drafted; security-engineer, netlify-engineer, supabase-auth-engineer to review the implementation)

Supersedes [0001](0001-static-site-plus-functions.md). Everything in 0001 that this ADR does not change still holds and is restated in Decision 1, so this file is the single current statement of the system boundary.

## Context
- ADR-0001 allowed a static front end, Netlify Functions only for the Claude and GitHub calls, and "no other servers, databases or third-party backends". The Console was protected by one shared password: `CONSOLE_PASSWORD_HASH` checked in `/api/login`, then an HMAC-signed cookie keyed by `SESSION_SECRET` (old docs/04 §4).
- Dr. Lee decided on 2026-11-23 to replace the password with **Supabase Auth**: email/password sign-up, log-in, log-out and forgot/reset password, plus "Continue with Google" through `signInWithOAuth({ provider: 'google' })`. A `profiles` table holds one row per user with a `role` that defaults to `'user'`. Only `super_admin` may open the agents, chat or Approve, and only Dr. Lee sets that role, by hand.
- Supabase is a third-party backend with a hosted Postgres database, which ADR-0001 forbids. This is also a trust-boundary change: identity moves from a secret we hold to tokens issued by Supabase. So it needs a superseding ADR.
- Netlify's own site password needs the Pro plan and does not protect functions (docs/04 §4, ADR-0004), so the check stays in our functions either way.
- **No build step for `public/`** (`web-platform-vanilla`). Checked on 2026-11-23 against the npm tarballs: `@supabase/supabase-js@2.119.2` ships no single-file browser build. Its `dist/index.mjs` imports `@supabase/auth-js`, `@supabase/postgrest-js`, `@supabase/realtime-js`, `@supabase/storage-js` and `@supabase/functions-js` by bare specifier, which a browser can't resolve without a bundler or import map. An esbuild bundle of `@supabase/auth-js@2.119.2` alone is 104,198 bytes (about 25 KB gzipped), has no `eval` or `new Function`, and exposes `signUp`, `signInWithPassword`, `signInWithOAuth`, `signOut`, `resetPasswordForEmail`, `updateUser`, `reauthenticate`, `getSession`, `getClaims`, `onAuthStateChange` and `exchangeCodeForSession`. The full supabase-js bundle is about 59 KB gzipped. See `knowledge/software-architect/examples/04-vendored-auth-client/`.
- The CSP is `script-src 'self'`, with no CDNs (`secure-by-design`).
- **Supabase plan limits and costs are [UNVERIFIED]:** supabase.com was not reachable from the research sandbox on 2026-11-23. Check the Free plan's auth MAU limit and its inactivity-pause rule on https://supabase.com/pricing before launch.

## Decision
We will use Supabase Auth for identity only. The system boundary becomes:

1. **System boundary (restates 0001 with one addition).**
   - The front end is a static PWA on Netlify (`public/`), and the browser calls Open-Meteo directly.
   - **New:** only the Console page (`/console`) calls Supabase Auth directly from the browser, at `<SUPABASE_URL>/auth/v1/*`. The public beach app never loads auth code and never calls Supabase.
   - Netlify Functions are used only for the Claude and GitHub calls behind the Console, plus that Console's own agent list, job and proposal endpoints. Netlify Blobs holds their state.
   - No other servers. Supabase holds **only** `auth.users` and `public.profiles (id, role)`. We will not put app data, proposals, jobs or audit records in Supabase, and we will not use Supabase Edge Functions, Storage or Realtime. Blobs remains the only app-state store.

2. **Keys.** We will use only the project URL and the **publishable** key, in the browser and in functions alike. The secret key and the legacy `service_role` key are never put in an env var, the repo or any code. The build fails if `SUPABASE_PUBLISHABLE_KEY` does not start with `sb_publishable_`. This catches a pasted secret key and the legacy JWT-style keys, which look alike.

3. **Config reaches the browser at build time.** The build step (netlify-engineer's script, docs/03) writes `public/generated/config.js` from the env vars, exporting `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `BUILD_VERSION` (from `COMMIT_REF`). It also writes `public/generated/version.json` as `{"commit": "<COMMIT_REF>"}`. It never prints env. `public/generated/` is git-ignored, so the env var stays the single source of truth for functions and browser alike. There is no `/api/config` endpoint, because every function requires a token (point 5).

4. **Library: vendored, pinned, auth only.**
   - We will vendor `@supabase/auth-js` at an exact version (2.119.2 when this was written). A human bundles it once with esbuild (ESM, browser platform, minified) into `public/vendor/supabase-auth-js-<version>.mjs` and commits it with its MIT licence file.
   - Only `console.html`'s module graph imports it, through a relative path. There is no CDN and no import map, and `script-src 'self'` is unchanged.
   - Functions depend on the same package at the same exact version in `package.json`, for token verification. A unit test asserts that the two versions match.
   - Upgrading means a human re-bundles, updates `package.json` and gets a security-engineer review.
   - Supabase's docs show `supabase.auth.<method>`. These map one to one onto the `AuthClient` instance (the same GoTrue client).

5. **Every function checks the token and the role on every request, and fails closed.**
   - Input: `Authorization: Bearer <access token>`. Verify the token with the mechanism supabase-auth-engineer records (`getClaims()` against the project JWKS, or `getUser(token)`).
   - Then read `role` with one PostgREST call made *as the caller*: `GET <SUPABASE_URL>/rest/v1/profiles?select=role&id=eq.<sub>` with `apikey: <publishable>` and the caller's bearer token. Row Level Security allows only the caller's own row.
   - Outcomes:
     - no token, or a bad or expired one → `401`;
     - verified, but no row or `role !== 'super_admin'` → `403`;
     - Supabase unreachable or any unexpected error → `503`. Never allow.
   - The role is not cached between requests, so a demotion takes effect on the next request.
   - The background job function gets the caller's bearer token forwarded and re-runs the same check before doing work (point 7).

6. **The browser never reads `profiles`.** The Console shows its "no access" state when `GET /api/agents` returns `403`. Browser → Supabase traffic is `/auth/v1/*` only. The client-side check is cosmetic; the function check is the control.

7. **Removed:** `/api/login`, `/api/logout`, the `bd_session` cookie, the CSRF token header, `CONSOLE_PASSWORD_HASH` and `SESSION_SECRET`.
   - Log-out is `signOut()` in the browser.
   - The old "signed single-use job token" between `/api/jobs` and the background function is replaced by a random 256-bit nonce. It is stored in the job record and consumed with a Blobs compare-and-swap, so no shared secret is needed.
   - Env vars become:
     - non-secret: `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `GITHUB_REPO`;
     - secret: `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`.

8. **No unauthenticated functions.** We will drop the planned `deploy-succeeded` event function. The Console shows "Live" by polling `/generated/version.json` (served `no-store`, never cached by the service worker) until `commit` equals the approved `commitSha`.

9. **Agents cannot edit the auth plumbing.** `public/vendor/**` and `public/generated/**` join the Console deny-list (docs/04 §6). The canonical list is in docs/04 §6 and in the `change-proposal-protocol` skill.

## Consequences
- **Good:** real per-person accounts, so the audit log records a user id instead of "console". Password reset, email confirmation, leaked-password protection and Google sign-in come from Supabase instead of our own code. Two secrets fewer to rotate or leak (`CONSOLE_PASSWORD_HASH`, `SESSION_SECRET`). The bearer token is sent in a header, not a cookie, which removes the cookie-CSRF class; security-engineer confirms this in docs/04 §3.
- **Good:** the public beach app is untouched. It has no auth code, no extra bytes and no Supabase calls. The vendored client (~24 KB gzipped) loads only on `/console`.
- **Bad: a new external dependency.** If Supabase is down or the free project is paused [UNVERIFIED], the Console fails closed (`503`/`401`) and nobody can chat or Approve. The beach app keeps working. Recovery: unpause or restore the project.
- **Bad: latency and coupling.** Each function call adds one PostgREST round trip for the role, and token verification may add a JWKS fetch until it is cached.
- **Bad: tokens live in the browser.** supabase-js stores the session in `localStorage` by default, so an XSS on `/console` could steal it. security-engineer owns the mitigations (CSP, storage choice, step-up re-auth before Approve) in docs/04 §3–4 and §10.
- **Bad: manual upgrades.** The vendored file is upgraded by hand, and the two pinned versions must move together. A stale vendored file is a security risk if an advisory appears.
- **Neutral: config.** `SUPABASE_URL` and the publishable key are public by design. They appear in `public/generated/config.js` on every deploy. netlify-engineer must check that Netlify secret scanning doesn't flag the publishable key in build output [UNVERIFIED].
- **Neutral: Netlify cost.** Functions run slightly longer per request because of the role lookup, and there are no extra deploys. Supabase Free is expected to cost $0 [UNVERIFIED].
- **ADR-0004 is now partly outdated:**
  - its consequence "The Console password gate is implemented in the functions, not by Netlify" now reads "the Supabase token and role check is implemented in the functions";
  - its `/api/login` `config.rateLimit` rule no longer has a route. Security-engineer and netlify-engineer reassign that second rule in docs/04 §9 and docs/03.
  - ADR-0004's decision (stay on Free) is unchanged, so it is not superseded, and accepted ADRs are not edited.
- **ADR-0005 is unchanged.** The PAT, its scope and its storage stay as they are. The env/secret list change is recorded here.
- **Follow-up:**
  - Dr. Lee: the manual Supabase setup in docs/README.md "Build plan".
  - supabase-auth-engineer: the verification mechanism and the profiles/RLS SQL.
  - security-engineer: docs/04 §3, §4, §9 and §10, and the CSP `connect-src` for the Supabase origin.
  - netlify-engineer: the generated config, version.json, the env table and the header scoping in docs/03.
  - agent-console-engineer: Bearer handling in the Console client and docs/04 §1, §2 and §5.
  - qa-engineer: 401/403/503 tests on every function.

## Revisit when
- A second role or more than a handful of users is needed (consider custom JWT claims instead of a per-request lookup), or Supabase Free limits or project pausing interfere with use.
- A security advisory affects the vendored `@supabase/auth-js` version.
- We move to a custom Supabase domain; the build's URL check and the CSP change then.
- Netlify offers per-function authentication on the Free plan that covers our needs, or the app adds public user accounts. A public-app login would be a new product decision and a new ADR.
