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

## Observed (examples/01, supabase-js 2.119.2)
- auth-js keeps the JWKS in a **module-wide cache keyed by project URL**. A warm function instance keeps verifying after the network drops; a cold one fails closed.
- `getClaims` checks signature and `exp`. It does **not** compare `iss` or `aud` to your project for you, so the example checks both itself.

## Decision for Beach Day (agent-builder, for Vera to review)
1. **Default: `getClaims(token)`** on every `/api/*` function. No Auth round trip, works with only `SUPABASE_URL` and the publishable key, and is the method the docs point to.
2. **Then check `iss`, `aud === 'authenticated'`, `is_anonymous !== true`, `sub`** yourself.
3. **The role comes from `public.profiles.role`, read with the user's own token** through PostgREST (RLS returns only their row). Never from a JWT claim or `user_metadata`. The read also makes PostgREST validate the token server-side, and a role change by Dr. Lee takes effect on the next request.
4. **Approve (and any step-up path) additionally calls `getUser(token)`** so a revoked or deleted user fails even before `exp`. Whether `getUser` rejects an access token whose session was signed out is **UNVERIFIED** in the pages read; test it against the real project before relying on it.
5. Keep the access-token lifetime short (Dashboard setting; the docs say 5 minutes to 1 hour) because a signed-out token stays valid until `exp`. The exact value is Vera's call.
6. If the project turns out to use the legacy HS256 secret, `getClaims` falls back to a `getUser`-style call. Prefer asymmetric signing keys (new projects get them; confirm in Dashboard, **UNVERIFIED** for this project).
