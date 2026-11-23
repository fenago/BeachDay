# Background and scheduled functions
Source: https://docs.netlify.com/build/functions/background-functions/ , https://docs.netlify.com/build/functions/scheduled-functions/ , https://docs.netlify.com/build/functions/configuration/
Retrieved: 2026-11-23

## Background functions
- **Plans:** "available on Credit-based plans, including Free, Personal, and Pro" and on Enterprise. [background](https://docs.netlify.com/build/functions/background-functions/)
- **How they run:**
  - The invocation is asynchronous. The client receives an initial **`202`** success response.
  - The function keeps running until it completes or hits the **15 minute** limit.
  - [background](https://docs.netlify.com/build/functions/background-functions/)
- **Retries:** "If function invocation returns an error, a retry happens after one minute. If it fails again, another retry happens two minutes later." [background](https://docs.netlify.com/build/functions/background-functions/)
- **No streaming and no response.** Background functions "don't support response streaming because they don't return responses". The handler's return value is discarded. Send results somewhere else, such as Blobs. [background](https://docs.netlify.com/build/functions/background-functions/), [api](https://docs.netlify.com/build/functions/api/#background-mode)
- **Enable it:**
  - Preferred: `export const config = { background: true, path: "/process" }`.
  - Or in `netlify.toml`: `[functions.process] background = true`.
  - The legacy `-background` filename suffix still works, but new code should use `config.background`.
  - [background](https://docs.netlify.com/build/functions/background-functions/)
- **Payload:** the background request/response payload is limited to **256 KB**. [configuration](https://docs.netlify.com/build/functions/configuration/#default-values)

Shape:
```js
export default async (req, context) => {
  const { jobId, token } = await req.json();   // ≤ 256 KB body
  // claim job with CAS, do work, write progress + result to Blobs
};
export const config = { path: "/api/jobs-run", method: "POST", background: true };
```

### Consequences for design
1. **Idempotency.** The same request can run up to 3 times (the first run plus two retries). Claim the job with a conditional write, so a second run sees it is no longer `queued` and exits. See example 01.
2. **No auth feedback.** The caller always gets `202`, so the function can't answer `401`. The sync wrapper (`POST /api/jobs`) checks the bearer token and the role, creates the job record, and hands the worker (`POST /api/jobs-run`, ADR-0006 and docs/04 §2) a random one-time nonce, which the worker consumes with a compare-and-swap on the job record. The worker never trusts the caller, only the nonce, and silently exits on a mismatch. ADR-0006 point 5 also has the worker re-run the token and role check with the caller's forwarded bearer token **as its first line**, before it reads the job or does work; a refusal returns silently with no read or write, and the worker also requires that the user is the job's owner. Example 01 does exactly this (`job-run.mjs`, test 10). The route is `/api/jobs-run`, a sibling path: it does not collide with `GET /api/jobs/:id`, so no `excludedPath` is needed. Example 01 stores only the **hash** of the nonce, which is stricter than the ADR (a Blobs read never reveals a usable nonce); the bearer token itself is never stored.
3. **Error capture.** Throwing triggers a retry. Catch errors, record `status: "failed"` with a safe message, and return normally, unless a retry is actually wanted.

## Scheduled functions
- **Plans:** "available on all pricing plans". [scheduled](https://docs.netlify.com/build/functions/scheduled-functions/)
- **Cron:**
  - Standard cron, evaluated in **UTC**. `0 0 * * *` runs at midnight UTC.
  - Supported extensions: `@yearly`, `@monthly`, `@weekly`, `@daily` and `@hourly`. `@reboot` and `@annually` are not supported.
  - [scheduled](https://docs.netlify.com/build/functions/scheduled-functions/)
- **Declare the schedule:** `export const config = { schedule: "@daily" }`, or in `netlify.toml` with `[functions."name"] schedule = "@daily"`. [scheduled](https://docs.netlify.com/build/functions/scheduled-functions/)
- **Request body:** JSON with `next_run` (ISO-8601). Scheduled functions "don't work with payloads or `POST` request data". [scheduled](https://docs.netlify.com/build/functions/scheduled-functions/)
- **Limitations:**
  - **30 second** execution limit.
  - They run on schedule **only for published deploys**, so Deploy Previews and branch deploys never fire them.
  - They **can't be invoked by URL**.
  - No streaming.
  - Test them with **Run now** in the Functions UI or `netlify functions:invoke <name>`.
  - [scheduled](https://docs.netlify.com/build/functions/scheduled-functions/)
- `config.schedule` is mutually exclusive with `path` and `excludedPath`. [api](https://docs.netlify.com/build/functions/api/#schedule)

## Event-triggered functions
- Export `{ deploySucceeded(event) { ... } }`. Event handlers always run in the background. [api § Platform events](https://docs.netlify.com/build/functions/api/#platform-events)
- The full list of events is on https://docs.netlify.com/build/functions/trigger-on-events/ (not re-read for this note).

## Beach Day notes
- **Long agent jobs** (multi-file proposals, many tool rounds) run in a background function with a 15 min budget. Stop at about 14 min, save partial state, and mark the job "paused".
  - The Console polls `GET /api/jobs/:id` every 2–3 s (docs/04 §8).
  - **Never commit from a job.** Commits happen only in the sync approve function (ADR-0003).
- **Pruning:** an optional `@daily` scheduled function can prune old rate-limit and job keys from Blobs (example 03, `pruneOlderThan`). Keep each run under 30 s. Delete in batches, or let it continue the next day.
- **Deploy status ("Live"):** the primary signal is `/version.json`, written by the build (example 04) and served only once the atomic deploy is published, so it needs no function and no compute credits. **There is no `deploy-succeeded` function** (ADR-0006 point 8: no unauthenticated functions, and an event function would cost compute credits). The Console polls `GET /version.json` (served `no-store`, network-only in the service worker) until `commit` equals the approved `commitSha`. A build skipped by the `ignore` rule never changes `version.json`, so it never goes Live: the approve function decides "no deploy needed" from the changed paths.
- **Cost:** background, scheduled and event functions all use compute, at 10 credits per GB-hour (doc 07). At 1024 MB, a 15-minute job is 0.25 GB-hour, which is 2.5 credits.
