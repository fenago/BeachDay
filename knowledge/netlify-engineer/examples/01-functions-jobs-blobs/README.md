# Example 01 — v2 functions, background job + status, Blobs state

## What it demonstrates
Three Functions v2 handlers for the Agent Console, written the way Beach Day should write them:

| File | Route | Shows |
|---|---|---|
| `netlify/functions/login.mjs` | `POST /api/login` | `config.path`, `config.method`, `config.rateLimit` (one of the 2 Free-plan rules), its **own** security headers, input validation, secrets read only from `process.env`, signed session cookie via `context.cookies.set` |
| `netlify/functions/job-run.mjs` | `POST /api/jobs/run` | `config.background: true`; returns nothing (Netlify sends `202`); writes all progress and results to Blobs; **idempotent** under Netlify's automatic retries (claim with compare-and-swap); one-time job token because a background function cannot reject its caller |
| `netlify/functions/job-status.mjs` | `GET /api/jobs/:id` | URLPattern named group → `context.params.id`, `excludedPath`, strict id validation, `404` for unknown jobs, never returns internal fields |
| `netlify/functions/lib/blobs.mjs` | — | one place that calls `getStore({ name, consistency: "strong" })`, with a test hook to inject a fake store |
| `test/fake-blobs.mjs` | — | in-memory store with the documented `onlyIfNew` / `onlyIfMatch` → `{ modified, etag }` semantics, and a fake `Context` |

Why this is "what good looks like":
- Custom headers from `_headers` are not applied to function responses ([headers docs](https://docs.netlify.com/manage/routing/headers/)), so every response carries `cache-control: no-store`, `nosniff`, a locked-down CSP and a JSON content type.
- Background functions are retried after 1 and 2 minutes on error ([background functions](https://docs.netlify.com/build/functions/background-functions/)). The job is claimed with `onlyIfMatch(etag)`, so a retry or a duplicate request does nothing.
- Blobs defaults to eventual consistency (up to 60 s to propagate updates); job state uses `strong` ([Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)).
- No real secrets: the test builds a throwaway scrypt hash at runtime and uses `test-session-secret-EXAMPLE`. Nothing calls Netlify, Claude or GitHub.
- Respects ADR-0001: these functions serve only the Console (login, jobs). No weather proxy.

Not shown (on purpose, to stay small): the sync `POST /api/jobs` function that checks the session + CSRF, creates the job with `onlyIfNew`, and then calls `/api/jobs/run`; `requireSession` in `job-status`.

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
ok 2 - login: wrong password -> 401 with security headers, no cookie
ok 3 - login: bad JSON -> 400, GET -> 405
ok 4 - login: right password -> 200 and HttpOnly/Secure/Strict cookie; body leaks no secret
ok 5 - background job: runs once, writes status to Blobs, status endpoint reads it
ok 6 - background job: a Netlify retry (same body twice) is a no-op
ok 7 - background job: wrong token never starts the job
ok 8 - status: invalid id -> 400, unknown id -> 404
# tests 8
# pass 8
# fail 0
```
Mutation check (proves test 6 has teeth): replacing `{ onlyIfMatch: cur.etag }` with `{}` in `job-run.mjs` makes test 6 fail with `only one invocation may claim the job`.

Not verified here: behaviour on a real Netlify deploy (the `202`, the retry timing, real `rateLimit` enforcement). Those are platform features; check the deploy log's post-processing section for the rate-limit rule after the first deploy.
