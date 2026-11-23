# 0008 — Site-wide Approve cap: 14 per rolling month, 5 per day
- Status: Accepted
- Date: 2026-11-23
- Deciders: Dr. Lee (+ software-architect drafted; netlify-engineer, security-engineer to review)

## Context
- ADR-0003: every Approve is one commit to `main`, and so one production deploy.
- ADR-0004: Netlify Free has 300 credits a month as a hard cap, the site pauses at 0, and a production deploy costs 15 credits.
- Without a cap, Approve alone could exhaust the month: 20 approvals use the whole budget, and the public beach app would go offline with it.
- The old design capped approvals at 10 per day **per session** (docs/04 §9). With per-user accounts (ADR-0006), a per-user cap no longer bounds the total.
- Netlify's credit cycle is a billing period, not a calendar month. A calendar-month counter could allow 14 approvals at the end of one month and 14 more at the start of the next, all inside one billing cycle: 420 credits, more than the 300 cap.
- Dr. Lee decided on 2026-11-23: 14 approvals a month and 5 a day, site-wide.

## Decision
We will enforce the cap in the approve function, site-wide and across all users:

1. **Limits.**
   - At most **14** committed approvals in any **rolling 31-day window**. Any billing cycle (31 days or less) can then hold at most 14 × 15 = 210 credits of approvals.
   - At most **5** committed approvals per calendar day in **America/New_York**, the day Dr. Lee sees.
   - The values live in one constant, `APPROVE_CAP = { per31Days: 14, perDay: 5 }`, in `netlify/functions/lib/limits.mts`.
2. **Storage.** Use one Blobs record in the `ratelimit` store, key `site:approvals`, value `{ "times": ["<ISO-8601 UTC>", …] }`.
   - Prune it to the last 31 days on every write.
   - Write with compare-and-swap (`onlyIfMatch` etag), using `consistency: "strong"`.
3. **Order of checks.**
   - The cap is checked after auth, role and step-up, and **inside the single approve lock** (docs/04 §7), before any GitHub call. Only one approval can be in flight, so check-then-commit can't race.
   - The timestamp is appended only when the proposal reaches `committed`.
   - `failed`, `stale` and `rejected` don't count.
4. **Every committed approval counts,** including docs-only ones that a Netlify `ignore` rule might later skip. This keeps the cap simple and conservative.
5. **Over the cap,** the function returns `429` with `{ "error": { "code": "approve_cap", "message": "…", "retryAt": "<ISO>" } }`. The proposal stays `pending`, so it can be approved later.
6. **Human pushes are not counted** by this cap. They share the remaining 90 credits (about 6 deploys). netlify-engineer tracks total usage and alerts at about 70% (ADR-0004).

## Consequences
- **Good:** Approve can never use more than 210 of 300 credits in any billing cycle. That leaves room for human deploys and keeps the site from pausing.
- **Good:** one record, one compare-and-swap write, no scheduler. It can be checked in a unit test with a fake store and a fixed clock.
- **Bad:** the cap is shared, so one user can use up everyone's approvals. That is acceptable while only `super_admin` users can Approve.
- **Bad:** a rolling window is harder to explain than "per month". The UI must show "N of 14 used in the last 31 days, next slot frees on <date>". Wren owns that copy.
- **Bad:** human pushes are outside the cap, so the credit total can still run out if people push often. The cap protects against agents, not against us.
- **Follow-up:**
  - security-engineer folds this into docs/04 §9;
  - netlify-engineer adds the key to the `netlify-blobs` skill;
  - qa-engineer adds boundary tests: 5th and 6th approvals on one day, 14th and 15th in 31 days, and the day boundary at local midnight across a DST change.

## Revisit when
- The Netlify plan changes (ADR-0004), or the price of a production deploy changes.
- Docs-only commits are reliably skipped by an `ignore` rule and Dr. Lee wants those approvals excluded.
- More than one person holds `super_admin`.
