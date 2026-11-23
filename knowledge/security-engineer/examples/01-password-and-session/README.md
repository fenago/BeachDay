# Example 01: scrypt password hash + HMAC-signed session cookie + CSRF token

## What it shows
`auth.mjs` is the shape of `netlify/functions/lib/auth`. It uses Node built-ins only (`node:crypto`).

**`hashPassword` / `verifyPassword`:**
- Uses scrypt with the OWASP Password Storage Cheat Sheet's first scrypt setting: **N=2^17 (128 MiB), r=8, p=1**, a random 16-byte salt and a 32-byte key.
- Stores `scrypt$N$r$p$salt$hash` in `CONSOLE_PASSWORD_HASH`, the format given in the `agent-console-security` skill.
- Compares with `crypto.timingSafeEqual`.
- **Raises `maxmem`.** Node's default `maxmem` is 32 MiB, and it is an error when about `128 * N * r > maxmem`. With N=2^17, r=8 that is 128 MiB, so the default throws `ERR_CRYPTO_INVALID_SCRYPT_PARAMS … memory limit exceeded` (reproduced below). The example sets `maxmem` to 256 MiB.
- **Bounds the parameters parsed from the stored hash.** A corrupted env value can't turn every login into a memory or CPU DoS.
- Normalises the password to NFC, so the same password typed on iOS and on desktop compares equal.

**Session cookie:**
- The token is `base64url(JSON{sid, iat, exp, auth}).base64url(HMAC-SHA256)`.
- `sid` is 144 bits from the CSPRNG; OWASP requires at least 64 bits of entropy.
- The absolute lifetime is 12 h.
- `verifySession` checks the shape (and a length cap), compares the MAC in **constant time**, then checks `exp`.
- The cookie flags are `HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=43200`, as in docs/04 §4.

**Key separation.** Separate session and CSRF keys are derived from `SESSION_SECRET` with labelled HMACs. A secret shorter than 32 bytes is refused.

**CSRF token.** The token is `HMAC(csrfKey, "sid:" + sid)`. It is sent in the `X-BD-CSRF` header and never read from a cookie. This is OWASP's "signed, session-bound" token idea; see doc 03.

**Step-up.** `recentlyAuthenticated(claims)` enforces "password within the last 10 minutes" before Approve.

**Tests** (`auth.test.mjs`, `node:test`):
- tampering: an extended `exp` with the old MAC, a flipped MAC character, a MAC from another secret, malformed and oversize tokens, and an empty MAC;
- expiry at and after `exp`;
- the step-up window;
- a CSRF token reused across sessions;
- a short secret;
- a DoS-sized stored parameter.

**Known limits of this design.** The security review should track these:
- A stateless signed cookie **cannot be revoked** before `exp`. Logout only clears the browser's copy. If revocation matters, keep a `sid` deny-list or a session record in Blobs.
- OWASP recommends the `__Host-` cookie prefix, which requires `Path=/`. We use `Path=/api`, so we can't use it. That is acceptable on our own single-host `*.netlify.app` or custom domain, but it is a conscious deviation.

All secrets in the tests are obvious test strings. No real credentials are used.

## How to run
```bash
mkdir -p /tmp/sec01 && cp *.mjs /tmp/sec01 && cd /tmp/sec01
node --test auth.test.mjs     # no npm install needed
```

## Verified
Run on 2026-11-23 with Node v22.23.5, from a scratch copy outside the repo:

```
$ node --test auth.test.mjs
# hash: scrypt$131072$8$1$qLxjKjJOihnnYd…  (335 ms)
# bd_session=<token>; HttpOnly; Secure; SameSite=Strict; Path=/api; Max-Age=43200
ok 1 - scrypt hash: format, unique salt, verify right/wrong
ok 2 - stored hash with absurd params is refused (DoS guard)
ok 3 - session round trip and cookie flags
ok 4 - tampering is rejected
ok 5 - expiry: valid until exp, rejected at and after
ok 6 - step-up window for Approve is 10 minutes
ok 7 - CSRF token is bound to the session id
ok 8 - short SESSION_SECRET is refused
# tests 8
# pass 8
# fail 0
```

The default-`maxmem` failure, reproduced:
```
$ node -e 'require("crypto").scrypt("pw","salt",32,{N:2**17,r:8,p:1},()=>{})'
RangeError: Invalid scrypt params: error:030000AC:digital envelope routines::memory limit exceeded
  code: 'ERR_CRYPTO_INVALID_SCRYPT_PARAMS'
```

One hash takes about 335 ms on the sandbox. A login costs one hash, and login is rate-limited (10/min/IP plus 5 failures per 15 min). Netlify function memory was not measured: **[UNVERIFIED]** that 128 MiB per concurrent login is comfortably within the function's memory.
