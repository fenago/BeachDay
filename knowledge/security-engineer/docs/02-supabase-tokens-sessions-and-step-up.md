# Supabase tokens, sessions and step-up: the security view
Source: https://supabase.com/docs/guides/auth/sessions · https://supabase.com/docs/guides/auth/jwt-fields · https://supabase.com/docs/guides/auth/auth-mfa · https://supabase.com/docs/guides/auth/auth-mfa/totp · https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
Retrieved: 2026-11-23. supabase.com is blocked from the sandbox. The Supabase pages were read from the official docs source (`supabase/supabase`, `apps/docs/content/guides/auth/{sessions,jwt-fields,auth-mfa,auth-mfa/totp}.mdx`, via raw.githubusercontent.com). The OWASP cheat sheet was read from the OWASP/CheatSheetSeries GitHub source.

This note replaces `02-password-storage-and-sessions.md` (scrypt, HMAC cookie, `__Host-` prefix), which was retired with ADR-0006. supabase-auth-engineer's notes (`knowledge/supabase-auth-engineer/docs/01`, `03`) cover the API. This file covers what matters for the threat model and the Approve step-up.

## Facts from the Supabase docs
**Sessions** (sessions.mdx):
- "Access tokens are designed to be short lived, usually between 5 minutes and 1 hour while refresh tokens never expire but can only be used once."
- supabase-js refreshes automatically (`autoRefreshToken` defaults to true).
- **Time-boxed sessions, inactivity timeout and single session per user:** "This feature is only available on Pro Plans and up."
- **Recommended JWT expiry:**
  - "Most applications should use the default expiration time of 1 hour."
  - "Values below 5 minutes, and especially below 2 minutes, should not be used in most situations": refresh load, clock skew, and the client can't refresh ahead of time.
  - "Access tokens should generally be valid for at least as long as the longest running request in your application."
- **Refresh-token reuse detection:** reuse outside a 10-second interval (or the parent-token exception) means "the whole session is regarded as terminated and all refresh tokens belonging to it are marked as revoked".

**`amr` claim** (jwt-fields.mdx, auth-mfa.mdx):
- An array of `{method, timestamp}`. "The entries are ordered most recent method first!"
- **Methods:** `oauth`, `password`, `otp`, `totp`, `recovery`, `invite`, `sso/saml`, `magiclink`, `email/signup`, `email_change`, `token_refresh`, `anonymous`.
- Supabase's own suggested use: "you can mandate that access will be only be granted on a table to users who have recently signed in with a password."

**`aal` claim:**
- `aal1` means single factor; `aal2` means "Multi-factor authentication (password + TOTP, etc.)".
- Unenrolling a factor downgrades `aal2` to `aal1` only after the refresh interval.
- "TOTP MFA API is free to use and is enabled on all Supabase projects by default" (auth-mfa/totp.mdx).

## OWASP Session Management points that still apply
- "Reauthentication After Risk Events": require re-auth before sensitive actions. Approve is ours.
- After logout, the session's IDs must not be accepted. With JWTs this holds only until `exp`, which is why the access token is short (below).
- Absolute timeouts: the cheat sheet's example is 4–8 hours. Supabase's time-box needs Pro, so on Free the step-up stands in for it at Approve.

## Decisions (docs/04 §4)
| Question | Decision | Why |
|---|---|---|
| Step-up mechanism | `getUser(token)`, then a `password`/`oauth` `amr` entry ≤ 600 s old, plus `last_sign_in_at` ≤ 600 s old, plus `aal2` if a verified factor exists | `reauthenticate()` is for password changes only. `amr` recency is Supabase's documented pattern. `last_sign_in_at` corroborates it server-side |
| TOTP | Recommended for `super_admin`; additive only | It is free. A thief with a stolen aal1 session could enrol their own factor, so `totp` must never replace a fresh primary sign-in |
| Access-token lifetime | **600 s** | Bounds stolen or signed-out tokens. Inside Supabase's ≥ 5 min advice. The longest token-checked request is 60 s; jobs-run checks only at its start |
| Does Approve call `getUser`? | **Yes**; the other functions don't | A server-side user lookup catches deleted or banned users before `exp`. Whether it rejects a signed-out session is **UNVERIFIED** |
| Storage | `localStorage` (default) | `sessionStorage` doesn't stop XSS and breaks PKCE links opened in new tabs. Cookies need server rendering |
| Time-box / inactivity | Not available on Free; 12 h / 2 h if ever on Pro | Pro-only per sessions.mdx |

## UNVERIFIED (test on the real project before Approve is enabled)
1. The `password`/`oauth` `amr` timestamp survives a refresh unchanged. The `token_refresh` method in the list suggests a refresh may *add* an entry, which our rule ignores. It must not *move* the sign-in timestamp.
2. `last_sign_in_at` is updated by password and OAuth sign-ins and not by refresh.
3. `getUser` after `signOut({scope:'local'})`.
4. Whether Google honours a forced re-login parameter through `queryParams`. Without it, a Google step-up proves a live Google session, not a typed password.

## Beach Day notes
- Same origin, shared storage: the beach app and the Console share `localStorage`. An XSS anywhere on the site reaches the tokens, so the CSP is site-wide and strict (doc 03).
- The step-up does **not** stop an XSS that waits for the user's own step-up and then approves within 10 minutes. The content hash, the visible diff and the CSP are the controls there.
- Map findings: a missing step-up is A07:2025; a token in a log is A09:2025.
