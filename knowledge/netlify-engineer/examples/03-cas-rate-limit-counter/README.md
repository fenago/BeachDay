# Example 03 — compare-and-swap rate-limit counter in Blobs

## What it demonstrates
`ratelimit.mjs` counts per-session daily limits (chat turns, jobs, approvals) in a Netlify Blobs store with compare-and-swap:
- create the counter with `setJSON(key, v, { onlyIfNew: true })`;
- update it with `setJSON(key, v, { onlyIfMatch: etag })` using the etag from `getWithMetadata`;
- if the write returns `modified: false`, someone else won the race, so re-read and retry;
- fail closed after `maxAttempts`;
- never increment past the limit;
- one key per day (`chat/<session>/<YYYY-MM-DD>`), plus `pruneOlderThan()` for a daily scheduled cleanup using `list({ prefix })` and `delete(key)`.

Why it exists: on the Free plan, Netlify's code-based `rateLimit` allows **2 rules per project**, and those go to `/api/login` and `/api/chat` (ADR-0004, [rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)). Other limits are app counters. Blobs is last-write-wins unless writes are conditional ([Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)). The test shows what goes wrong without CAS: 50 parallel requests against a limit of 20 all get through.

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
# tests 5
# pass 5
# fail 0
```
The fake store follows the documented `{ modified, etag }` contract. Real Blobs latency and contention were not measured. With 50 truly simultaneous callers, the default `maxAttempts: 20` could fail closed for some of them, which is acceptable for a personal Console.
