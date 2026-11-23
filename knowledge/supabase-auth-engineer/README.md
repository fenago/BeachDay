# Knowledge: supabase-auth-engineer
Date: 2026-11-23

Notes and runnable examples for Beach Day's Console sign-in: Supabase Auth with email/password, "Continue with Google", a `profiles` table with a `role`, and a server-side check on every function. Read with ADR-0006, `docs/04-agent-console.md` and the `agent-console-security` skill.

**Source caveat.** supabase.com is blocked in this sandbox (proxy 403). Every note was read from the official docs source (`supabase/supabase`, `apps/docs/content/guides/...`, via raw.githubusercontent.com) and from the JSDoc in `@supabase/auth-js` 2.119.2, which generates the JS reference pages. Each file lists the canonical supabase.com URLs. Anything not found in those sources is marked **UNVERIFIED**.

## docs/
| File | Covers | Read it when |
|---|---|---|
| [docs/01-verifying-tokens-getclaims-vs-getuser.md](docs/01-verifying-tokens-getclaims-vs-getuser.md) | JWT claims, JWKS and caching, getClaims vs getUser, **the decision**, sign-out not revoking tokens | Writing or reviewing the check at the top of a function |
| [docs/02-api-keys-publishable-vs-secret.md](docs/02-api-keys-publishable-vs-secret.md) | Publishable vs secret vs legacy keys, `apikey` vs `Authorization`, why no secret key here | Any env var, header or key question |
| [docs/03-sessions-signout-and-step-up.md](docs/03-sessions-signout-and-step-up.md) | Session lifetime, localStorage, signOut scopes, why `reauthenticate()` is not a step-up, `aal`/`amr` options | Designing re-auth before Approve, log-out, XSS impact |
| [docs/04-google-oauth-and-redirect-urls.md](docs/04-google-oauth-and-redirect-urls.md) | `signInWithOAuth`, Google Cloud setup, Site URL and redirect allow-list, account linking | Dr. Lee's setup steps, redirect bugs |
| [docs/05-rls-profiles-and-column-privileges.md](docs/05-rls-profiles-and-column-privileges.md) | RLS, trigger pattern, why a policy cannot protect one column, our grants design | The profiles SQL, any new table |
| [docs/06-passwords-email-confirmation-and-reset.md](docs/06-passwords-email-confirmation-and-reset.md) | Email confirmation, reset without enumeration, password rules, leaked-password protection (Pro plan and above), rate limits | Sign-up and reset flows, project settings |

## examples/
| Example | Demonstrates | Verified |
|---|---|---|
| [examples/01-token-and-role-check/](examples/01-token-and-role-check/) | Bearer + `getClaims` (real signatures, mocked JWKS) + `iss`/`aud` + role from `profiles`; every failure is 401 or 403 | 15/15 `node:test` |
| [examples/02-profiles-rls-sql/](examples/02-profiles-rls-sql/) | `profiles.sql`: cascade, default role, trigger, own-row select, no role self-update | 9/9 in pglite (stubbed `auth`; not run on real Supabase) |
| [examples/03-browser-auth-calls/](examples/03-browser-auth-calls/) | PKCE client, Google URL, log in/up/reset, `scope: 'local'` log-out | 6/6 `node:test` |

## Open items for other agents
- **Vera:** step-up mechanism (doc 03), access-token lifetime, whether Approve also calls `getUser` (doc 01), localStorage vs XSS, redirect allow-list, leaked-password protection needs Pro.
- **Rowan:** how supabase-js loads with no build step (CSP `script-src`).
- **Dr. Lee:** project plan (Free or Pro), account linking behaviour, signing-key type, custom SMTP.
- **Verify when supabase.com is reachable:** the pages listed in each doc; and `getUser` on a signed-out session.
