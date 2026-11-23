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

**`approveStepUp(token, claims, getUser)`** calls `getUser`:
- A thrown network error becomes **503 `unavailable`** (fail closed, error not echoed).
- An error or empty user from `getUser` becomes **401 `unauthorized`**.
- Any failed step-up rule becomes **401 `step_up_required`**, which the Console turns into its re-sign-in prompt.

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
Run on 2026-11-23 with Node v22.23.5, from a scratch copy outside the repo:

```
$ node --test stepup.test.mjs
# PASS  true  fresh password sign-in (2 min)
# PASS  true  fresh Google sign-in (9 min 59 s)
# PASS  true  exactly 10 min
# PASS  false 10 min 1 s: too old -> primary_sign_in_too_old
# PASS  false only token_refresh is fresh -> primary_sign_in_too_old
# PASS  false recovery link is not a step-up -> primary_sign_in_too_old
# PASS  false otp / magic link is not a step-up -> primary_sign_in_too_old
# PASS  true  array order is not trusted (fresh entry last)
# PASS  false timestamp 2 min in the future -> primary_sign_in_too_old
# PASS  true  timestamp 30 s in the future (skew ok)
# PASS  false amr missing -> primary_sign_in_too_old
# PASS  false amr malformed -> primary_sign_in_too_old
# PASS  false timestamp as string -> primary_sign_in_too_old
# PASS  false fresh amr but last_sign_in_at stale -> last_sign_in_too_old
# PASS  false last_sign_in_at missing -> last_sign_in_too_old
# PASS  false verified TOTP factor, token aal1 -> aal2_required
# PASS  true  verified TOTP factor, token aal2
# PASS  true  unverified factor only, aal1 ok
# PASS  false token thief enrols own TOTP: fresh totp + aal2 but old sign-in -> primary_sign_in_too_old
# PASS  false getUser returned another user -> user_mismatch
# PASS  false banned user -> banned
# PASS  true  same-origin fetch
# PASS  false cross-site POST -> cross_site
# PASS  false same-site sibling subdomain -> cross_site
# PASS  false foreign Origin, no Fetch Metadata -> bad_origin
# PASS  false Origin null (sandboxed iframe) -> bad_origin
# PASS  true  no Origin, no Fetch Metadata (server-to-server, jobs -> jobs-run)
# PASS  true  GET is not checked
ok 1 - step-up table
ok 2 - approveStepUp: getUser failures fail closed
ok 3 - Origin / Sec-Fetch-Site defence in depth
# tests 3
# pass 3
# fail 0
```

## What this example cannot prove (pre-launch tests on the real project, docs/04 §12)
These depend on how Supabase behaves, and supabase.com was blocked from the sandbox. Each one is **UNVERIFIED** until run against Dr. Lee's project:
1. The `password`/`oauth` `amr` timestamp stays at the **sign-in** time after a token refresh. If a refresh moves it forward, rule 2 is meaningless, and Approve must stay disabled until security-engineer re-specifies the rule.
2. A second `signInWithPassword` (or Google sign-in) in the same browser produces a new, current timestamp.
3. `last_sign_in_at` is updated by both password and Google sign-ins, and is not updated by a refresh.
4. `getUser(token)` after `signOut({scope:'local'})` on that session. If it still succeeds, a signed-out token keeps working until `exp` (10 min).
5. After a TOTP verify the token carries `aal2`.
