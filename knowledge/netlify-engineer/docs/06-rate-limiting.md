# Rate limiting (code-based rules)
Source: https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/ , https://docs.netlify.com/build/functions/api/#ratelimit
Retrieved: 2026-11-23

## What it does
- When a client goes over the limit, Netlify either **blocks** the request (HTTP **`429`**) or **rewrites** it to another path. [rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)
- Rate limiting runs **after** DDoS protection, firewall traffic rules and WAF rules. Only requests that pass those are counted. [rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)
- **Enforcement timing:** requests are counted off the request path, so "it can take up to 10 seconds before Netlify starts blocking or rewriting that client's requests". A few requests over the limit can get through. [rate limiting § Enforcement timing](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/#enforcement-timing)

## Plan limits
| Feature | Free / Personal | Pro / Enterprise | Enterprise + HP Edge |
|---|---|---|---|
| Code-based rules | **2 per project** | 5 per project | 100 per project |
| Aggregation | per domain & IP | per domain & IP | per-domain, or per domain & IP |
| UI rules, advanced targeting | — | — | ✓ |
[rate limiting § Availability](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/#availability)

## Function config
```js
export const config = {
  path: "/api/chat",            // a path is REQUIRED for a rate-limit rule
  rateLimit: {
    windowLimit: 20,            // max requests per window
    windowSize: 60,             // seconds; "Maximum is 180"
    aggregateBy: ["ip", "domain"],
    // action: "rewrite", to: "/rate-limited.html"   // instead of 429
  },
};
```
- `action` is `'rate_limit'` (the default, which returns 429) or `'rewrite'`, with `to` naming the target path. [api](https://docs.netlify.com/build/functions/api/#ratelimit)
- `aggregateBy` is `'ip'`, `'domain'`, or an array of both.
  - `["ip", "domain"]` counts **each visitor** separately.
  - `["domain"]` alone is a shared limit for all visitors and is **Enterprise HP Edge only**.
  - [rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)
- **Not in `netlify.toml`:** "rate limits for functions cannot be defined in the `netlify.toml` configuration file". They also can't go in `_redirects`. [rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)
- **Redirect rules in `netlify.toml`:** these *can* be rate-limited with `[redirects.rate_limit] window_limit, window_size, aggregate_by, action, to`. That syntax is snake_case. [rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)

## Verifying a rule
- Netlify validates code-based rules during the deploy's **post-processing** stage, and valid rules appear in the deploy log.
- "a rule that does not pass validation does not fail the deploy". Some syntax errors aren't detected at all. **Always check the deploy log.**
- [rate limiting § Verify](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/#verify-that-code-based-rules-are-applied)

## Beach Day notes
- **The 2 Free-plan rules** (ADR-0004). `/api/login` no longer exists (Supabase Auth), so the second rule moved:
  - `/api/chat`: `windowLimit: 20, windowSize: 60, aggregateBy: ["ip","domain"]`. The most expensive route (a 60 s stream per call).
  - `/api/jobs`: `windowLimit: 10, windowSize: 60, aggregateBy: ["ip","domain"]`. Starts a 15-minute worker. Example 01 shows it.
  - Proposed by netlify-engineer on 2026-11-23; **security-engineer may swap one** (for example for the approve route). Only two fit.
  - A third rule would be silently over quota. How Netlify treats a third rule on Free was not documented on this page **[UNVERIFIED]**, so don't add one.
- **Everything else is counted in the app**, in Blobs, with CAS (example 03), per Supabase user id (sign-in throttling is Supabase's job, not ours):
  - 200 chat turns per day, 20 jobs per day (security-engineer's numbers, docs/04 §9)
  - **Approve, site-wide: 14 in a rolling 31 days and 5 per America/New_York day** (Dr. Lee, ADR-0008). One Blobs record, `site:approvals`; `checkApproveCap()` and `recordApproval()` in example 03. Over the cap the approve function answers `429` with `approve_cap` and a `retryAt`.
  - **Site-wide compute budget (Vera, docs/04 §9): 180 function-minutes of `/api/chat` + `/api/jobs-run` wall time per rolling 31 days**, one Blobs record `site:compute` (`checkComputeBudget()` / `recordCompute()` in example 03). **The number is pending Dr. Lee.** Over it: `429 budget_exhausted`. A chat turn needs at least 60 s left, a job at least 5 min.
  - The two Netlify rules and the per-user limits cannot bound credits on their own: this budget does.
- The platform rule is **per IP** and **eventually enforced** (up to about 10 s lag), so it is a coarse shield. The app counters are the precise limits.
- Show a friendly UI message on `429`, and test it with a mocked `429` in Playwright.
- After the first deploy with these functions, check the deploy log for both rules under post-processing. Record the result in the HANDOFF.
