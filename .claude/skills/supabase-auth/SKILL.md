---
name: supabase-auth
description: Supabase Auth rules for the Beach Day Agent Console — the per-request token and role check every function runs, which key goes where, session handling and log-out, and what is still unverified. Use when building, reviewing or testing Console sign-in or any /api/* function.
---
# Supabase Auth in Beach Day (details: knowledge/supabase-auth-engineer/docs/)

## Standing rules
- **Only the Console's `super_admin` may open Agents, chat or Approve.** Everyone else signs up, signs in and sees a "no access" screen.
- **Every `/api/*` function runs the check first and fails closed.** Missing or bad token: 401. Valid user who is not `super_admin`: 403. Any error, timeout or empty result while checking: deny.
- **Keys:** only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (both non-secret). The secret key and the legacy `service_role` key are used nowhere. Send the publishable key on `apikey` and the user's token on `Authorization: Bearer`.
- **Role source:** `public.profiles.role`, read with the user's own token so RLS returns only their row. Never trust a role in the JWT, `user_metadata` or the request body.
- **`super_admin` is set by Dr. Lee in the SQL editor, by hand.** No app code can grant it.

## The check, in order (reference code: knowledge/supabase-auth-engineer/examples/01-token-and-role-check/)
1. `Authorization: Bearer <jwt>` is present and has three parts.
2. `supabase.auth.getClaims(token)` verifies signature and `exp` against the project's JWKS. Pass the token explicitly. Never `getSession()` on a server. Never `allowExpired`.
3. Check `iss` equals `<SUPABASE_URL>/auth/v1`, `aud` is `authenticated`, `is_anonymous` is not true, `sub` is a string. `getClaims` does not check these for you.
4. Read the role (step above). Not exactly one row, or not `super_admin`: 403.
5. **Approve also calls `getUser(token)`** so a deleted or revoked user fails before `exp`. Whether `getUser` rejects a signed-out session is UNVERIFIED: test on the real project.
6. Log the user id and the outcome, never the token.

## Browser side
- `createClient(url, publishableKey, { auth: { flowType: 'pkce' } })`. The library default is `implicit`.
- Log-out button: `signOut({ scope: 'local' })`. The default scope is `global`, which signs out every device.
- Sessions live in localStorage, so any XSS reads the tokens. The CSP is the defence, which is why Vera owns it. Keep the access-token lifetime short: a signed-out token stays valid until `exp`.
- **Step-up before Approve:** `reauthenticate()` is only for password changes and does not work for Google users. Use the mechanism Vera specifies (see docs/03 in the knowledge folder).
- Reset-password and sign-up responses must not reveal whether an email exists.

## Project settings Dr. Lee makes (Dashboard)
Email confirmation on; password minimum length and character classes; leaked-password protection is Pro plan and above; Site URL and redirect allow-list (exact `/console` URLs, no wildcards in production); optional time-box and inactivity timeout.

## Unverified, check before relying (supabase.com was blocked when these notes were written)
`getUser` on a signed-out session; `amr` timestamps across refreshes; `prompt=login` for Google re-auth; account linking of Google and email users; the project's plan and signing-key type.
