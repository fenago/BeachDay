# Example 04 — Approve-cap boundary table (ADR-0008), with mutants

## What it demonstrates
`cap-boundaries.test.mjs` is the QA boundary table for the site-wide Approve cap: **at most 14 committed approvals in any rolling 31 days and at most 5 per America/New_York day**. It tests netlify-engineer's reference module (`../../../netlify-engineer/examples/03-cas-rate-limit-counter/ratelimit.mjs`, `evaluate()` and `nextLocalMidnight()`). In the real repo change the one import line to `netlify/functions/lib/limits.mts`. The reference module's own tests are not repeated; this file only adds the boundaries QA owns (ADR-0008 "Follow-up").

Boundaries covered:
- **5th allowed, 6th refused** (`reason: "day"`), and **14th allowed, 15th refused** (`reason: "month"`, with the 13 earlier approvals on distinct days so the day cap cannot be what refuses).
- **New York midnight to the millisecond** in standard time, and "the New York day, not the UTC day".
- **Both DST changes:** spring forward **2027-03-14** (23-hour day, midnight at 04:00Z) and fall back **2026-11-01** (25-hour day, midnight at 05:00Z, and the repeated 01:30 counts as one day). Today is 2026-11-23, so these are the next two.
- **The window is 744 h, not 31 calendar days:** a record exactly 31 x 24 h old has expired, one millisecond younger still counts, and the case sits in the hour where the March change makes the two definitions differ.
- `retryAt` for each cap, and for both together.
- **Mutation check:** the same case table runs against four plausible bugs (UTC day, inclusive window edge, calendar-day window, a cap of 6). Each must be caught by at least one case, otherwise the table is not discriminating. My first "calendar-days" mutant was a no-op (`31 * 86400000` is the same number) and the test said so: **NOTHING caught it**. It was rewritten to use the New York wall clock.

## Run
```bash
cd knowledge/qa-engineer/examples/04-approve-cap-boundaries
node --test cap-boundaries.test.mjs          # Node built-ins only, no install
TZ=Pacific/Auckland node --test cap-boundaries.test.mjs   # the runner's timezone must not matter
```

## Verified
Run 2026-11-23, Node v22.23.5:
```
# tests 23
# pass 23
# fail 0
#   mutant utc-day caught by: NY 23:59:59.999 still same day | fall-back day is 25 h
#   mutant inclusive-edge caught by: edge record exactly 31 d old has expired
#   mutant calendar-days caught by: 744 h not 31 calendar days across DST
#   mutant off-by-one-day caught by: 6th on a day refused | NY 23:59:59.999 still same day | evening EST approvals are still today at 22:00 | fall-back day is 25 h
```
`TZ=Pacific/Auckland` and `TZ=UTC`: 23 of 23 pass in each.

Not covered here (Blobs-level, see the netlify-engineer example): CAS retries and the concurrent-writer case. The check-then-record ordering around the approve lock (docs/04 §7) needs the real handler.
