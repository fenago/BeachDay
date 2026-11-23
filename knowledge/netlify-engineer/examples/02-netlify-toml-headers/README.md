# Example 02 — Beach Day `netlify.toml` + `public/_headers`

## What it demonstrates
A complete, minimal platform config for Beach Day and a validator that checks it.

- `netlify.toml`: build command (generates `agents.json`), `publish = "public"`, functions directory **outside** the publish dir, `esbuild` bundler, `included_files` for `agents.json`, and an `ignore` command that skips docs-only commits.
- `public/_headers`: site-wide CSP and security headers, `sw.js` revalidation, manifest content type, `noindex` + `no-store` on the Console page.
- `validate.mjs`: parses the TOML (smol-toml), parses `_headers` with the documented syntax, checks Beach Day rules, and **runs the ignore command** in a throwaway git repo to prove its exit codes.

Why this is "what good looks like":
- **Credits (ADR-0004):** a production deploy is 15 credits; failed deploys and rollbacks cost 0 ([how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)). The `ignore` command returns `0` (skip) for docs-only commits ([ignore builds](https://docs.netlify.com/build/configure-builds/ignore-builds/)). It also watches `.claude/agents` and `scripts`, because `agents.json` is generated from them. The sketch in `docs/03` (`-- public netlify`) would have skipped those builds, leaving the Console showing stale agents.
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
Ran on 2026-11-23, Node v22.23.5, smol-toml 1.9.1, from a scratch copy (node_modules outside the repo):
```
$ node validate.mjs
PASS  netlify.toml parses as TOML
PASS  [build] publish = public
PASS  functions directory is outside publish directory
PASS  no [[headers]] in toml (single source: public/_headers)
PASS  no function rate limits in toml (not supported there)
PASS  ignore command watches '.claude/agents'
PASS  _headers parses: 5 paths, each with headers
PASS  no header Netlify ignores (Set-Cookie, Location, ...)
PASS  /console: each header set once (7 headers)
PASS  CSP connect-src allows both Open-Meteo hosts (browser calls them directly, ADR-0001)
PASS  CSP does not let the browser call Claude or GitHub (functions do)
PASS  /sw.js is Cache-Control: no-cache
PASS  ignore: docs-only commit -> exit 0 (build skipped, no credits)
PASS  ignore: change under public/ -> exit 1 (build runs)
PASS  ignore: agent file change -> exit 1 (agents.json must rebuild)

all checks passed          (32 checks; trimmed)
```
Negative check: appending `/api/*` + `Set-Cookie: x=1` and a line `bad line` to a copy of `_headers` gave `FAIL line 30: path must start with "/"` and `FAIL no header Netlify ignores`.

Not verified: how Netlify merges headers when two `_headers` rules set the **same** header for one path **[UNVERIFIED]**. The docs only describe repeating a header within one rule (values are joined). This file avoids the case. Whether `Strict-Transport-Security` is already added by Netlify is also **[UNVERIFIED]**; setting it is harmless.
