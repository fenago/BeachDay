---
name: secure-by-design
description: Baseline security rules for all Beach Day code — secrets handling, least privilege, input validation, output encoding, security headers and CSP, dependency hygiene, logging without secrets. Use when writing or reviewing any code, config or header.
---
# Secure by design

## Secrets
- The only secrets are `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `CONSOLE_PASSWORD_HASH` and `SESSION_SECRET`. They live **only** in Netlify secret env vars and are read only inside functions.
- Never put a secret in `public/`, the repo, test fixtures, logs, error messages, responses or prompts sent to Claude.
- Placeholders in docs and tests look like `sk-ant-xxxx`. The secret scan's regexes must exclude them.
- If a secret leaks, rotate it first, then investigate.

## Least privilege
- **GitHub:** a fine-grained PAT for one repo with Contents read/write only.
- **Anthropic:** a dedicated workspace with a low spend limit.
- **Functions:** do one job each and read only the env vars they need.
- **Agents:** read tools plus `propose_change`, and no commit ability.

## Validate input, encode output
- **Validate every function input:** method, content-type, body size (≤ 64 KB, except proposals at ≤ 4 MB total), schema, IDs matching `^[pj]_[0-9A-Z]{26}$`, and paths (see `agent-console-security`).
- **Never interpolate untrusted data** into HTML (`textContent` only), shell, regex or URLs without encoding.
- **Treat Claude output as untrusted:** render it as text or sanitized Markdown, and validate tool inputs.

## Headers
| Scope | Headers |
|---|---|
| Static (`public/_headers`) | `Content-Security-Policy: default-src 'self'; connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com; img-src 'self' data:; style-src 'self'; script-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'`; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy: geolocation=(self), camera=(), microphone=()` |
| Functions (set in code) | `Cache-Control: no-store`; `Content-Type`; `nosniff` |

## Dependencies
- Keep runtime dependencies minimal: `@anthropic-ai/sdk`, `@netlify/blobs`, `@netlify/functions` types. The front end has none.
- Pin versions with a lockfile and check `npm audit` in CI.
- Agents cannot change `package*.json` (it is on the deny list). Dependency changes are a human decision and need an ADR if new.

## Logging
- Log `requestId`, route, status, duration, agent and proposal ID.
- Never log bodies, cookies, auth headers, passwords or tokens.

## Review triggers
Security-engineer must review any change to `netlify/**`, `netlify.toml`, `_headers`, auth, the allow-list, GitHub code or env vars.
