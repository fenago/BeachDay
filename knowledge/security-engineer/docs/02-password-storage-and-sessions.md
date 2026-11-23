# Password storage and session management
Source: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html · https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html · https://nodejs.org/docs/latest-v22.x/api/crypto.html
Retrieved: 2026-11-23 (cheat sheets read from the official OWASP/CheatSheetSeries GitHub source; Node docs from nodejs/node `v22.x` `doc/api/crypto.md`)

## Password hashing ([Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html))
OWASP's order of preference, quoted:
- "Use Argon2id with a minimum configuration of 19 MiB of memory, an iteration count of 2, and 1 degree of parallelism."
- "If Argon2id is not available, use scrypt with a minimum CPU/memory cost parameter of (2^17), a minimum block size of 8 (1024 bytes), and a parallelization parameter of 1."
- bcrypt for legacy systems only: work factor ≥ 10, and a 72-byte input limit.
- PBKDF2 if FIPS-140 is required: ≥ 600,000 iterations with HMAC-SHA-256.

**Equivalent Argon2id minimums:**
- m=47104 (46 MiB), t=1, p=1
- m=19456 (19 MiB), t=2, p=1
- m=12288, t=3
- m=9216, t=4
- m=7168, t=5

**Equivalent scrypt minimums:**
| N | Memory | r | p |
|---|---|---|---|
| 2^17 | 128 MiB | 8 | 1 |
| 2^16 | 64 MiB | 8 | 2 |
| 2^15 | 32 MiB | 8 | 3 |
| 2^14 | 16 MiB | 8 | 5 |
| 2^13 | 8 MiB | 8 | 10 |

These "provide a similar minimal level of defense".

**Salt and pepper:**
- Each password gets a unique random salt.
- A **pepper** is optional defence in depth. It is a shared secret stored *separately* from the hashes, for example HMAC over the hash with a key in the secrets store.

## Node `crypto` facts ([crypto](https://nodejs.org/docs/latest-v22.x/api/crypto.html))
- `crypto.scrypt(password, salt, keylen[, options], callback)` takes the options `N` (cost), `r` (blockSize), `p` (parallelization) and `maxmem`.
  - `maxmem`: "It is an error when (approximately) `128 * N * r > maxmem`. **Default:** `32 * 1024 * 1024`."
  - With N=2^17, r=8 you need about 128 MiB, so **you must pass `maxmem`** (for example 256 MiB).
  - Reproduced on Node 22: `RangeError … ERR_CRYPTO_INVALID_SCRYPT_PARAMS … memory limit exceeded` (examples/01).
- `crypto.timingSafeEqual(a, b)`: `a` and `b` "must have the same byte length. An error is thrown if a and b have different byte lengths." Check the lengths first, and compare fixed-length digests rather than user strings.
- Argon2 is not in Node 22's `crypto` (the v22.x `crypto.md` has no mention of it). `crypto.argon2(algorithm, parameters, callback)` was added in **v24.7.0**, per the Node `main` branch docs. On the Node 22 runtime, Argon2id would need a native dependency, which is why Beach Day uses OWASP's scrypt option. Which Node version Netlify Functions run for this site is **[UNVERIFIED]** here; check with netlify-engineer before switching to Argon2id.

## Session IDs and cookies ([Session Management](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html))
- Session identifiers "must have at least `64 bits` of entropy" and come from a CSPRNG.
- For stored or split tokens, the verifier gets "at least 128 bits of entropy; prefer 160 bits or more".
- **Cookie attributes:**
  - `Secure`, `HttpOnly`, `SameSite`.
  - The `__Host-` prefix ("must be set with `Secure`, must not have a `Domain` attribute, and must use `Path=/`") is "**Recommended for session IDs**". Example: `Set-Cookie: __Host-SessionID=<value>; Secure; HttpOnly; SameSite=Strict; Path=/`.
- **Renew the session ID after any privilege change**, login above all, to prevent session fixation.
- **Timeouts:**
  - "Common idle timeouts ranges are 2-5 minutes for high-value applications and 15-30 minutes for low risk applications."
  - Absolute timeouts depend on usage; "between 4 and 8 hours" is the example for a full office day.
  - "All sessions should implement an absolute timeout, regardless of session activity."
- **Reauthentication after risk events:** require re-auth before sensitive actions.
- **Logout:** after logout, none of the session's IDs may be accepted.
- **Server-side storage:** high entropy protects against guessing but "does not protect exposed tokens". Store a one-way verifier if read access to the session store is in your threat model.

## How our design compares
| OWASP | Beach Day design (docs/04 §4) | Status |
|---|---|---|
| scrypt N=2^17, r=8, p=1 | `CONSOLE_PASSWORD_HASH` holds `scrypt$N$r$p$salt$hash` | matches (examples/01) |
| ≥ 64-bit session ID, CSPRNG | `sid` = 144 random bits | matches |
| `Secure; HttpOnly; SameSite` | `HttpOnly; Secure; SameSite=Strict` | matches |
| `__Host-` prefix, `Path=/` | `bd_session`, `Path=/api` | **deviation**, documented below |
| Absolute timeout | 8 h `Max-Age` + signed `exp` | Dr. Lee's decision (2026-11-23); within OWASP's 4–8 h example |
| Idle timeout | none | **gap**: stateless cookie |
| Renew ID on login | a new `sid` at every login | matches |
| Reauth before risky actions | password within the last 10 min before Approve | matches the design; must be implemented |
| Logout invalidates | clears the cookie only | **gap**: no server-side revocation |

## Beach Day notes
- Keep scrypt N=2^17, r=8, p=1 with an explicit `maxmem`. Bound the parsed parameters so a bad env value can't DoS the function.
- `SESSION_SECRET` must be ≥ 32 random bytes. Derive separate keys for session and CSRF.
- **Deviation 1:** `Path=/api` instead of `__Host-` + `Path=/`. The cookie is only needed by functions, and `/api` keeps it off static asset requests. Risk: a sibling subdomain could set a conflicting `bd_session` for `/api`. On `*.netlify.app` or a dedicated custom domain this is low. Revisit if the Console moves under a shared parent domain.
- **Gap:** stateless HMAC cookies can't be revoked before `exp`. If "log out everywhere" or a suspected leak needs handling, rotate `SESSION_SECRET` (that kills every session), or add a `sid` deny-list in Blobs.
- Login throttling: 5 failures per IP per 15 min (Blobs counter) plus Netlify `rateLimit` on `/api/login` (ADR-0004). A scrypt hash takes about 335 ms and 128 MiB, so throttling also protects function capacity.
- Allow paste and password managers on the login and re-auth fields (WCAG 3.3.8, `accessibility-wcag22` skill).
