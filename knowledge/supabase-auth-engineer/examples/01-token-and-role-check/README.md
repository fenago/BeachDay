# Example 01: Bearer token check plus role check (fails closed)

## What it shows
`auth-check.mjs` is the first line of every `/api/*` function: Bearer shape, then **`getClaims(token)`** (real supabase-js, real ES256 signature check), then `iss`/`aud`/anonymous checks, then the role read from `public.profiles` **with the user's own token**. Anything unexpected is 401 (identity) or 403 (role). It uses only the project URL and the publishable key.

The test mints its own ES256 key pair, serves it as the JWKS from a mocked `fetch`, and signs tokens, so the library's verification really runs. No network, no real project.

## Run
```bash
cd knowledge/supabase-auth-engineer/examples/01-token-and-role-check
npm install      # supabase-js 2.119.2; do not commit node_modules
npm test
```

## Verified
Run 2026-11-23, Node v22.23.5, @supabase/supabase-js 2.119.2:
```
ok 1 - no token -> 401, and no network call is made
ok 2 - garbage token -> 401
ok 3 - expired token -> 401
ok 4 - bad signature (right kid, tampered payload) -> 401
ok 5 - token signed by another project (unknown key) -> 401
ok 6 - wrong project: valid signature but iss points elsewhere -> 401 wrong_project
ok 7 - wrong audience -> 401
ok 8 - anonymous user -> 401
ok 9 - role user -> 403
ok 10 - role claim in the JWT or user_metadata is ignored
ok 11 - no profile row -> 403
ok 12 - profile lookup fails (500) -> 403, fails closed
ok 13 - JWKS unreachable on a cold instance -> 401, fails closed
ok 14 - OBSERVED: auth-js keeps the JWKS in a module-wide cache, so a warm instance still verifies when the network drops
ok 15 - super_admin with valid token -> ok
# tests 15
# pass 15
# fail 0
```
Findings from running it:
- auth-js caches the JWKS **module-wide, per project URL**. My first version of the "JWKS unreachable" test failed (403 instead of 401) because earlier tests had warmed the cache. The test now uses a cold URL, and test 14 records the warm-cache behaviour. Test 14 depends on test order.
- `getClaims` does not compare `iss`/`aud` to your project; the example does.

Not verified: behaviour against a real Supabase project (real JWKS, PostgREST and RLS), and that `getUser` rejects a signed-out session (see docs/01).
