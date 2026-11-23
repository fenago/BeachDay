# Example 02 — Beach Day `netlify.toml` + `public/_headers`

## What it demonstrates
A complete, minimal platform config for Beach Day and a validator that checks it.

- `netlify.toml`: build command (`build-agents` then `stamp-sw`, no tests), `publish = "public"`, `NODE_VERSION` pin, functions directory **outside** the publish dir, `esbuild` bundler, `included_files` for `agents.json`, and an `ignore` command that skips commits that change nothing that ships. There is **no `netlify.toml` in the repo yet**; this is the spec for it.
- `public/_headers`: site-wide CSP and security headers (including `form-action 'self'`), `sw.js` revalidation, manifest content type, `version.json` no-store, `noindex` + `no-store` on the Console page. The Supabase host in `connect-src` is not added yet (project not created; security-engineer owns the final CSP).
- `validate.mjs`: parses the TOML (smol-toml), parses `_headers` with the documented syntax, checks Beach Day rules, and **runs the ignore command** in a throwaway git repo to prove its exit codes.

Why this is "what good looks like":
- **Credits (ADR-0004):** a production deploy is 15 credits; failed deploys and rollbacks cost 0 ([how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)). The `ignore` command returns `0` (skip) for commits that touch only `docs/`, `knowledge/`, `tests/`, `.claude/skills/` or root Markdown ([ignore builds](https://docs.netlify.com/build/configure-builds/ignore-builds/)). It watches `.claude/agents` and `scripts`, because `agents.json` is generated from them. **It builds when `CACHED_COMMIT_REF` is empty**: the older form without that guard skips a first build (control check below). Whether a skipped build costs 0 credits is not stated on the pages read **[UNVERIFIED]**.
- **One source for headers.** Headers are in `_headers` only, and each header name is set by exactly one rule for any path, so no response gets two CSPs.
- **CSP matches ADR-0001:** `connect-src` allows `'self'` plus the two Open-Meteo hosts. The browser never talks to Claude or GitHub; functions do.
- **No secrets in the file.** Variables in `netlify.toml` are not visible to functions anyway ([functions env vars](https://docs.netlify.com/build/functions/environment-variables/)), and function rate limits cannot be declared in `netlify.toml` ([rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)).
- Function responses (`/api/*`) are **not** covered by `_headers`; see example 01 for headers set in code.

## How to run
```bash
npm install            # smol-toml
node validate.mjs      # needs git and bash on PATH
```

## Verified
Ran on 2026-11-23, Node v22.23.5, smol-toml 1.9.1, from a scratch copy (node_modules outside the repo). 52 checks pass. The ones that matter, trimmed:
```
$ node validate.mjs
PASS  build command runs build-agents then stamp-sw
PASS  build command does not run tests (agent-writable tests/** would see build secrets)
PASS  no [[headers]] in toml (single source: public/_headers)
PASS  /sw.js: each header set once (6 headers)
PASS  CSP has form-action 'self'
PASS  /version.json is Cache-Control: no-store
PASS  ignore: docs/notes.md only -> exit 0 (build skipped, 0 credits)
PASS  ignore: knowledge/x/README.md only -> exit 0 (build skipped, 0 credits)
PASS  ignore: tests/unit/a.test.js only -> exit 0 (build skipped, 0 credits)
PASS  ignore: .claude/skills/s/SKILL.md only -> exit 0 (build skipped, 0 credits)
PASS  ignore: CLAUDE.md only -> exit 0 (build skipped, 0 credits)
PASS  ignore: public/index.html -> exit 1 (build runs)
PASS  ignore: public/sw.js -> exit 1 (build runs)
PASS  ignore: .claude/agents/qa.md -> exit 1 (build runs)
PASS  ignore: scripts/build-agents.mjs -> exit 1 (build runs)
PASS  ignore: netlify/functions/chat.mts -> exit 1 (build runs)
PASS  ignore: netlify.toml -> exit 1 (build runs)
PASS  ignore: package.json -> exit 1 (build runs)
PASS  ignore: package-lock.json -> exit 1 (build runs)
PASS  ignore: CACHED_COMMIT_REF empty (first build) -> exit 1 (build runs)
PASS  ignore: cached commit missing from clone -> exit 1 (build runs)
PASS  control: naive command SKIPS a first build when CACHED_COMMIT_REF is empty (why the -n guard exists)
all checks passed
```
Negative check (earlier run, still valid): appending `/api/*` + `Set-Cookie: x=1` and a line `bad line` to a copy of `_headers` gave `FAIL line 30: path must start with "/"` and `FAIL no header Netlify ignores`.

Not verified (docs.netlify.com could not be fetched from the sandbox on 2026-11-23):
- How Netlify merges headers when two `_headers` rules, or `_headers` and `[[headers]]`, set the **same** header for one path **[UNVERIFIED]**. This file avoids the case, which is why the validator checks that each name is set once per path and that no `[[headers]]` exists.
- Whether `Strict-Transport-Security` is already added by Netlify **[UNVERIFIED]**; setting it is harmless.
- The exact value of `CACHED_COMMIT_REF` on a first build or after a cache clear **[UNVERIFIED]**; the command builds in every case where it is empty or unusable.
- That the key `NODE_VERSION` under `[build.environment]` pins the build's Node **[UNVERIFIED here]**; widely documented, not re-read today.
