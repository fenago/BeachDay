# Sessions, sign-out and step-up (re-auth before Approve)
Sources: https://supabase.com/docs/guides/auth/sessions · https://supabase.com/docs/reference/javascript/auth-signout · https://supabase.com/docs/reference/javascript/auth-reauthenticate · https://supabase.com/docs/guides/auth/auth-mfa · https://supabase.com/docs/guides/auth/passwords
Retrieved: 2026-11-23. supabase.com blocked here; read from `supabase/supabase` docs source (sessions.mdx, auth-mfa.mdx, passwords.mdx, password-security.mdx) and `@supabase/auth-js` 2.119.2 JSDoc.

## Sessions
- Session = access token (JWT, "usually between 5 minutes and 1 hour") + refresh token (single use; reuse detection revokes the session). auth-js auto-refreshes (`autoRefreshToken` defaults to true). Observed in auth-js 2.119.2: the ticker runs every 30 s and refreshes when about 90 s are left. Beach Day: **600 s access tokens**; the Console keeps `autoRefreshToken: true` and also refreshes before `/api/chat` and `/api/jobs` when less than 120 s are left (docs/04 §4.1 and §4.3; example 03).
- Project settings: **time-box** (fixed session lifetime) and **inactivity timeout**, both Pro plan and above (docs/04 §4.3). Expired sessions are only cleaned up about 24 hours later. A missing `auth.sessions` row for the token's `session_id` means signed out.
- Browser storage: auth-js (and supabase-js) persists the session in **localStorage** by default, readable by any script on the page. HTTP-only cookies need server-side rendering, which "is not feasible" for a client-side app (sessions.mdx). So XSS on the Console page can read the tokens; the CSP is the defence (Vera).
- Default `flowType` is `'implicit'` (auth-js 2.119.2, observed). Set `flowType: 'pkce'` explicitly (example 03).

## signOut
- `signOut({ scope })`: `global` (**the default**) invalidates every session of the user on every device; `local` only this one; `others` all but this one. A 401/403/404 answer counts as signed out. Offline, `global` errors and keeps the user signed in.
- It "does not revoke the JWT": the access token stays valid until `exp` (see doc 01). Our log-out button uses `{ scope: 'local' }` on purpose; use `global` for "sign out everywhere".

## reauthenticate() is NOT a general step-up
- `reauthenticate()` "sends a reauthentication OTP" (a nonce, by email, or phone if no email) and "is used together with `updateUser()` when a user's password needs to be updated", and only when **Secure password change** is on and the user has not signed in within 24 hours. It does not return a fresh token and nothing checks it at Approve.
- A Google-only user has no password to re-enter.

## Step-up before Approve: decided in docs/04 §4.2 (security-engineer)
Do not restate the rule here; docs/04 §4.2 is canonical. In short:
- Approve calls `getUser(token)`.
- It requires a `password` or `oauth` `amr` entry no more than 600 s old, and `last_sign_in_at` no more than 600 s old.
- It requires `aal2` if the user has a verified factor.
- Otherwise it answers 401 `step_up_required`.
- `reauthenticate()` is not used.

Supabase facts behind it, for whoever reviews or tests that rule:
| Fact | Source | Status |
|---|---|---|
| `amr` is an array of `{ method, timestamp }`, "ordered most recent method first". Methods include `password`, `oauth`, `otp`, `totp`, `recovery`, `magiclink`, `email/signup`, `invite`, `sso/saml`, `anonymous` | jwt-fields.mdx, auth-mfa.mdx | Docs |
| The docs suggest `amr` to require that users "recently signed in with a password" | auth-mfa.mdx | Docs |
| Each `amr` timestamp is the `updated_at` of a per-session, per-method row (`mfa_amr_claims`). A sign-in creates a **new session** and writes the row. The refresh-token grant writes no `amr` row, so a refresh keeps the original sign-in timestamp | supabase/auth `master`: `internal/models/sessions.go` (`CalculateAALAndAMR`), `internal/models/amr.go`, `internal/tokens/service.go` | Server source; hosted **UNVERIFIED**; pre-launch test (a) |
| `last_sign_in_at` is written when a new session is issued (`IssueRefreshToken`), not in the refresh-token grant | `internal/tokens/service.go` | Server source; pre-launch test (c) |
| After sign-out, `GET /user` answers 403 `session_not_found` | `internal/api/auth.go` | Server source; pre-launch test (d) |
| auth-js `getUser` returns network and 5xx failures as `{ error: AuthRetryableFetchError }`; it does not throw | examples/01, test 21 | Observed |
| `signInWithOAuth` passes `options.queryParams` to the provider. The Google guide shows only `access_type: 'offline'` and `prompt: 'consent'` | auth-google.mdx, auth-js JSDoc | Docs |
| Whether Google honours `prompt=login` or `max_age` and forces a fresh Google login | developers.google.com blocked here | **UNVERIFIED** |
| A PKCE redirect can be completed only in the browser that started it (the code verifier is in its storage). The code is valid for 5 minutes and is single use | sessions/pkce-flow.mdx | Docs |
