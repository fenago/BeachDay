# Example 03: the browser calls (sign up, confirm, log in, Google, forgot password, refresh, log out)

## What it shows
`auth-calls.mjs` builds the auth client the Console page uses. It is **`@supabase/auth-js` `AuthClient`**, the same library as the vendored auth-only bundle in `public/vendor/` (ADR-0006). It runs under Node with a mocked `fetch` and an in-memory storage. It pins the choices the docs leave open:
- `flowType: 'pkce'` (the library default is `'implicit'`).
- **`autoRefreshToken: true`.** The library ticker runs every 30 s and refreshes when about 90 s are left. `ensureFresh(120)` adds the docs/04 §4.1 rule: before `/api/chat` or `/api/jobs`, refresh if less than 120 s are left.
- `detectSessionInUrl: false`. The Console handles `?code=` and `?token_hash=` itself, then strips them with `history.replaceState`.
- `signInWithOAuth({ provider: 'google', options: { redirectTo } })`, checked through `skipBrowserRedirect`. The URL is on the project's `/auth/v1/authorize`, with `code_challenge`.
- `confirmFromEmail(token_hash, type)`, which calls `verifyOtp({ token_hash, type })`. This needs no PKCE code verifier, so an email link works in whichever browser opens it (see docs/06). Only `email` and `recovery` are accepted.
- `resendConfirmation(email)`, which calls `resend({ type: 'signup', ... })`.
- The publishable key on the `apikey` header.
- `signOut({ scope: 'local' })`, because the default scope is `global` (every device).
- Every call is made from JS. **Never sign in through a `<form action="…">`.**

## Run
```bash
cd knowledge/supabase-auth-engineer/examples/03-browser-auth-calls
npm install      # @supabase/auth-js 2.119.2; do not commit node_modules
npm test
```

## Verified
Run 2026-11-23 from a clean install, Node v22.23.5, @supabase/auth-js 2.119.2:
```
ok 1 - Google: signInWithOAuth builds the provider URL on the project, with PKCE and our redirect
ok 2 - log in: password grant, publishable key on the apikey header
ok 3 - sign up: /signup with email redirect and PKCE challenge
ok 4 - forgot password: /recover with our reset redirect
ok 5 - log out: our button revokes only this session (scope=local)
ok 6 - log out: the library default is GLOBAL scope (every device); we override it on purpose
ok 7 - Console client: autoRefreshToken is on, so a token near expiry is refreshed without a request from the page
ok 8 - ensureFresh(120): refreshes when less than 120 s are left (docs/04 4.1), and not otherwise
ok 9 - email link with token_hash: verifyOtp POSTs /verify and needs no code verifier (works in any browser)
ok 10 - email link: an unknown type is refused before any network call
ok 11 - resend confirmation: POST /resend with type signup and our redirect
ok 12 - OBSERVED: a PKCE ?code= opened in another browser (no stored verifier) fails locally with pkce_code_verifier_not_found
# tests 12
# pass 12
# fail 0
```
- Tests 7–11 were written first and failed against the previous version.
- A side probe showed that test 7's refresh comes from the ticker, not from `setSession`: the same setup with `autoRefreshToken: false` made 0 refresh calls; with `true` it made 1.

## Not verified
- A real browser, the real Google round trip, and real email links.
- The custom email templates that produce `token_hash` links (docs/06) have not been tried on a real project.
