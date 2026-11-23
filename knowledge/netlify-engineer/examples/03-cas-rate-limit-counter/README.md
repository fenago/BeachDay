# Example 03 — compare-and-swap rate-limit counter in Blobs

## What it demonstrates
`ratelimit.mjs` counts per-user daily limits (chat turns, jobs) and the **site-wide Approve cap (5 per UTC day and 14 per UTC month)** in a Netlify Blobs store with compare-and-swap:
- create the counter with `setJSON(key, v, { onlyIfNew: true })`;
- update it with `setJSON(key, v, { onlyIfMatch: etag })` using the etag from `getWithMetadata`;
- if the write returns `modified: false`, someone else won the race, so re-read and retry;
- fail closed after `maxAttempts`;
- never increment past the limit;
- `hitCapped()` keeps both Approve windows in **one record** (`approve/site/<YYYY-MM>` = `{count, days:{...}}`), so one CAS decides both limits and a refused request never burns a slot in the other window;
- one key per day (`chat/<user-id>/<YYYY-MM-DD>`), plus `pruneOlderThan()` for a daily scheduled cleanup using `list({ prefix })` and `delete(key)`.

Why it exists: on the Free plan, Netlify's code-based `rateLimit` allows **2 rules per project**, and those go to `/api/chat` and `/api/jobs` (ADR-0004, [rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)). Other limits are app counters. Blobs is last-write-wins unless writes are conditional ([Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)). The test shows what goes wrong without CAS: 50 parallel requests against a limit of 20 all get through.

Use a store opened with `consistency: "strong"` in real code. With eventual consistency a read can be up to 60 s stale.

## How to run
```bash
node --test ratelimit.test.mjs     # no dependencies; the fake store is inside the test
```

## Verified
Ran on 2026-11-23, Node v22.23.5, in this folder:
```
$ node --test ratelimit.test.mjs
ok 1 - key shape
ok 2 - sequential: allows exactly `limit` hits, then blocks without incrementing
#   CAS:   allowed=20 stored=20
ok 3 - concurrent: 50 parallel hits against limit 20 admit exactly 20
#   naive: allowed=50 stored=1
ok 4 - concurrent: the naive read-modify-write over-admits (why CAS is needed)
ok 5 - pruneOlderThan deletes only old day keys
ok 6 - approve cap: key is per UTC month
ok 7 - approve cap: the 6th approval in a day is refused (reason: day), the next day allows more
ok 8 - approve cap: 14 per month across days, the 15th is refused (reason: month)
ok 9 - approve cap: 30 parallel approvals admit exactly 5 (one CAS decides both windows)
# tests 9
# pass 9
# fail 0
```
The fake store follows the documented `{ modified, etag }` contract. Real Blobs latency and contention were not measured. With 50 truly simultaneous callers, the default `maxAttempts: 20` could fail closed for some of them, which is acceptable for a personal Console.

Open points for security-engineer and agent-console-engineer: whether a **failed** commit gives the slot back (this code never refunds), and that "month" here is the UTC calendar month, **not** the Netlify billing cycle, whose reset date is not known.
