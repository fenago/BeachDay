# Example 04: Vendoring `@supabase/auth-js` for a no-build, `script-src 'self'` Console (ADR-0006)

## What it demonstrates

ADR-0006 needs the Console to call Supabase Auth from the browser, and it must do that with:
- no bundler for `public/`;
- no CDN;
- CSP `script-src 'self'` with no `'unsafe-eval'`.

This example shows why we vendor **one pre-bundled file** and checks that the file is fit for that use.

| File | Purpose |
|---|---|
| `entry-auth.js` | esbuild entry that re-exports only `AuthClient` from `@supabase/auth-js`. This is what we vendor |
| `entry-full.js` | Comparison only: the full `createClient` from `@supabase/supabase-js` |
| `check-bundle.mjs` | Dependency-free checker. It confirms:<ul><li>no bare import specifiers (the browser could resolve them only with an import map);</li><li>no `eval(` or `new Function(`;</li><li>size, gzip size and sha256;</li><li>the 11 auth methods the Console needs are present;</li><li>`signInWithPassword` against a **fake fetch** makes exactly one call, `POST <project>/auth/v1/token`. No network is used.</li></ul> |

The bundle itself is **not** committed here. In the app, a human commits it to `public/vendor/supabase-auth-js-<version>.mjs`, which is deny-listed for agents.

## Why this is "what good looks like"

- **We checked the npm package before deciding.**
  - `@supabase/supabase-js@2.119.2` has no UMD or single-file browser build: `dist/` holds `index.mjs` and `index.cjs` only.
  - Its `index.mjs` imports five `@supabase/*` packages by bare specifier. A browser without a bundler or import map can't load it.
  - Running the checker on the raw dist file shows the failure, which is why "just copy the npm file" doesn't work.
- **Auth only, so less surface.** The auth-only bundle is 104,198 bytes (about 25 KB gzipped), against about 59 KB gzipped for full supabase-js. It also leaves out the Realtime websocket and Storage code, which ADR-0006 forbids us to use anyway. The browser never reads `profiles`; "no access" comes from a `403` on `/api/agents`.
- **CSP-compatible.** No `eval` or `new Function`, so `script-src 'self'` stays as it is.
- **Supabase's docs still apply.** The docs show `supabase.auth.signInWithOAuth(...)` and similar. `AuthClient` is the same GoTrue client, so each `supabase.auth.X` maps to `auth.X`.
- **Reproducible and pinned.** The exact version is in the filename. The same version goes in `package.json` for the functions' token verification, and a unit test should assert that the two match. The sha256 below lets a reviewer confirm a re-bundle is byte-identical for the same esbuild version.

## How to run

```bash
# outside the repo (never commit node_modules)
S=/path/to/scratch && mkdir -p $S && cd $S && npm init -y >/dev/null
npm i @supabase/auth-js@2.119.2 @supabase/supabase-js@2.119.2 esbuild@0.25.12
cp <repo>/knowledge/software-architect/examples/04-vendored-auth-client/entry-*.js .
npx esbuild entry-auth.js --bundle --format=esm --platform=browser --target=es2022 --minify \
  --outfile=supabase-auth-js-2.119.2.mjs
node <repo>/knowledge/software-architect/examples/04-vendored-auth-client/check-bundle.mjs supabase-auth-js-2.119.2.mjs
```

## Verified

Run on 2026-11-23 with Node v22.23.5, esbuild 0.25.12 and @supabase/auth-js 2.119.2 (npm `latest` that day):

```
PASS  no bare import specifiers
PASS  no eval( or new Function( (no unsafe-eval needed)
INFO  bytes=104198 gzip=24919 sha256=0cb560974365cc2fc1a68e5444a30c6534cf59308fdfcbedf100c5947fae0e72
PASS  AuthClient#signUp
PASS  AuthClient#signInWithPassword
PASS  AuthClient#signInWithOAuth
PASS  AuthClient#signOut
PASS  AuthClient#resetPasswordForEmail
PASS  AuthClient#updateUser
PASS  AuthClient#reauthenticate
PASS  AuthClient#getSession
PASS  AuthClient#getClaims
PASS  AuthClient#onAuthStateChange
PASS  AuthClient#exchangeCodeForSession
PASS  signInWithPassword resolves against the fake fetch
PASS  only call: POST https://example-ref.supabase.co/auth/v1/token
ALL BUNDLE CHECKS PASSED
exit=0
```

Negative checks, same run:

```
--- raw npm dist (no bundling): node_modules/@supabase/supabase-js/dist/index.mjs
FAIL  no bare import specifiers: @supabase/functions-js, @supabase/postgrest-js, @supabase/realtime-js, @supabase/storage-js, @supabase/auth-js, ...
--- full supabase-js bundle (comparison)
FAIL  no bare import specifiers: @supabase/supabase-js/tracing
INFO  bytes=226091 gzip=59625
```

The full bundle's single hit may be a string literal rather than a real import; it was not investigated, because we don't vendor that bundle.

## Not verified here

- **Real browser use.** The flows were not run in a browser: the redirect from `signInWithOAuth` to Google, PKCE `exchangeCodeForSession`, or `localStorage` persistence. The facts about the auth flows belong to supabase-auth-engineer's knowledge folder (`knowledge/supabase-auth-engineer/`).
- **Supabase plan limits.** supabase.com could not be reached from the sandbox, so they are **[UNVERIFIED]**.
