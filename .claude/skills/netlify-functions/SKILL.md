---
name: netlify-functions
description: Writing Netlify Functions for Beach Day — v2 Request/Response syntax, config.path routing, rate limits, streaming, background functions, the 60-second and 15-minute limits, cookies, headers and local testing. Use when writing or reviewing anything in netlify/functions/.
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
- **Context:** `context.ip`, `context.geo`, `context.cookies.get/set/delete`, `context.requestId`, `context.params` (from `path` patterns such as `/api/proposals/:id/approve`), `context.deploy.context`.
- **Env:** read with `process.env.X` or `Netlify.env.get("X")`.
- **Rate limits:** Free allows **2 rate-limit rules per project**, used for `/api/login` and `/api/chat`. Other limits use Blobs counters. `windowSize` can be at most 180 s. Over the limit, the caller gets a 429.

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

## Long work pattern
- **`/api/chat` streams.** It tracks elapsed time, and at about 45 s it saves state to Blobs and emits `{type: "handoff", jobId}`.
- **`/api/jobs`** is a sync wrapper. It checks auth and limits, creates the job record, then triggers the background worker with a signed single-use job token.
- **Set the SDK timeout under the limit:** about 50 s for chat, about 840 s for background.

## Rules
- **Every `/api/*` handler** starts with `requireSession` (see `agent-console-security`).
- **Set your own headers.** `_headers` does not apply to functions. Always send `cache-control: no-store`.
- **Never echo env vars, tokens or stack traces.** Log `requestId`, the route and the outcome only.
- **Handle `OPTIONS` and wrong methods** with a 405.
- **Validate the body size and shape** before doing any work.

## Testing
- Import the default export and call `await handler(new Request(url, init), fakeContext)`.
- Use MSW to fake `api.anthropic.com` and `api.github.com`.
- For manual testing, run `netlify dev` or `netlify functions:serve`.
