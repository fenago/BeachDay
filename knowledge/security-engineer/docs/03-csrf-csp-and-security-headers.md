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

### Our CSRF design
| Layer | Beach Day |
|---|---|
| Cookie | `SameSite=Strict`, `HttpOnly`, `Secure` |
| Token | `X-BD-CSRF: HMAC(csrfKey, "sid:"+sid)`, returned by `/api/login` and kept in memory (examples/01) |
| Fetch Metadata | reject POST/PUT/PATCH/DELETE when `Sec-Fetch-Site` is present and not `same-origin` |
| Origin fallback | `Origin` must equal the site URL. If both `Sec-Fetch-Site` and `Origin` are missing on a state-changing request, reject |
| CORS | send no `Access-Control-Allow-*` headers at all from `/api/*` |
| Login | `/api/login` checks `Sec-Fetch-Site`/`Origin` (no session yet to bind a token to) |

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
**Static CSP** (`secure-by-design`):
```
default-src 'self';
connect-src 'self' https://api.open-meteo.com https://marine-api.open-meteo.com;
img-src 'self' data:; style-src 'self'; script-src 'self';
frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```
- That matches OWASP's tightened non-strict policy, plus Open-Meteo, because the browser calls it directly (ADR-0001).
- No inline scripts means no nonces are needed on a static site.
- The Console needs only `connect-src 'self'`. A stricter per-path CSP for `/console` in `_headers` is a reasonable hardening step.

**Other header decisions:**
- **`Permissions-Policy`:** Beach Day may use geolocation for "nearest beach", so the policy is `geolocation=(self)`, not `()`. That is a deliberate difference from the OWASP example.
- **COEP `require-corp`:** not recommended for us. It can break cross-origin fetches and images, and we don't need cross-origin isolation. COOP `same-origin` is safe to add.
- **Function responses:** `_headers` does not apply to them. Every function sets `Cache-Control: no-store`, `Content-Type` and `X-Content-Type-Options: nosniff` in code. Test it on error paths too.
- **Service worker:** must never put `/api/*` in the Cache API, because `no-store` doesn't stop it.
- **`public/_headers`** is on the allow-list but flagged **sensitive**. A proposal that loosens CSP, for example by adding `'unsafe-inline'` or a new `connect-src` host, needs explicit security-engineer review even after a human approves it in the Console.
