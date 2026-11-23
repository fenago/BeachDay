# Example 04: build steps (service-worker stamp, Supabase `config.js`) and a post-deploy smoke test

## What it demonstrates
- `stamp-sw.mjs` is the design for `scripts/stamp-sw.mjs`. At build time it replaces every `__BUILD_VERSION__` in `public/sw.js` with the first 12 hex characters of `COMMIT_REF`, so **every deploy changes the bytes of `sw.js`** and installed phones see a new worker (Pip's finding: without it, phones never update). It also writes `public/version.json` (`{version, commit, builtAt}`), which the Console and the smoke test use to know which commit is live.
- Fallback order: `COMMIT_REF` (must be 40 hex), then `git rev-parse HEAD`, then a timestamp (`t20261123123456`). A junk `COMMIT_REF` is ignored, not trusted.
- Safety: **prints exactly one line and never prints env**; exits 1 (fails the build, which costs 0 credits and leaves the previous deploy live) when the file or the placeholder is missing; refuses to edit files unless `NETLIFY=true` or `--force`, so a local run cannot corrupt the tracked `sw.js`.
- `smoke.mjs` is the design for `scripts/smoke.mjs`, run by hand or by QA after an Approve deploy: unstamped `sw.js`, `sw.js` no-cache, version matches, manifest content type, CSP present, CSP has no `unsafe-*` or wildcard, `Cross-Origin-Opener-Policy: same-origin`, every **sync** `/api` route (agents, chat, jobs, jobs/:id, proposals/:id, reject, approve) answers **401 with `cache-control: no-store`** when sent no token (fail-closed check), and optionally that `version.json.commit` equals the approved commit ("Live").

- `gen-config.mjs` is the design for `scripts/gen-config.mjs` (ADR-0006 point 3), the last build step. It writes the **git-ignored** `public/generated/config.js` (`SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `BUILD_VERSION`) that the Console page imports, so the env vars stay the single source of truth for functions and browser. It reads three variables **by name** (never `process.env` as a whole). It **fails the build** (exit 1, 0 credits, previous deploy stays live) unless `SUPABASE_PUBLISHABLE_KEY` starts with `sb_publishable_`, which catches a pasted `sb_secret_` key and the legacy JWT-style `anon` / `service_role` keys, and unless `SUPABASE_URL` is a bare `https` origin, **and unless the CSP `connect-src` in `public/_headers` names exactly that origin** (no `*.supabase.co` wildcard, no other supabase.co host, no leftover `<project-ref>` placeholder; docs/04 §10). A rejected value is **never echoed**, because it may be a secret key and build logs are not private. It prints one line and refuses to run outside Netlify unless `--force`.

**`/api/jobs-run` is deliberately not probed.** A background function always answers `202`, so a `202` proves nothing and a `401` is impossible; its guard is covered by example 01 (test 10). A smoke test that expected 401 there would always fail. A test asserts that the smoke never calls it.

**Fixtures are built at runtime.** The fake secret key, the fake legacy JWT and the other-variable value in `test/gen-config.test.mjs` are assembled from parts plus random bytes on every run, so no literal that looks like `sb_secret_...`, a JWT or an `sk-ant-...` key exists in the repo for a scanner or push protection to flag (Vera's rule: no "EXAMPLE" exemption).

Why this is "what good looks like": it is small, it has no dependencies, and every failure mode either builds the right thing or fails loudly. Nothing here needs a Netlify account.

## How to run
```bash
node --test test/stamp.test.mjs test/gen-config.test.mjs      # Node 18+, no dependencies
```
Real use: `node scripts/stamp-sw.mjs && node scripts/gen-config.mjs` (it reads `public/_headers` from the working directory and fails closed if that file is missing) as the last steps of the build command (`gen-config` imports `pickVersion` from the `stamp-sw.mjs` next to it); `BASE_URL=https://<site> EXPECT_COMMIT=<sha> node scripts/smoke.mjs` after a deploy.

## Verified
Re-ran on 2026-11-23 (wave 3), Node v22, from a scratch copy:
```
$ node --test test/stamp.test.mjs test/gen-config.test.mjs
ok 1 - writes config.js from the three named variables only
ok 2 - rejects a secret key, a legacy JWT key, a missing key; the log never shows the value
ok 3 - rejects a bad URL (http, path, credentials, missing)
ok 4 - CLI: succeeds on Netlify with valid values, prints one line, refuses outside Netlify without --force
ok 5 - CSP host check: the build fails unless public/_headers names exactly the SUPABASE_URL origin (no wildcard, no other host)
ok 6 - stamps every placeholder from COMMIT_REF and writes version.json
ok 7 - two different commits give different sw.js bytes (the reason this step exists)
ok 8 - fallback order: COMMIT_REF, then git HEAD, then timestamp; junk COMMIT_REF is ignored
ok 9 - fails the build when the placeholder is gone (already stamped) or the file is missing
ok 10 - CLI refuses outside Netlify unless --force, and never prints env
ok 11 - smoke: a correct deploy passes every check
ok 12 - smoke: catches an unstamped sw.js and an open /api route
# tests 12
# pass 12
# fail 0
```
Mutation checks: removing the `checkCspHost` call fails test 5 (wave 3). Removing both key checks in `gen-config.mjs` (the `sb_publishable_` prefix test and the shape test) fails test 2, so a secret key would no longer fail the build. Removing only the prefix test does not fail a test, because the shape test also rejects it (two layers). Replacing the replace-all (`split/join`) with `String.replace` (first match only) fails tests 1, 2, 4 and 5.

Not verified:
- **Secret scanning and the publishable key [UNVERIFIED].** Netlify scans build output for secret env values. `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are deliberately **not** marked secret, so scanning should not flag `config.js`. Whether Netlify also scans non-secret values by default could not be re-read (docs.netlify.com did not resolve from the sandbox). The first real deploy is the test. If the build fails with a scan hit on `public/generated/config.js`, set `SECRETS_SCAN_OMIT_KEYS=SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY` (a documented scan control, see `docs/04`) rather than turning scanning off.
- **A build without the two variables fails by design.** Deploy Previews and branch deploys need the values too (set them for all contexts, as in the env table), or those builds fail. A failed build costs 0 credits.
- That `COMMIT_REF` and `NETLIFY=true` are set inside a real Netlify build (the ignore-builds page names the Git metadata variables and `NETLIFY`; not re-read on 2026-11-23, because docs.netlify.com was unreachable from the sandbox) **[UNVERIFIED here]**. The fallbacks mean a missing `COMMIT_REF` still changes the bytes; a missing `NETLIFY=true` fails the build loudly (exit 1), which is the safe direction. The smoke test ran against a local fake server, not a real deploy.
