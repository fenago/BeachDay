---
name: supabase-auth
description: Supabase Auth rules for the Beach Day Agent Console — the per-request token and role check every function runs, which key goes where, session handling and log-out, and what is still unverified. Use when building, reviewing or testing Console sign-in or any /api/* function.
---
# Supabase Auth in Beach Day (details: knowledge/supabase-auth-engineer/docs/; canonical rules: docs/04 §4)

## Standing rules
- **Only the Console's `super_admin` may open Agents, chat or Approve.** Everyone else signs up, signs in and sees a "no access" screen.
- **Every `/api/*` function runs the check first and fails closed:**
  - **401** for a missing or bad token;
  - **403** for a valid user who is not `super_admin`, or has no row;
  - **503** when the check could not run: a network error, timeout, 5xx, an unreachable JWKS on a cold instance, or any unexpected status or exception.
  Never allow, never echo the error. A 503 must never show "no access".
- **Keys:** only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (both non-secret). The secret key and the legacy `service_role` key are used nowhere. Send the publishable key on `apikey` and the user's token on `Authorization: Bearer`.
- **Library:** functions use `@supabase/auth-js` pinned to an exact version (ADR-0006). The browser uses the vendored auth-only bundle of the same version.
- **Role source:** `public.profiles.role`, read with the user's own token so RLS returns only their row. Never trust a role in the JWT, `user_metadata` or the request body. The role is not cached.
- **`super_admin` is set by Dr. Lee in the SQL editor, by hand,** with the promotion file in example 02. No app code can grant it.

## The check, in order (reference code: knowledge/supabase-auth-engineer/examples/01-token-and-role-check/)
1. `Authorization: Bearer <jwt>` is present and has three parts. Otherwise 401.
   - **Header pre-check (docs/04 §4.1), switched on only after pre-launch test (f) shows asymmetric signing keys:** decode the header only. If it isn't a JSON object, `alg` isn't `ES256`/`RS256`, or `kid` isn't a non-empty string, answer 401 with **no network call**. It verifies nothing; it stops cheap forgeries before `getClaims` falls back to `GET /auth/v1/user`. Keep it off on a legacy HS256 project, where it would reject every real token (example 01, `headerPrecheck`).
2. `getClaims(token)` verifies signature and `exp` against the project's JWKS. Pass the token explicitly. Never `getSession()` on a server. Never `allowExpired`.
3. **auth-js returns failures; it does not throw them.** If `isAuthRetryableFetchError(error)` (network or 5xx), answer 503. For any other `error`, answer 401. Treat a throw as 503.
4. Check `iss` equals `<SUPABASE_URL>/auth/v1`, `aud` is `authenticated`, `is_anonymous` is not true, and `sub` is a string. `getClaims` does not check these for you.
5. Read the role from PostgREST (with a 5 s timeout):
   - 401 from PostgREST: answer 401.
   - Any other non-2xx, a timeout or bad JSON: answer 503.
   - Not exactly one row, or not `super_admin`: answer 403.
6. **Approve also runs the step-up in docs/04 §4.2** (`getUser(token)`, then `amr` and `last_sign_in_at` no more than 600 s old, then `aal2` if the user has a verified factor; else 401 `step_up_required`). Map `getUser`'s `{ error }` the same way as step 3.
7. Log the user id and the outcome, never the token.

## Browser side
- `flowType: 'pkce'`. The library default is `implicit`.
- `autoRefreshToken: true`.
- Before `/api/chat` or `/api/jobs`, refresh if less than 120 s are left (`ensureFresh`, example 03).
- Log-out button: `signOut({ scope: 'local' })`. The default scope is `global`, which signs out every device.
- **Access tokens live 600 s** (Dashboard setting, docs/04 §4.3). A signed-out token stays valid for `getClaims` until `exp`.
- Sessions live in localStorage, so any XSS reads the tokens. The CSP is the defence, which is why Vera owns it.
- **Step-up before Approve:** follow docs/04 §4.2. `reauthenticate()` is not a step-up. Google users re-sign-in by redirect and click Approve again. Nothing is approved from a URL.
- **Email links:** use `token_hash` templates and `verifyOtp`, which work in any browser. A PKCE `?code=` works only in the browser that started the flow (knowledge doc 06).
- Reset-password and sign-up responses must not reveal whether an email exists. That needs **Confirm email and Confirm phone** both on (doc 06).

## Project settings Dr. Lee makes (Dashboard; full table in docs/04 §4.5)
- Email confirmation on, and Confirm phone on (phone sign-in stays off).
- Password minimum length 12. Leaked-password protection is Pro plan and above.
- JWT expiry 600 s.
- Site URL and redirect allow-list: one exact `/console` URL, no wildcards; every call passes exactly it. Email templates use `token_hash` links.
- **Custom SMTP.** The built-in sender mails only team members, 2 per hour.
- Asymmetric signing keys.

## Still to test on the real project (supabase.com was blocked; some facts come from the Auth server source)
- docs/04 §4.2 tests (a)–(e). The server source supports (a), (c) and (d).
- How query strings match in the redirect allow-list.
- Linking rows 2–4 in knowledge doc 04.
- The `token_hash` templates.
- Whether Google honours `prompt=login` (UNVERIFIED).
- The project's plan and signing-key type.
