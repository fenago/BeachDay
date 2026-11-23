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
- **the site-wide compute budget (Vera, docs/04 §9) is a second one-record limit**: key `site:compute`, value `{ days: { "<New York YYYY-MM-DD>": <ms> } }`, **180 function-minutes per rolling 31 days (the number is pending Dr. Lee; one constant, `COMPUTE_BUDGET`)**. `checkComputeBudget(store, needMs)` is read-only and runs before a chat turn (needs 60 s left) or a job (needs 5 min left); `recordCompute(store, ms)` is a CAS add of the elapsed milliseconds when the turn or job ends and at each job progress write (pass only the new milliseconds). Day buckets keep the record to at most 32 keys however many turns run, and the window rounds outwards to whole New York days, so it is slightly conservative, never lenient. Over: `429 budget_exhausted` with `retryAt`;
- per-user limits use one key per day (`chat/<user-id>/<YYYY-MM-DD>`), plus `pruneOlderThan()` for a daily scheduled cleanup using `list({ prefix })` and `delete(key)`.

Why it exists: on the Free plan, Netlify's code-based `rateLimit` allows **2 rules per project**, and those go to `/api/chat` and `/api/jobs` (ADR-0004, [rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)). Other limits are app counters. Blobs is last-write-wins unless writes are conditional ([Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)). The test shows what goes wrong without CAS: 50 parallel requests against a limit of 20 all get through.

Use a store opened with `consistency: "strong"` in real code. With eventual consistency a read can be up to 60 s stale.

## How to run
```bash
node --test ratelimit.test.mjs     # no dependencies; the fake store is inside the test
```

## Verified
Re-ran on 2026-11-23 (wave 3), Node v22, in this folder:
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
ok 14 - approve cap: an unreadable site:approvals record or a store error fails closed (throws, so the handler answers 503), never an empty list
ok 15 - compute budget: one fixed record, 180 minutes pending Dr. Lee, chat needs 60 s and a job 5 min
ok 16 - compute budget: sequential records add up; a turn is refused when less than 60 s is left; a job when less than 5 min
ok 17 - compute budget: the window rolls (31 days, whole New York days, rounded outwards) and old buckets are pruned on write
ok 18 - compute budget: an unreadable record or a store error fails closed (throws, so the handler answers 503), never allowed
ok 19 - compute budget: 30 parallel recordCompute calls lose nothing (CAS), and the record stays small
# tests 19
# pass 19
# fail 0
```
Compute-budget mutation check: writing the day map without pruning old buckets fails test 16.

Mutation check: replacing the New York day with the UTC day fails test 7 (the 23:59 NY / 04:59Z case), because five approvals at 22:00 NY would otherwise be allowed a sixth.

The fake store follows the documented `{ modified, etag }` contract. Real Blobs latency and contention were not measured. With 50 truly simultaneous callers, the default `maxAttempts: 20` could fail closed for some of them, which is acceptable for a personal Console.

Points that are not settled here:
- **Does a failed commit give the slot back?** ADR-0008 says only committed approvals count, so nothing is recorded and nothing needs refunding. This code agrees.
- **Race between check and record.** The check is only safe because the approve function holds the single approve lock (docs/04 §7). `recordApproval()` is itself race-safe (no lost appends), but it does not re-check the cap.
- **Billing cycle.** Netlify's reset date is not known, so the rolling 31 days is the conservative stand-in (ADR-0008).
- **Pruning.** Each write prunes `site:approvals` itself. `pruneOlderThan()` is still used for the per-user daily keys (`chat/<user>/<day>`).
