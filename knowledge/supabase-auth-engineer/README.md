# Knowledge: supabase-auth-engineer
Date: 2026-11-23

Notes and runnable examples for Beach Day's Console sign-in: Supabase Auth with email/password, "Continue with Google", a `profiles` table with a `role`, and a server-side check on every function. Read with ADR-0006, `docs/04-agent-console.md` and the `agent-console-security` skill.

**Source caveat.** supabase.com is blocked in this sandbox (proxy 403).
- Every note was read from the official docs source (`supabase/supabase`, `apps/docs/content/guides/...`, via raw.githubusercontent.com) and from the JSDoc in `@supabase/auth-js` 2.119.2, which generates the JS reference pages. Each file lists the canonical supabase.com URLs.
- A few facts were read in the Auth server source (`supabase/auth`, `master`). They are labelled "server source": the hosted service may run a different version, so the pre-launch tests in docs/04 §4.2 still apply.
- Anything not found in those sources is marked **UNVERIFIED**.
- Updated 2026-11-23 (wave 3): Vera's review fixes; Wren's open questions answered in docs/04 and docs/06.

## docs/
| File | Covers | Read it when |
|---|---|---|
| [docs/01-verifying-tokens-getclaims-vs-getuser.md](docs/01-verifying-tokens-getclaims-vs-getuser.md) | JWT claims, JWKS and caching, getClaims vs getUser, **the decision**, sign-out not revoking tokens | Writing or reviewing the check at the top of a function |
| [docs/02-api-keys-publishable-vs-secret.md](docs/02-api-keys-publishable-vs-secret.md) | Publishable vs secret vs legacy keys, `apikey` vs `Authorization`, why no secret key here | Any env var, header or key question |
| [docs/03-sessions-signout-and-step-up.md](docs/03-sessions-signout-and-step-up.md) | Session lifetime and refresh, localStorage, signOut scopes, why `reauthenticate()` is not a step-up, the Supabase facts behind the docs/04 §4.2 step-up (`amr`, `last_sign_in_at`, `getUser` after sign-out) | Reviewing or testing the Approve step-up, log-out, XSS impact |
| [docs/04-google-oauth-and-redirect-urls.md](docs/04-google-oauth-and-redirect-urls.md) | `signInWithOAuth`, Google Cloud setup, Site URL and redirect allow-list, PKCE same-browser limit, no hash in `redirectTo`, **automatic account linking** | Dr. Lee's setup steps, redirect bugs, which user id to promote |
| [docs/05-rls-profiles-and-column-privileges.md](docs/05-rls-profiles-and-column-privileges.md) | RLS, trigger pattern, why a policy cannot protect one column, our grants design | The profiles SQL, any new table |
| [docs/06-passwords-email-confirmation-and-reset.md](docs/06-passwords-email-confirmation-and-reset.md) | Email confirmation (and **Confirm phone** for no enumeration), reset, `token_hash` email links that work in any browser, rate limits and 60 s cooldowns, built-in email sender limits (custom SMTP), password rules | Sign-up and reset flows, project settings, email templates |

## examples/
| Example | Demonstrates | Verified |
|---|---|---|
| [examples/01-token-and-role-check/](examples/01-token-and-role-check/) | auth-js `getClaims` (real signatures, mocked JWKS), `iss`/`aud`, role from `profiles`; optional JWT header pre-check; 401 / 403 / **503** when the check can't run | 31/31 `node:test` |
| [examples/02-profiles-rls-sql/](examples/02-profiles-rls-sql/) | `profiles.sql`: cascade, default role, trigger, own-row select, no role self-update; `promote-super-admin.sql`: look first (identities and MFA factors), refuse an unconfirmed email | 13/13 in pglite (stubbed `auth`; not run on real Supabase) |
| [examples/03-browser-auth-calls/](examples/03-browser-auth-calls/) | auth-js PKCE client with `autoRefreshToken: true` and `ensureFresh(120)`, Google URL, log in/up/reset, resend, `token_hash` email links, `scope: 'local'` log-out; one exact redirect | 13/13 `node:test` |

## Open items
- **Dr. Lee:**
  - the project's plan (Free or Pro) and signing-key type;
  - **custom SMTP**: the built-in sender only mails team members, 2 per hour (doc 06);
  - turn on **Confirm phone** as well as Confirm email (doc 06);
  - custom email templates with `token_hash` links (doc 06).
- **Pre-launch on the real project:** docs/04 §4.2 tests (a)–(e); doc 04 linking rows 2–4; how query strings match in the redirect allow-list; the `token_hash` templates; the reset/resend 429 side channel.
- **Verify when the hosts are reachable:** supabase.com pages listed in each doc; developers.google.com for `prompt=login` / `max_age`.
