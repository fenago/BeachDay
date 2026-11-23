# Example 03: the browser calls (sign up, log in, Google, forgot password, log out)

## What it shows
`auth-calls.mjs` is the supabase-js client the Console login page builds, with a mocked `fetch` and an in-memory storage so it runs under Node. It pins the choices the docs leave open:
- `flowType: 'pkce'` (the library default is `'implicit'`);
- `signInWithOAuth({ provider: 'google', options: { redirectTo } })`, checked through `skipBrowserRedirect` (the URL is on the project's `/auth/v1/authorize`, with `code_challenge`);
- the publishable key on the `apikey` header;
- `signOut({ scope: 'local' })`, because the default scope is `global` (every device).

## Run
```bash
cd knowledge/supabase-auth-engineer/examples/03-browser-auth-calls
npm install      # supabase-js 2.119.2; do not commit node_modules
npm test
```

## Verified
Run 2026-11-23, Node v22.23.5, @supabase/supabase-js 2.119.2:
```
ok 1 - Google: signInWithOAuth builds the provider URL on the project, with PKCE and our redirect
ok 2 - log in: password grant, publishable key on the apikey header
ok 3 - sign up: /signup with email redirect and PKCE challenge
ok 4 - forgot password: /recover with our reset redirect
ok 5 - log out: our button revokes only this session (scope=local)
ok 6 - log out: the library default is GLOBAL scope (every device); we override it on purpose
# tests 6
# pass 6
# fail 0
```
Not verified: a real browser, the real Google round trip, and the vendored no-build ESM file (Rowan's ADR-0006 decides how supabase-js is loaded; the package ships a ~224 KB `dist/umd` bundle, measured in 2.119.2).
