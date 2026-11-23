# Verifying a Supabase access token on the server: getClaims vs getUser
Sources (canonical pages): https://supabase.com/docs/guides/auth/jwts · https://supabase.com/docs/guides/auth/signing-keys · https://supabase.com/docs/reference/javascript/auth-getclaims · https://supabase.com/docs/reference/javascript/auth-getuser
Retrieved: 2026-11-23. **supabase.com is blocked in this sandbox (proxy 403).** The text was read from the official docs source (`supabase/supabase` repo, `apps/docs/content/guides/auth/jwts.mdx` and `signing-keys.mdx`, via raw.githubusercontent.com) and from the JSDoc in `@supabase/auth-js` 2.119.2 (the reference pages are generated from it). Re-check the live pages when supabase.com is allowed.

## What the docs say
- Access token = a JWT. Claims that matter: `iss` (append `/.well-known/jwks.json` to get the public keys), `exp`, `sub` (user ID), `role` (the *Postgres* role, `authenticated`), plus `aud`, `aal`, `amr`, `session_id`, `is_anonymous`, `iat`. (jwts.mdx; `getClaims` example response.)
- "To verify the signature avoid implementing the algorithms yourself and instead rely on `supabase.auth.getClaims()`, or other high-quality JWT verification libraries." (jwts.mdx)
- `getClaims(jwt?, options?)` (auth-js JSDoc):
  - parses the access token and "returns its components if valid and not expired";
  - **asymmetric signing keys:** verified locally with WebCrypto, "usually without a network request"; the JWKS (`/auth/v1/.well-known/jwks.json`) is fetched and cached;
  - **symmetric (HS256) secret:** "always sends a request similar to `getUser()`" to validate at the server (also when WebCrypto is missing);
  - with no `jwt` argument it uses the current session and may refresh it first; on a server, **pass the token**;
  - `options.allowExpired` skips only the `exp` check. Never set it.
- `getUser(jwt?)`: "fetches the user object from the database instead of local session ... validates the access token JWT on the server" and "Should always be used when checking for user authorization on the server." It is a network call to the Auth server, which "runs only in your project's specified region and is not globally distributed" (jwts.mdx), so it is slower.
- `getSession()` on a server is insecure: its user object "must not be trusted" (auth-js JSDoc).
- JWKS caching: Supabase Edge caches the endpoint 10 minutes and the client library may cache another 10; "multi-level cache is cleared every 20 minutes". Revocation of a signing key can lag that long in your function (signing-keys.mdx). Supabase's own products do not use that cache.
- Sign-out does **not** revoke an access token: "the access token JWT will be valid until it's expired" (`signOut` JSDoc). `getClaims` verifies locally, so it cannot see a sign-out. Sessions live in `auth.sessions`; the docs say a missing `session_id` row means the user signed out (sessions.mdx). Access tokens last "between 5 minutes and 1 hour".

## Observed (examples/01, @supabase/auth-js 2.119.2)
- **Failures come back as `{ error }`, not as a throw.** A network failure or a 5xx from the JWKS or `/user` endpoint returns an `AuthRetryableFetchError` (`isAuthRetryableFetchError(error)`; status 0 for a network error). Map it to **503**, and any other auth error to **401**. A `catch` alone never sees an outage.
- **JWKS cache:** module-wide, keyed by the client's **`storageKey`**. With auth-js directly, set `storageKey: 'sb-<ref>-auth-token'`. A warm function instance keeps verifying after the network drops; a cold one gets 503.
- **Unknown `kid`, an `HS*` algorithm or no WebCrypto: `getClaims` falls back to `GET /auth/v1/user`.** A forged token with a random `kid` therefore costs one Auth round trip.
- `getClaims` checks signature and `exp`. It does **not** compare `iss` or `aud` to your project, so the example checks both itself.

## Read in the Auth server source (supabase/auth `master`, 2026-11-23; not the docs; hosted may differ, so test it)
- `GET /user` (`getUser`) loads the session named by the token's `session_id`. If that row is gone (signed out), it answers **403 `session_not_found`**. A deleted user gets 403 `user_not_found`, and a banned user gets 403 `user_banned` (`internal/api/auth.go`). So `getUser` *should* reject a signed-out token before `exp`; docs/04 §4.2 pre-launch test (d) confirms it on the real project.

## Decision for Beach Day (accepted by security-engineer; canonical text: docs/04 §4.1 and §4.2)
1. **`getClaims(token)`** on every `/api/*` function, through **`@supabase/auth-js`** pinned to an exact version (ADR-0006). No Auth round trip; it needs only `SUPABASE_URL` and the publishable key.
2. **Check `iss`, `aud === 'authenticated'`, `is_anonymous !== true` and `sub`** yourself.
3. **Read the role from `public.profiles.role` with the user's own token** through PostgREST, so RLS returns only their row. Never read it from a JWT claim or `user_metadata`. The role is not cached.
4. **Status codes:**
   - **401** for a bad token or a PostgREST 401;
   - **403** for a role that is not `super_admin`, or no row;
   - **503** for any network error, timeout, 5xx, retryable auth error, other unexpected status or bad JSON.
   Never allow, and never echo the error. Reference: examples/01.
5. **Approve also calls `getUser(token)`** (docs/04 §4.2). Map its `{ error }` the same way: retryable gives 503, anything else gives 401.
6. **Access-token lifetime is 600 s** (docs/04 §4.3), because a signed-out token stays valid for `getClaims` until `exp`.
7. If the project turns out to use the legacy HS256 secret, `getClaims` calls `/user` on every request. Prefer asymmetric signing keys; new projects get them. Confirm in the Dashboard (**UNVERIFIED** for this project).
