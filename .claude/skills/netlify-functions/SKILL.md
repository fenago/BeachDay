---
name: netlify-functions
description: Writing Netlify Functions for Beach Day — v2 Request/Response syntax, config.path routing, rate limits, streaming, background functions, the 60-second and 15-minute limits, the bearer-token and role check, headers and local testing. Use when writing or reviewing anything in netlify/functions/.
---
# Netlify Functions (details: docs/03 §4–5, docs/04 §8)

## Shape
```ts
// netlify/functions/chat.mts
import type { Config, Context } from "@netlify/functions";
export default async (req: Request, context: Context) => {
  return new Response(body, { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
};
export const config: Config = {
  path: "/api/chat", method: "POST",
  rateLimit: { windowLimit: 20, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
```
- **File types:** `.mts` is ESM. TypeScript works without a separate build step. The runtime is Node 24 unless the build's Node version is a valid Lambda runtime.
- **Context:** `context.ip`, `context.geo`, `context.requestId`, `context.params` (from `path` patterns such as `/api/proposals/:id/approve`), `context.deploy.context`. We do not use cookies: sign-in is Supabase Auth and calls carry a bearer token.
- **Env:** read with `process.env.X` or `Netlify.env.get("X")`.
- **Rate limits:** Free allows **2 rate-limit rules per project**, used for `/api/chat` (20 per 60 s) and `/api/jobs` (10 per 60 s), both `aggregateBy: ["ip", "domain"]` (decided by security-engineer, docs/04 §9). Approve needs no Netlify rule. There is no `/api/login`. Other limits use Blobs counters, per Supabase user id (200 chat turns and 20 jobs per New York day), and two site-wide records: the Approve cap (ADR-0008: 14 in a rolling 31 days and 5 a day in America/New_York, `site:approvals`) and the compute budget (`site:compute`, 180 function-minutes per rolling 31 days, number pending Dr. Lee; over it, 429 `budget_exhausted`). `windowSize` can be at most 180 s. Over the limit, the caller gets a 429. Rules cannot go in `netlify.toml`, and a bad rule does not fail the deploy, so check the deploy log.

## Limits (fixed on every plan)
| Kind | Limit |
|---|---|
| Sync | **60 s**, 6 MB buffered body |
| Streaming | **60 s**, 20 MB. Return a `ReadableStream` body with `content-type: text/event-stream`. |
| Background | **15 min**, 256 KB request. Set `config.background: true` (or use a `-background` filename). |
| Scheduled | 30 s |
| Memory | 1024 MB |

How background functions behave:
- The client gets **202 immediately**, and the return value is discarded.
- A failed run is retried after 1 and 2 minutes, so the function **must be idempotent**.
- Write progress to Blobs and have the client poll for it.

## Routes
`GET /api/agents`, `POST /api/chat`, `POST /api/jobs` (sync), `POST /api/jobs-run` (background, a sibling path so it never overlaps `GET /api/jobs/:id`), `GET /api/jobs/:id`, `GET /api/proposals/:id`, `POST /api/proposals/:id/approve`, `POST /api/proposals/:id/reject`. The approve route is `/api/proposals/:id/approve`. IDs are `p_<ULID>` (proposals) and `j_<ULID>` (jobs); validate with `^[pj]_[0-9A-Z]{26}$`.

## Long work pattern
- **`/api/chat` streams.** It tracks elapsed time, and when it cannot finish inside the SDK timeout it saves state to Blobs and emits `{type: "handoff", jobId}`.
- **`/api/jobs`** is a sync wrapper. It runs the auth check and limits, creates the job record with `onlyIfNew`, stores only the **hash** of a one-time job token, then starts the background worker `/api/jobs-run`.
- **The worker never trusts its caller**, because it always answers 202 and cannot say 401. **Its first line runs the same guard** (bearer token forwarded by `/api/jobs`, role `super_admin`, fail closed); on any refusal it returns silently with no Blobs read or write. It then checks that the user owns the job, claims the job with compare-and-swap (so retries do nothing) and exits silently on a bad one-time token. Shape and tests: example 01, `job-run.mjs`, test 10.
- **Set the SDK timeout under the limit: 50 s for chat** (a 60 s limit), about 840 s for background. A job stops at about 14 min and is marked `paused`. **Never commit from a job.**
- **Pass the endpoint explicitly:** create the Anthropic client with `baseURL: "https://api.anthropic.com"` and `apiKey: process.env.ANTHROPIC_API_KEY`, so an AI Gateway variable cannot reroute the calls.

## Rules
- **The auth check is the first line of every `/api/*` handler**, before the body is read and before any limit, Blobs, GitHub or Claude call. Pattern:
  1. Read `Authorization: Bearer <access token>`. Missing or malformed: **401**.
  2. Verify the token with Supabase (how is supabase-auth-engineer's call). Invalid, expired or wrong project: **401**.
  3. Look up the role. Not `super_admin`: **403**.
  4. Verifier or its config unavailable: **503**. **Fail closed**, and never echo the error.
  5. **Production-context check** (`chat`, `jobs-run`, `approve`: the functions that read a secret): if `context.deploy.context !== "production"`, answer **503 `unavailable`** before reading the secret. On Free, per-context secrets are UNVERIFIED, so this is one of four required layers (docs/03 §6).
  6. Only then do the work.
  Use only the project URL and the publishable key. The Supabase secret / `service_role` key is used nowhere. A runnable shape: `knowledge/netlify-engineer/examples/01-functions-jobs-blobs/`.
- **Set your own headers.** `_headers` does not apply to functions. Always send `cache-control: no-store`, a `content-type` and `x-content-type-options: nosniff`, including on 401, 403 and 503.
- **Never echo env vars, tokens or stack traces.** Log `requestId`, the route and the outcome only.
- **Handle `OPTIONS` and wrong methods** with a 405.
- **Validate the body size and shape** before doing any work.

## Testing
- Import the default export and call `await handler(new Request(url, init), fakeContext)`.
- **Test the guard on every function:** no token, a bad token, a non-admin role and a down verifier must each return 401, 401, 403 and 503, and must touch no store.
- Use MSW to fake `api.anthropic.com`, `api.github.com` and the Supabase host.
- For manual testing, run `netlify dev` or `netlify functions:serve`.
