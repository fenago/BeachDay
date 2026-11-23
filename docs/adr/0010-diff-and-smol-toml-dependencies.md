# 0010 — Two new npm dependencies: `diff` (runtime) and `smol-toml` (dev)
- Status: Proposed
- Date: 2026-11-23
- Deciders: Dr. Lee (+ software-architect drafted; security-engineer reviewed in W1 (R2); netlify-engineer and agent-console-engineer, who use them)

## Context
- Our rule (`secure-by-design`, `architecture-decision-records`) is that a new dependency needs an ADR. Runtime dependencies were limited to four: `@anthropic-ai/sdk`, `@netlify/blobs`, the `@netlify/functions` types and `@supabase/auth-js`.
- During the v1 build (wave W1), two packages were added to `package.json` with exact pins:
  - **`diff@9.0.0`**, a runtime dependency. `netlify/functions/lib/diff.mts` uses it to build the unified diff that the proposal card and the Approve sheet show (docs/04 §1 step 4, §2.1 `diffs[]`). It runs on the server, inside `GET /api/proposals/:id`.
  - **`smol-toml@1.9.1`**, a dev dependency. Tests use it to parse `netlify.toml` (`tests/unit/deploys.test.mjs` keeps `DEPLOY_PATHS` equal to the `ignore` path list; `tests/unit/headers.test.mjs` and `tests/unit/scripts/ignore.test.mjs` also read it). It never ships and never runs in the Netlify build (no test runner in the build, docs/03 §9.4).
- Facts checked on 2026-11-23 against the installed packages:
  - both are BSD-3-Clause;
  - both have **zero dependencies** of their own;
  - neither has an `install`, `preinstall`, `postinstall` or `prepare` script;
  - `npm audit` reports 0 vulnerabilities, with and without dev dependencies;
  - both are pinned exactly in `package.json`, with a lockfile.
- The alternatives were to write our own diff (about 80 lines of Myers or LCS code, plus its tests) and our own TOML reading (a regex over one line of `netlify.toml`). The diff is user-visible on the security-critical Approve path, where a wrong diff would show the reviewer something other than what gets committed. A widely used library is the boring, safer choice there.

## Decision
We will keep both dependencies, pinned exactly:
1. **`diff` 9.0.0** in `dependencies`. It is imported only by `netlify/functions/lib/diff.mts`. It never reaches the browser: the browser receives diff text and renders it with `textContent`.
2. **`smol-toml` 1.9.1** in `devDependencies`. It is imported only by tests. Nothing in `netlify/**`, `scripts/**` or `public/**` may import it.
3. **The runtime dependency list becomes five:** `@anthropic-ai/sdk`, `@netlify/blobs`, `@netlify/functions` (types), `@supabase/auth-js` and `diff`. `secure-by-design` and `architecture-decision-records` record this.
4. Upgrades follow the usual rules: a human edits `package.json` and `package-lock.json` (both are on the agents' deny list), `npm audit` stays clean, and a major version of `diff` gets a security-engineer review, because the diff is what the human approves.

## Consequences
- **Good:** a correct, maintained diff on the Approve path with no transitive packages, and a real TOML parser in tests instead of a fragile regex.
- **Bad:** one more runtime package to watch for advisories, and about 50 KB more in the bundle of the function that imports it (UNVERIFIED size after esbuild; it doesn't affect any page-weight budget).
- **Neutral:** no change to cost, deploys or the trust boundary. The diff runs on data we already hold (the proposal and the `main` file read through the read-only GitHub module).
- **Follow-up:** add the dependency check to the W1 security review notes; keep `npm audit` in the CI workflow when a human adds it (D11).

## Revisit when
- `diff` or `smol-toml` publishes an advisory, gains a dependency or an install script, or changes licence.
- We need diff rendering in the browser (that would be a front-end dependency and a new ADR).
