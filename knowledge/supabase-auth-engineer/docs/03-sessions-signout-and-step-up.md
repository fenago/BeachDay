# Sessions, sign-out and step-up (re-auth before Approve)
Sources: https://supabase.com/docs/guides/auth/sessions · https://supabase.com/docs/reference/javascript/auth-signout · https://supabase.com/docs/reference/javascript/auth-reauthenticate · https://supabase.com/docs/guides/auth/auth-mfa · https://supabase.com/docs/guides/auth/passwords
Retrieved: 2026-11-23. supabase.com blocked here; read from `supabase/supabase` docs source (sessions.mdx, auth-mfa.mdx, passwords.mdx, password-security.mdx) and `@supabase/auth-js` 2.119.2 JSDoc.

## Sessions
- Session = access token (JWT, "usually between 5 minutes and 1 hour") + refresh token (single use; reuse detection revokes the session). supabase-js auto-refreshes (`autoRefreshToken` defaults to true).
- Project settings: **time-box** (fixed session lifetime) and **inactivity timeout**. Expired sessions are only cleaned up about 24 hours later. A missing `auth.sessions` row for the token's `session_id` means signed out.
- Browser storage: supabase-js persists the session in **localStorage** by default, readable by any script on the page. HTTP-only cookies need server-side rendering, which "is not feasible" for a client-side app (sessions.mdx). So XSS on the Console page can read the tokens; the CSP is the defence (Vera).
- Default `flowType` is `'implicit'` (auth-js 2.119.2, observed). Set `flowType: 'pkce'` explicitly (example 03).

## signOut
- `signOut({ scope })`: `global` (**the default**) invalidates every session of the user on every device; `local` only this one; `others` all but this one. A 401/403/404 answer counts as signed out. Offline, `global` errors and keeps the user signed in.
- It "does not revoke the JWT": the access token stays valid until `exp` (see doc 01). Our log-out button uses `{ scope: 'local' }` on purpose; use `global` for "sign out everywhere".

## reauthenticate() is NOT a general step-up
- `reauthenticate()` "sends a reauthentication OTP" (a nonce, by email, or phone if no email) and "is used together with `updateUser()` when a user's password needs to be updated", and only when **Secure password change** is on and the user has not signed in within 24 hours. It does not return a fresh token and nothing checks it at Approve.
- A Google-only user has no password to re-enter.

## What can serve as step-up (facts; the decision is Vera's)
| Mechanism | Facts from the docs | Gap |
|---|---|---|
| Recent sign-in time in the token | `getClaims` returns `amr: [{ method, timestamp }]` and `iat`. `amr` lists how the session authenticated (example response in auth-js JSDoc) | `iat` changes on every token refresh, so it is **not** "last password entry". `amr[].timestamp` is the sign-in method time; whether a refresh keeps the original timestamp is **UNVERIFIED**. Test it |
| Fresh sign-in at Approve | The client calls `signInWithPassword` (or OAuth) again, gets a new session with a new `amr` timestamp; the function requires it to be recent (for example 10 minutes) | Google users need a full redirect round trip. `prompt=login` through `queryParams` is **UNVERIFIED** here (docs show `access_type`/`prompt: 'consent'` for refresh tokens only) |
| MFA, `aal2` | `aal` claim is `aal1` or `aal2`; RLS or code can require `aal2`. Enrol TOTP, then verify per session (auth-mfa.mdx) | A TOTP prompt is not a password prompt, but it is the one mechanism with an official, checkable claim. Free-plan availability **UNVERIFIED** |
Recommendation to Vera: require `aal2` for Approve if Dr. Lee accepts TOTP; otherwise require a sign-in `amr` timestamp within 10 minutes plus a server-side `getUser`. Do not use `reauthenticate()`.
