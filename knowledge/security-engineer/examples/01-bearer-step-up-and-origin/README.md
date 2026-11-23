# Example 01: Approve step-up and the Origin check (Bearer-token era)

Replaces the retired `01-password-and-session` example (scrypt password, HMAC cookie, CSRF token). Those controls left with ADR-0006.

## What it shows
`stepup.mjs` holds the two checks that run **after** the token-and-role guard. The guard itself is supabase-auth-engineer's example (`knowledge/supabase-auth-engineer/examples/01-token-and-role-check/`) and is not repeated here.

**`checkStepUp({claims, user, now})`** is the Approve rule from docs/04 §4.2. Every condition must hold:
1. `getUser(token)` returned the same user id as the token's `sub`, and the user is not banned.
2. The session's newest `amr` entry with method `password` or `oauth` is no more than **600 s** old. A timestamp up to 60 s in the future is accepted for clock skew.
3. `user.last_sign_in_at` is also no more than 600 s old. This is a server-side corroboration in case the `amr` timestamp behaves unexpectedly across refreshes.
4. If the user has any **verified** MFA factor, the token's `aal` must be `aal2`.

Why it is built this way:
- **Only `password` and `oauth` count.** `token_refresh`, `recovery`, `otp`, `magiclink` and the other `amr` methods do not prove that someone just signed in. The method list comes from Supabase's JWT fields page.
- **`totp` is never a substitute for a fresh sign-in.** If it were, a thief holding a stolen aal1 session could enrol their own TOTP factor and then "step up" with it. The test row "token thief enrols own TOTP" covers that case. TOTP only *adds* the aal2 requirement.
- **Array order is not trusted.** Supabase documents `amr` as most-recent-first, but the code takes the maximum timestamp anyway.
- **Types are strict.** A string timestamp, a missing `amr` or a non-array `amr` all fail.

**`approveStepUp(token, claims, getUser, now, isRetryable)`** calls `getUser`:
- **auth-js returns network and 5xx failures; it does not throw them.** `getUser` answers `{ data: { user: null }, error: AuthRetryableFetchError }` (knowledge/supabase-auth-engineer/examples/01, test 21). A returned error for which `isRetryable(error)` is true becomes **503 `unavailable`**. Real code passes auth-js's own `isAuthRetryableFetchError`; the example's default, `looksRetryable`, copies its test (`__isAuthError` plus the name) so no npm install is needed.
- A throw of any kind also becomes **503 `unavailable`**.
- Any other returned error (for example 403 `session_not_found` after sign-out, or `user_banned`), or no user, becomes **401 `unauthorized`**.
- The error is never echoed (the test checks the response for the upstream message).
- Any failed step-up rule becomes **401 `step_up_required`**, which the Console turns into its re-sign-in prompt.

**Fixed 2026-11-23 (wave 3b):** the first version mapped only a *throw* to 503, so during a Supabase outage Approve answered 401 and the Console sent the user to sign in again instead of saying "try again". Found by supabase-auth-engineer. The test table now includes returned (not thrown) retryable errors; the committed version fails those rows.

**`precheckJwtHeader(token)`** is the optional pre-check from docs/04 §4.1 step 1. It decodes only the JWT header and returns 401 unless `alg` is `ES256` or `RS256` and `kid` is a non-empty string. It verifies nothing; `getClaims` still does. It exists because `getClaims` falls back to `GET /auth/v1/user` for an unknown `kid` or an `HS*` alg, so every cheap forged token would cost one Auth call from the function's IP. Turn it on only once the project is confirmed to use asymmetric signing keys, or it rejects every real token (fail closed, but a total outage).

**Why `amr` and `last_sign_in_at` are both checked, and which one binds the session.** From the Auth server source (knowledge/supabase-auth-engineer/docs/03): an `amr` timestamp belongs to one **session** and one method, is written when that session is created by a sign-in, and is not moved by a refresh. `last_sign_in_at` belongs to the **user**, so a sign-in on any other device also makes it fresh. Rule 2 (`amr`) is therefore the rule that ties the step-up to *this* session; rule 3 is only a server-side cross-check that some sign-in really happened recently.

**`checkOrigin(req, siteOrigin)`** is defence in depth on POST routes. Bearer tokens are not sent automatically by the browser, so classic CSRF no longer applies (docs/04 §4.4). The check still rejects:
- a `Sec-Fetch-Site` header that is present and not `same-origin`, including `same-site` sibling subdomains;
- an `Origin` header that is present and not the site origin, including `null`.

When both headers are absent (a server-to-server call such as `/api/jobs` → `/api/jobs-run`), the request passes, because no browser credential can ride along.

## How to run
```bash
mkdir -p /tmp/sec01 && cp *.mjs /tmp/sec01 && cd /tmp/sec01
node --test stepup.test.mjs     # Node built-ins only
```

## Verified
Run on 2026-11-23 (wave 3b) with Node v22.23.5, from a scratch copy outside the repo. The step-up and Origin rows are unchanged from the first run and pass as before; the output below shows the new rows:

```
$ node --test stepup.test.mjs
# PASS  true  fresh password sign-in (2 min)
  ... (21 step-up rows, all PASS, as before)
# PASS  503 unavailable thrown network error
# PASS  503 unavailable RETURNED network error (status 0), the auth-js shape
# PASS  503 unavailable RETURNED 502 from /user
# PASS  401 unauthorized returned 403 session_not_found (signed out)
# PASS  401 unauthorized returned 403 user_banned
# PASS  401 unauthorized plain-object error (not an auth error)
# PASS  401 unauthorized name only, no __isAuthError marker
# PASS  401 unauthorized no error and no user
# PASS  401 unauthorized undefined result
# PASS  true  ES256 with kid
# PASS  true  RS256 with kid
# PASS  false HS256 (legacy secret or forged)
# PASS  false alg none
# PASS  false alg lower-case es256
# PASS  false kid missing
# PASS  false kid empty
# PASS  false kid not a string
# PASS  false header not JSON
# PASS  false header is an array
# PASS  false two parts
# PASS  false padding / bad chars in header
# PASS  false oversized token
# PASS  false not a string
  ... (7 Origin rows, all PASS, as before)
ok 1 - step-up table
ok 2 - approveStepUp: getUser failures fail closed
ok 3 - precheckJwtHeader: cheap forgeries rejected before getClaims
ok 4 - Origin / Sec-Fetch-Site defence in depth
# tests 4
# pass 4
# fail 0
```

Regression check: the committed (pre-fix) `approveStepUp` given a *returned* `AuthRetryableFetchError` answered `401 unauthorized`; the fixed one answers `503 unavailable`.

## What this example cannot prove (pre-launch tests on the real project, docs/04 §12)
These depend on how Supabase behaves, and supabase.com was blocked from the sandbox. Each one is **UNVERIFIED** until run against Dr. Lee's project:
1. The `password`/`oauth` `amr` timestamp stays at the **sign-in** time after a token refresh. The Auth server source supports this (the refresh grant writes no `amr` row), but hosted behaviour is still to be tested. If a refresh moves it forward, rule 2 is meaningless, and Approve must stay disabled until security-engineer re-specifies the rule.
2. A second `signInWithPassword` (or Google sign-in) in the same browser produces a new, current timestamp.
3. `last_sign_in_at` is updated by both password and Google sign-ins, and is not updated by a refresh.
4. `getUser(token)` after `signOut({scope:'local'})` on that session. If it still succeeds, a signed-out token keeps working until `exp` (10 min).
5. After a TOTP verify the token carries `aal2`.
6. A real access token's header has `alg` `ES256` or `RS256` and a `kid` (needed before `precheckJwtHeader` is switched on).
