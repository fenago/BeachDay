# Example 01: Bearer token check plus role check (fails closed)

## What it shows
`auth-check.mjs` is the first line of every `/api/*` function (docs/04 §4.1). It uses **`@supabase/auth-js`** directly, pinned to an exact version, as ADR-0006 specifies for functions. It does not use supabase-js. The steps:
1. Bearer shape.
2. **`getClaims(token)`**: a real ES256 signature check against the JWKS.
3. `iss`, `aud`, anonymous and `sub` checks.
4. The role, read from `public.profiles` **with the user's own token**.

It uses only the project URL and the publishable key. Outcomes:

| Status | Meaning | Examples |
|---|---|---|
| **401** | Identity not proven | With `headerPrecheck: true` (only after docs/04 §4.2 test (f)): a header that isn't a JSON object, `alg` not ES256/RS256, or no `kid`, with no network call. Always: no token, garbage, expired, bad signature, unknown key, wrong project, wrong audience, anonymous, PostgREST rejects the token |
| **403** | Identity proven, but no access | Role `user`, no profile row |
| **503** | The check could not run | JWKS unreachable or 5xx on a cold instance; profile lookup 5xx, any other non-401 error status, timeout (5 s) or non-JSON. Never shown as "no access" |

The test mints its own ES256 key pair, serves it as the JWKS from a mocked `fetch`, and signs tokens, so the library's verification really runs. No network, no real project.

## Run
```bash
cd knowledge/supabase-auth-engineer/examples/01-token-and-role-check
npm install      # @supabase/auth-js 2.119.2; do not commit node_modules
npm test
```

## Verified
Run 2026-11-23 from a clean install, Node v22.23.5, @supabase/auth-js 2.119.2:
```
ok 1 - no token -> 401, and no network call is made
ok 2 - Basic auth or two-part token -> 401 no_token
ok 3 - garbage three-part token -> 401
ok 4 - expired token -> 401
ok 5 - bad signature (right kid, tampered payload) -> 401
ok 6 - token signed by another project (unknown kid) -> 401 (auth-js falls back to GET /user, which says 401)
ok 7 - wrong project: valid signature but iss points elsewhere -> 401 wrong_project
ok 8 - wrong audience -> 401
ok 9 - anonymous user -> 401
ok 10 - PostgREST says 401 for the token -> 401
ok 11 - pre-check on: HS256 -> 401 with no network call
ok 12 - pre-check on: alg none -> 401 with no network call
ok 13 - pre-check on: ES256 without kid -> 401 with no network call
ok 14 - pre-check on: empty kid -> 401 with no network call
ok 15 - pre-check on: kid not a string -> 401 with no network call
ok 16 - pre-check on: header is a JSON array -> 401 with no network call
ok 17 - pre-check on: header is not JSON -> 401 with no network call
ok 18 - pre-check on: ES256 with a kid passes to getClaims; super_admin -> ok
ok 19 - pre-check off (default until test (f)): HS256 reaches getClaims, which asks GET /user
ok 20 - role user -> 403
ok 21 - role claim in the JWT or user_metadata is ignored
ok 22 - no profile row -> 403
ok 23 - profile lookup 500 -> 503
ok 24 - profile lookup other 4xx (e.g. missing grant, 403) -> 503, not "no access"
ok 25 - profile lookup returns non-JSON -> 503
ok 26 - profile lookup hangs -> 503 after the timeout
ok 27 - JWKS unreachable on a cold instance -> 503
ok 28 - JWKS endpoint 502 on a cold instance -> 503
ok 29 - OBSERVED: auth-js keeps the JWKS in a module-wide cache (keyed by storageKey), so a warm instance still verifies when the network drops
ok 30 - OBSERVED: auth-js returns network and 5xx failures as { error } (AuthRetryableFetchError); it does not throw
ok 31 - super_admin with valid token -> ok
# tests 31
# pass 31
# fail 0
```
Tests 11–17 (header pre-check, wave 3c) and the 503 tests were written first and failed against the previous version, which returned 403 or 401 for upstream failures and had no timeout.

## Findings from running it
- **auth-js does not throw on network or 5xx failures.** `getClaims` and `getUser` *return* `{ error }`, where the error is an `AuthRetryableFetchError` (status 0 for a network error, otherwise the 5xx status). Map that error with `isAuthRetryableFetchError(error)` to **503**, and any other auth error to **401**. Code that only catches a *throw* turns an outage into a 401 (test 21).
- **The JWKS cache is module-wide, keyed by `storageKey`.** It is not keyed by URL. With auth-js directly, the default `storageKey` is the same for every client, so the example sets `sb-<ref>-auth-token`. A warm instance keeps verifying after the network drops; a cold one returns 503.
- **Unknown `kid`, an `HS*` algorithm or no WebCrypto: `getClaims` falls back to `GET /auth/v1/user`** (test 6). So a forged token with a random `kid` costs one Auth round trip. Whether that endpoint counts against the IP rate limit of the function's egress address is **UNVERIFIED** (docs/06).
- `getClaims` does not compare `iss` or `aud` to your project. The example does.
- Node's `AbortSignal.timeout` timer is unref'd, so the "hang" mock holds its own timer, as a real socket would. The timeout works the same in production.

## Not verified
- Behaviour against a real Supabase project: real JWKS, PostgREST and RLS.
- How PostgREST answers an expired-but-well-signed token. The example assumes 401.
