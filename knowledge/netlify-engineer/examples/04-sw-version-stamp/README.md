# Example 04: service-worker version stamp, `version.json` and a post-deploy smoke test

## What it demonstrates
- `stamp-sw.mjs` is the design for `scripts/stamp-sw.mjs`. At build time it replaces every `__BUILD_VERSION__` in `public/sw.js` with the first 12 hex characters of `COMMIT_REF`, so **every deploy changes the bytes of `sw.js`** and installed phones see a new worker (Pip's finding: without it, phones never update). It also writes `public/version.json` (`{version, commit, builtAt}`), which the Console and the smoke test use to know which commit is live.
- Fallback order: `COMMIT_REF` (must be 40 hex), then `git rev-parse HEAD`, then a timestamp (`t20261123123456`). A junk `COMMIT_REF` is ignored, not trusted.
- Safety: **prints exactly one line and never prints env**; exits 1 (fails the build, which costs 0 credits and leaves the previous deploy live) when the file or the placeholder is missing; refuses to edit files unless `NETLIFY=true` or `--force`, so a local run cannot corrupt the tracked `sw.js`.
- `smoke.mjs` is the design for `scripts/smoke.mjs`, run by hand or by QA after an Approve deploy: unstamped `sw.js`, `sw.js` no-cache, version matches, manifest content type, CSP present, every `/api` route answers **401 with `cache-control: no-store`** when sent no token (fail-closed check), and optionally that `version.json.commit` equals the approved commit ("Live").

Why this is "what good looks like": it is small, it has no dependencies, and every failure mode either builds the right thing or fails loudly. Nothing here needs a Netlify account.

## How to run
```bash
node --test test/stamp.test.mjs      # Node 18+, no dependencies
```
Real use: `node scripts/stamp-sw.mjs` as the last step of the build command; `BASE_URL=https://<site> EXPECT_COMMIT=<sha> node scripts/smoke.mjs` after a deploy.

## Verified
Ran on 2026-11-23, Node v22.23.5, from a scratch copy:
```
$ node --test test/stamp.test.mjs
ok 1 - stamps every placeholder from COMMIT_REF and writes version.json
ok 2 - two different commits give different sw.js bytes (the reason this step exists)
ok 3 - fallback order: COMMIT_REF, then git HEAD, then timestamp; junk COMMIT_REF is ignored
ok 4 - fails the build when the placeholder is gone (already stamped) or the file is missing
ok 5 - CLI refuses outside Netlify unless --force, and never prints env
ok 6 - smoke: a correct deploy passes every check
ok 7 - smoke: catches an unstamped sw.js and an open /api route
# tests 7
# pass 7
# fail 0
```
Mutation check: replacing the replace-all (`split/join`) with `String.replace` (first match only) fails tests 1, 2, 4 and 5.

Not verified: that `COMMIT_REF` and `NETLIFY=true` are set inside a real Netlify build (the ignore-builds page names the Git metadata variables and `NETLIFY`; not re-read on 2026-11-23, because docs.netlify.com was unreachable from the sandbox) **[UNVERIFIED here]**. The fallbacks mean a missing `COMMIT_REF` still changes the bytes; a missing `NETLIFY=true` fails the build loudly (exit 1), which is the safe direction. The smoke test ran against a local fake server, not a real deploy.
