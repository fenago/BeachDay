# Example 01 — v2 functions, background job + status, Blobs state

## What it demonstrates
Three Functions v2 handlers for the Agent Console, written the way Beach Day should write them:

| File | Route | Shows |
|---|---|---|
| `netlify/functions/lib/guard.mjs` | every `/api/*` | The auth check that is the **first line** of every handler: `Authorization: Bearer` header, a verifier that returns `{ sub, role }`, **401** (missing or invalid token), **403** (valid token, role is not `super_admin`), **503** (verifier missing or failing: fail closed, error text never echoed). The verifier is a **stand-in**. How a Supabase token is verified is decided by supabase-auth-engineer and reviewed by security-engineer. |
| `netlify/functions/jobs.mjs` | `POST /api/jobs` | The **sync wrapper** in front of the background worker: guard first, then method, body size (64 KB) and shape, then `setJSON(..., { onlyIfNew: true })`, and a one-time token whose **hash** is stored. `config.path`, `method` and `rateLimit` (one of the 2 Free-plan rules, the other is `/api/chat`). Own security headers. |
| `netlify/functions/job-run.mjs` | `POST /api/jobs-run` | `config.background: true`; returns nothing (Netlify sends `202`); writes all progress and results to Blobs; **idempotent** under Netlify's automatic retries (claim with compare-and-swap); the one-time token is the only gate, because a background function cannot reject its caller |
| `netlify/functions/job-status.mjs` | `GET /api/jobs/:id` | guard first, URLPattern named group -> `context.params.id` (no `excludedPath` needed: the worker lives at `/api/jobs-run`, a different path segment), strict id validation, `404` for unknown jobs, never returns internal fields |
| `netlify/functions/lib/blobs.mjs` | none | one place that calls `getStore({ name, consistency: "strong" })`, with a test hook to inject a fake store |
| `test/fake-blobs.mjs` | none | in-memory store with the documented `onlyIfNew` / `onlyIfMatch` -> `{ modified, etag }` semantics, and a fake `Context` |

Why this is "what good looks like":
- Custom headers from `_headers` are not applied to function responses ([headers docs](https://docs.netlify.com/manage/routing/headers/)), so every response carries `cache-control: no-store`, `nosniff`, a locked-down CSP and a JSON content type, including the 401, 403 and 503 answers.
- **The check comes before any work.** Test 2 proves that a rejected request touches no Blobs store and starts no worker.
- Background functions are retried after 1 and 2 minutes on error ([background functions](https://docs.netlify.com/build/functions/background-functions/)). The job is claimed with `onlyIfMatch(etag)`, so a retry or a duplicate request does nothing.
- Blobs defaults to eventual consistency (up to 60 s to propagate updates); job state uses `strong` ([Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)).
- No real secrets: tokens in the tests are obviously fake (`admin-token-EXAMPLE`). Nothing calls Netlify, Supabase, Claude or GitHub. The old password and cookie-session example (`login.mjs`) was **removed** on 2026-11-23 when the Console moved to Supabase Auth (Dr. Lee's decision 9); there is no `/api/login` any more.
- Respects ADR-0001 as amended by ADR-0006: these functions serve only the Console. No weather proxy.

Not shown (on purpose, to stay small): the real token verifier, the CSRF/step-up rules (security-engineer), and the real `fetch` that starts the worker (`setTrigger` stands in for it).

## How to run
```bash
npm install          # @netlify/blobs (imported by lib/blobs.mjs); @netlify/functions is types only
npm test             # = node --test test/functions.test.mjs
```
Node 22+. The handlers are plain ES modules called directly with a web `Request` and a fake context.

## Verified
Ran on 2026-11-23 with Node v22.23.5, `@netlify/blobs@11.1.10`, from a scratch copy of this folder (node_modules outside the repo):
```
$ node --test test/functions.test.mjs
ok 1 - config objects match the Beach Day routing plan
ok 2 - guard: no header / garbled header -> 401 with security headers and no work done
ok 3 - guard: unknown or expired token -> 401; valid token but role user -> 403
ok 4 - guard fails closed: verifier down -> 503 and the error text is never echoed; no verifier -> 503
ok 5 - jobs: super_admin -> 202, job stored as queued with only a token HASH, worker triggered once
ok 6 - jobs: bad shape -> 400, oversize -> 413, GET -> 405 (all after the auth check)
ok 7 - background job: runs once, writes status to Blobs, status endpoint reads it
ok 8 - background job: a Netlify retry (same body twice) is a no-op
ok 9 - background job: wrong token never starts the job
ok 10 - status: no token -> 401, role user -> 403, invalid id -> 400, unknown id -> 404
# tests 10
# pass 10
# fail 0
```
Mutation checks (the tests have teeth): removing the guard line from `job-status.mjs` fails tests 4 and 10; replacing the role comparison in `guard.mjs` with `false` fails tests 3 and 10; (earlier run) replacing `{ onlyIfMatch: cur.etag }` with `{}` in `job-run.mjs` fails the retry test.

Not verified here: behaviour on a real Netlify deploy (the `202`, the retry timing, real `rateLimit` enforcement). Those are platform features; check the deploy log's post-processing section for the rate-limit rules after the first deploy.
