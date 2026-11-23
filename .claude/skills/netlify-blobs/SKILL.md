---
name: netlify-blobs
description: Using Netlify Blobs as Beach Day's only server-side state — stores for proposals, jobs, rate limits and the audit log, strong consistency, compare-and-swap with etags, limits and local dev. Use when reading or writing server-side state in functions.
---
# Netlify Blobs (details: docs/03 §7)

```ts
import { getStore } from "@netlify/blobs";
const proposals = getStore({ name: "proposals", consistency: "strong" });
await proposals.setJSON(id, record, { onlyIfNew: true });              // create once
const got = await proposals.getWithMetadata(id, { type: "json" });     // { data, etag, metadata }
const res = await proposals.setJSON(id, next, { onlyIfMatch: got.etag }); // CAS; res.modified false → conflict
```

## Stores
| Store | Key | Value |
|---|---|---|
| `proposals` | `p_<ulid>` | `{agent, summary, files:[{path, content, baseBlobSha}], baseCommitSha, contentHash, status, createdAt, decidedAt, commitSha?, error?}` |
| `jobs` | `j_<ulid>` | `{status: queued/running/done/failed/paused, events:[...], messages (conversation state), proposalId?, startedAt, updatedAt}` |
| `ratelimit` | `<action>/<user id>/<yyyy-mm-dd>`, and `site:approvals` | per-user `{count}`; the site-wide Approve record is `{ times: ["<ISO-8601 UTC>", ...] }`, pruned to the last 31 days on every write (ADR-0008). All updated with CAS. |
| `audit` | `<iso-timestamp>_<id>` | `{action, actor (Supabase user id), proposalId, commitSha, requestId}` |

IDs are `p_<ULID>` and `j_<ULID>` (ULID = 26 chars `[0-9A-Z]`). Validate with `^[pj]_[0-9A-Z]{26}$` before any lookup.

Proposal status: `pending` → `committing` → `committed` | `failed` | `stale`, or `pending` → `rejected`. Transitions always use CAS, and only the request that wins `pending` → `committing` calls GitHub.

**Approve cap, site-wide (ADR-0008): at most 14 committed approvals in any rolling 31 days, and at most 5 per calendar day in America/New_York.** One record: store `ratelimit`, key `site:approvals`, value `{ "times": ["<ISO-8601 UTC>", ...] }`. Keep both windows in that one record (`knowledge/netlify-engineer/examples/03-cas-rate-limit-counter/`, 13 tests).
- Constants live in one place: `APPROVE_CAP = { per31Days: 14, perDay: 5 }`.
- **Check** (read-only) inside the single approve lock, after auth, role and step-up and before any GitHub call. **Record** (CAS append, `onlyIfMatch`, or `onlyIfNew` the first time) only when the proposal reaches `committed`. `failed`, `stale` and `rejected` never count.
- **Prune** the array to the last 31 days on every write, so there is no scheduler.
- A time is live while `t > now - 31 days`. The day is the New York calendar day (23 to 25 hours around DST), not the UTC day.
- Over the cap: `429` with `{ error: { code: "approve_cap", retryAt } }`. The proposal stays `pending`.
- It is a rolling window, not the calendar month and not Netlify's billing cycle (reset date unknown), so any cycle of 31 days or less holds at most 14 x 15 = 210 credits of approvals.

## Rules
- **Use `getStore`,** which is site-wide and persists across deploys. Don't use `getDeployStore` for app state.
- **Use `consistency: "strong"`** for proposals, jobs and counters. The default, eventual consistency, can lag up to 60 s.
- **Writes are last-write-wins.** Use `onlyIfMatch` with an etag, or `onlyIfNew`, wherever a race matters: approve, counters, job steps.
- **Limits:**
  - key ≤ 600 bytes
  - store name ≤ 64 bytes, with no `/` or `:`
  - metadata ≤ 2 KB
  - object ≤ 5 GB
- **Never store** secrets, tokens (access or refresh), or raw request headers. Store only the Supabase user id.
- **Retention:** delete jobs older than 7 days and per-user counter keys older than their day, and keep the audit log. `site:approvals` prunes itself. A scheduled function can prune once a day; it has a 30 s limit.

## Local dev
`netlify dev` uses a sandboxed local store that cannot read production data. In unit tests, inject a fake store that implements the same methods.

Plan availability of Blobs on the Free plan, and any quota, are **UNVERIFIED** (the Netlify docs were unreachable on 2026-11-23). The first deploy that writes a blob is the test; if Free refuses it, tell Dr. Lee, because paid features need his decision.
