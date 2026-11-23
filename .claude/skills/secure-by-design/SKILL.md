---
name: secure-by-design
description: Baseline security rules for all Beach Day code — secrets handling, least privilege, input validation, output encoding, security headers and CSP, dependency hygiene, logging without secrets. Use when writing or reviewing any code, config or header.
---
# Secure by design

## Secrets
- **The secrets are `ANTHROPIC_API_KEY` and `GITHUB_TOKEN`**, plus `GITHUB_READ_TOKEN` only if Dr. Lee accepts ADR-0009 (Proposed; docs/04 §4.6). Until then it is not created.
  - They live **only** in Netlify secret env vars, Production context, and are read only inside functions.
  - Functions that use them refuse to run outside `context.deploy.context === "production"`.
- **`SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are public by design.**
  - They reach the browser through the build-written `public/generated/config.js`.
  - Never mark them secret.
  - The build fails unless the key starts with `sb_publishable_`.
- **The Supabase secret key (`sb_secret_…`) and the legacy `service_role` key are used nowhere.** Not in env, code, tests, fixtures or docs examples. Anything that would need them is done by Dr. Lee in the Supabase SQL editor.
- **User access and refresh tokens are credentials too.** Never log them, store them in Blobs, or put them in URLs, error messages or prompts.
- **Never put a secret** in `public/`, the repo, test fixtures, logs, error messages, responses or prompts sent to Claude.
- **Placeholders** in docs and tests look like `sk-ant-EXAMPLE` or `sb_publishable_EXAMPLE`. Build realistic positive fixtures at runtime, so the committed file never contains a scannable literal.
- If a secret leaks, rotate it first, then investigate. After rotating, trigger a new deploy, because functions keep the old value until then.

## Least privilege
- **GitHub:** a fine-grained PAT for one repo with Contents read/write only. Today (ADR-0007) approve writes with it and `chat`/`jobs-run` read with it through a module with no write methods. If Dr. Lee accepts ADR-0009, reads move to `GITHUB_READ_TOKEN` (public repositories only, no permissions, no fallback) and only approve loads `GITHUB_TOKEN`.
- **Anthropic:** a dedicated workspace with a low spend limit.
- **Supabase:** the publishable key plus the user's own token, so RLS always applies. API roles have no write privilege on `profiles`.
- **Functions:** do one job each and read only the env vars they need.
- **Agents:** read tools plus `propose_change`, and no commit ability.
- **Build and CI:** nothing agent-writable runs during the Netlify build. Tests run in GitHub Actions with `permissions: contents: read` and no secrets.

## Authenticate, then validate, then encode
- **Every `/api/*` function checks the Bearer token and `role = super_admin` first,** and fails closed: 401 / 403 / 503 (`agent-console-security`). No unauthenticated functions.
- **Validate every function input:**
  - method, content-type and body size, checked **before** parsing (≤ 64 KB; proposals ≤ 4 MB total);
  - schema;
  - IDs matching `^[pj]_[0-9A-Z]{26}$`;
  - paths (see `agent-console-security`).
- **Never interpolate untrusted data** into HTML (`textContent` only), shell, regex or URLs without encoding. That includes model output, file contents, diffs and Supabase error messages.
- **Treat Claude output as untrusted:** render it as text or sanitized Markdown with no remote images, and validate tool inputs in code.
- **No state change from a URL.** Query strings, hashes and redirects never trigger an action.

## Headers
| Scope | Headers |
|---|---|
| Static (`public/_headers`, the only place; denied to agents) | `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com https://<project-ref>.supabase.co; manifest-src 'self'; worker-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy: geolocation=(self), camera=(), microphone=()`; `Strict-Transport-Security` |
| Functions (set in code, on every status) | `Cache-Control: no-store`; `Content-Type`; `nosniff`; for JSON `content-security-policy: default-src 'none'; frame-ancestors 'none'`. Never `Access-Control-Allow-*` or `Set-Cookie` |

- **The Supabase host** is the exact project host, site-wide, never `*.supabase.co`. The build checks that it matches `SUPABASE_URL`.
- **Never add** `'unsafe-inline'`, `'unsafe-eval'` or a CDN. The vendored auth bundle is served from `'self'`.

## Dependencies
- **Runtime dependencies stay minimal:**
  - functions: `@anthropic-ai/sdk`, `@netlify/blobs`, `@netlify/functions` types and `@supabase/auth-js` (exact version);
  - front end: only the vendored, pinned `public/vendor/supabase-auth-js-<ver>.mjs`, loaded by the Console only.
  - A test asserts the two Supabase versions match.
- Pin versions with a lockfile and check `npm audit` in CI. Watch advisories for the vendored file (ADR-0006).
- **Agents can't change dependencies.** `package*.json` and `public/vendor/**` are on the deny list. Dependency changes are a human decision and need an ADR if new.

## Logging
- **Log:** `requestId`, route, status, duration, user id (`sub`), agent, proposal ID and commit SHA. Use structured JSON.
- **Never log:** bodies, the `Authorization` header, `apikey` values, access or refresh tokens, passwords, env, or full upstream error bodies.

## Review triggers
Security-engineer must review any change to:
- `netlify/**`, `netlify.toml`, `_headers`
- auth (the Supabase check, step-up, profiles/RLS SQL, redirect URLs, Dashboard auth settings)
- the allow-list, GitHub code, env vars, CI workflows
- the vendored auth bundle
