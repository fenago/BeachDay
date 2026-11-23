# Example 03 — compare-and-swap rate-limit counter in Blobs

## What it demonstrates
`ratelimit.mjs` counts per-user daily limits (chat turns, jobs) and implements the **site-wide Approve cap of ADR-0008 (14 in a rolling 31 days and 5 per calendar day in America/New_York)** in a Netlify Blobs store with compare-and-swap:
- create the counter with `setJSON(key, v, { onlyIfNew: true })`;
- update it with `setJSON(key, v, { onlyIfMatch: etag })` using the etag from `getWithMetadata`;
- if the write returns `modified: false`, someone else won the race, so re-read and retry;
- fail closed after `maxAttempts`;
- never increment past the limit;
- the Approve cap is **one record**, key `site:approvals` in the `ratelimit` store, value `{ times: ["<ISO-8601 UTC>", ...] }`, pruned to the last 31 days on every write. `checkApproveCap()` is read-only and runs inside the approve lock before any GitHub call. `recordApproval()` is a CAS append that runs only when the proposal reaches `committed`, so `failed`, `stale` and `rejected` never count. A refused check returns `{ allowed: false, reason: "day" | "month", retryAt }` for the `429 approve_cap` body;
- the day is the **New York calendar day** (`Intl.DateTimeFormat` with `America/New_York`, DST-safe; a day is 23 to 25 hours). The 31-day window is rolling: a time is live while `t > now - 31 days`;
- per-user limits use one key per day (`chat/<user-id>/<YYYY-MM-DD>`), plus `pruneOlderThan()` for a daily scheduled cleanup using `list({ prefix })` and `delete(key)`.

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
ok 6 - approve cap: the key is one fixed record, constants match ADR-0008
ok 7 - approve cap: 6th approval on one New York day is refused; the NY day, not the UTC day, decides
ok 8 - approve cap: the day boundary survives DST (spring forward 2027-03-14, fall back 2026-11-01)
ok 9 - approve cap: 14 in a rolling 31 days, the 15th is refused (reason: month) with the right retryAt
ok 10 - approve cap: the window is rolling, not a calendar month, and a time exactly 31 days old has expired
ok 11 - approve cap: sequential check-then-record admits exactly 5 on one day
ok 12 - approve cap: failed, stale and rejected approvals are never recorded (record only on committed)
ok 13 - approve cap: 30 parallel recordApproval calls lose none (CAS), and old times are pruned on write
# tests 13
# pass 13
# fail 0
```
Mutation check: replacing the New York day with the UTC day fails test 7 (the 23:59 NY / 04:59Z case), because five approvals at 22:00 NY would otherwise be allowed a sixth.

The fake store follows the documented `{ modified, etag }` contract. Real Blobs latency and contention were not measured. With 50 truly simultaneous callers, the default `maxAttempts: 20` could fail closed for some of them, which is acceptable for a personal Console.

Points that are not settled here:
- **Does a failed commit give the slot back?** ADR-0008 says only committed approvals count, so nothing is recorded and nothing needs refunding. This code agrees.
- **Race between check and record.** The check is only safe because the approve function holds the single approve lock (docs/04 §7). `recordApproval()` is itself race-safe (no lost appends), but it does not re-check the cap.
- **Billing cycle.** Netlify's reset date is not known, so the rolling 31 days is the conservative stand-in (ADR-0008).
- **Pruning.** Each write prunes `site:approvals` itself. `pruneOlderThan()` is still used for the per-user daily keys (`chat/<user>/<day>`).
