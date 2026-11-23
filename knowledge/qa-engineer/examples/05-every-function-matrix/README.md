# Example 05 — "401 / 403 / 503 on every function" matrix, with mutants

## What it demonstrates
A table-driven harness: **every route in docs/04 §2 x every bad-credential case**. Each cell asserts the status, the error body shape, the function headers (`cache-control: no-store`, `content-type`, `nosniff`, `www-authenticate: Bearer` on 401, **no** `Access-Control-Allow-*`, **no** `Set-Cookie`), that **nothing downstream was touched** (Claude, GitHub, Blobs spies at zero; the fake Supabase accepts only its own host), and that no token or key is echoed.

- `harness.mjs` holds the fake world (an ES256 key pair minted in the test, JWKS, PostgREST `profiles`, `getUser`), a ~40-line **stand-in** guard (docs/04 §4.1) and eight **stand-in** handlers, plus `runMatrix()`, which returns a list of failures instead of throwing.
- `matrix.test.mjs` runs the matrix and the extras: a **completeness test that parses the route table out of `docs/04-agent-console.md`** (so a route added to the doc without a matrix row fails); a positive control (a valid `super_admin` gets 200 on all eight, so the matrix cannot pass by refusing everything); Origin / `Sec-Fetch-Site` on every POST; 503 outside production; and the Approve rules wired through the handler, using security-engineer's real `approveStepUp` (`../../../security-engineer/examples/01-bearer-step-up-and-origin/stepup.mjs`).
- **Mutants:** the matrix must FAIL when a route skips the guard (65 failures), touches a store before it (18), skips the signature check (31) or reads the role from the JWT (23).

**What this proves and what it does not.** It proves the harness: it catches those four bugs. The guard and handlers are **stand-ins**, because the real functions do not exist yet. In the real repo replace `makeGuard` and the `makeApp` handlers with imports of `netlify/functions/*.mts` and keep everything else. For `/api/jobs-run`, Netlify always answers `202` to a real caller, so only the handler's own status is observable here; the assertion that matters is "no work, no writes".

Cases (20): no header, Basic scheme, garbage, three garbage parts, expired, bad signature, another project's key, wrong `iss`, wrong `aud`, anonymous, PostgREST 401, role `user`, no row, JWT claims `super_admin` but profiles says `user`, profiles 500, 502, 404, 200-not-JSON, network error, JWKS unreachable.

Expectation vs. other examples: this matrix follows **docs/04 §4.1** (a failed profile read or JWKS fetch is **503**). supabase-auth-engineer's example 01 asserted 403 and 401 for those two cases when this was written; Vera asked her to change them (wave 3 list), so re-check before trusting a green run of both. Also, auth-js caches the JWKS per project URL module-wide, so a real "JWKS down" test needs a cold URL or a fresh module (her finding); this stand-in does not cache.

## Run
```bash
cd knowledge/qa-engineer/examples/05-every-function-matrix
node --test matrix.test.mjs        # Node built-ins only, no install
```

## Verified
Run 2026-11-23, Node v22.23.5:
```
#   8 routes x 20 cases = 160 checks, 0 failures
#   skipSignature mutant: 31 failures; trustJwtRole mutant: 23 failures
#   noGuard mutant: 65 failures; touch-before-guard mutant: 18 failures
# tests 15
# pass 15
# fail 0
```
My first mutant assertion was wrong: it expected the "signed by another project's key" case to catch a skipped signature check, but an unknown `kid` is refused earlier, at key lookup. Only the "bad signature (payload tampered)" case reaches that line, and the assertion now says so.
