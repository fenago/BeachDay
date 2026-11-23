# CSRF prevention, Content Security Policy and HTTP security headers
Source: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html
Retrieved: 2026-11-23 (from the official OWASP/CheatSheetSeries GitHub source)

## CSRF ([CSRF Prevention](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html))
**Token patterns:**
- **Synchronizer token**, or the **Signed Double-Submit Cookie (RECOMMENDED)** for stateless apps.
- HMAC tokens: "Compute HMAC-SHA-256 over an unambiguous encoding of the session-dependent value and random value".
- "read the token from a submitted header or form field, never from the cookie alone".
- Compare with a constant-time function.
- The naive double-submit cookie is "DISCOURAGED": subdomain cookie injection breaks it.

**Fetch Metadata:**
- `Sec-Fetch-Site` (`same-origin`, `same-site`, `cross-site`, `none`) is "the primary signal". By default, reject non-safe methods when it is `cross-site`.
- Falling back to `Origin`/`Referer` verification "**is a mandatory requirement**", because some legacy browsers don't send `Sec-Fetch-*`.
- It is supported in all major browsers since March 2023 (Safari 16.4+).
- Add `Vary: Sec-Fetch-Site, Origin` if responses differ by those headers.

**Custom request headers.** For AJAX/API endpoints, "the use of a custom request header" is a user-friendly defence. A cross-origin request carrying a custom header triggers a CORS preflight, and we don't allow CORS.

**SameSite** is listed under "Defense In Depth Techniques", not as the primary control.

**Login CSRF.** Login forms need protection too: an attacker could log the victim into the attacker's session.

### Our CSRF design (since ADR-0006: Bearer tokens, no cookies)
The OWASP token patterns above protect **ambient** credentials (cookies) that the browser attaches by itself. Our Supabase access token travels in an `Authorization` header that only our own script can set, so classic CSRF doesn't apply. The old `X-BD-CSRF` token and `bd_session` cookie are gone.

| Layer | Beach Day |
|---|---|
| Credential | `Authorization: Bearer <Supabase access token>`, set by the Console's script; never a cookie |
| CORS | send **no** `Access-Control-Allow-*` headers from `/api/*`, so a cross-origin script can't send the header (preflight fails) |
| Fetch Metadata + Origin | defence in depth on POST: reject when `Sec-Fetch-Site` is present and not `same-origin`, or `Origin` is present and not the site URL. Both absent → server-to-server, allowed (examples/01) |
| State from URLs | none: no query string or hash triggers Approve, Reject, chat or a job |
| Login CSRF | PKCE on OAuth and email links; sign-in happens against Supabase, not our functions |

## Content Security Policy ([CSP](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html))
- Deliver it as the `Content-Security-Policy` header. A `<meta>` tag can't do `frame-ancestors`, `sandbox` or reporting.
- `Content-Security-Policy-Report-Only` can run alongside the enforced policy to trial a stricter one.
- **Strict CSP** uses nonces or hashes, optionally with `'strict-dynamic'`. Nonces need server-rendered HTML.
- The "Basic non-Strict" policy for apps with everything same-origin and no inline scripts:
  - `default-src 'self'; frame-ancestors 'self'; form-action 'self';`
  - tightened: `default-src 'none'; script-src 'self'; connect-src 'self'; img-src 'self'; style-src 'self'; frame-ancestors 'self'; form-action 'self';`
- **Framing:** `frame-ancestors 'none'` "to prevent all framing". `X-Frame-Options` is "obsoleted by the `frame-ancestors` CSP directive".

## HTTP headers ([HTTP Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)): recommended values
| Header | OWASP recommendation |
|---|---|
| `X-Frame-Options` | `DENY` (legacy; CSP `frame-ancestors` supersedes it) |
| `X-XSS-Protection` | `0` (disable the legacy auditor) |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Content-Type` | always set, with a charset |
| `Cache-Control` | `no-store` for sensitive responses. "`no-cache` does not prevent caching". The **Cache API does not honor HTTP caching headers**, so exclude sensitive responses from service-worker caches explicitly |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` |
| `Access-Control-Allow-Origin` | a specific origin, never `*` with credentials |
| `Cross-Origin-Opener-Policy` | `same-origin` |
| `Cross-Origin-Embedder-Policy` | `require-corp` |
| `Cross-Origin-Resource-Policy` | `same-site` |
| `Permissions-Policy` | for example `geolocation=(), camera=(), microphone=()` |
| `Server` / `X-Powered-By` | remove or make generic |

## Beach Day notes
**Static CSP** (docs/04 §10, `secure-by-design`), one site-wide policy:
```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com https://<project-ref>.supabase.co;
manifest-src 'self'; worker-src 'self'; object-src 'none';
frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```
- That matches OWASP's tightened non-strict policy, plus Open-Meteo and our exact Supabase project host, because the browser calls them directly (ADR-0006).
- **Why site-wide and not Console-only:** a second CSP for `/console` would need two `_headers` rules setting the same header, and Netlify's merge behaviour for that is UNVERIFIED (docs/03 §3.2). Two CSPs on one response are both enforced, so the narrower one would block sign-in.
- **No inline scripts** means no nonces are needed on a static site. The vendored auth bundle has no `eval`, so `script-src 'self'` holds.
- **Google sign-in needs no entry.** It is a top-level navigation, which neither `connect-src` nor `form-action` governs when script starts it. Never build sign-in as a `<form action>` to Supabase or Google.
- **The whole origin is one trust zone.** The Console's tokens sit in `localStorage`, so XSS on the beach app reaches them too. That is why this policy is strict everywhere.

**Other header decisions:**
- **`Permissions-Policy`:** Beach Day may use geolocation for "nearest beach", so the policy is `geolocation=(self)`, not `()`. That is a deliberate difference from the OWASP example.
- **COEP `require-corp`:** not recommended for us. It can break cross-origin fetches and images, and we don't need cross-origin isolation. COOP `same-origin` is safe to add: sign-in uses redirects, not pop-ups.
- **Function responses:** `_headers` does not apply to them. Every function sets `Cache-Control: no-store`, `Content-Type`, `X-Content-Type-Options: nosniff` and, for JSON, `content-security-policy: default-src 'none'; frame-ancestors 'none'` in code. Test it on error paths too, including 401, 403 and 503.
- **Service worker:** must never put `/api/*` or Supabase responses in the Cache API, because `no-store` doesn't stop it.
- **`public/_headers`** is on the agents' **deny** list (Dr. Lee's decision 7). Only a human changes it, and any loosening, such as `'unsafe-inline'` or a new `connect-src` host, needs security-engineer review.
