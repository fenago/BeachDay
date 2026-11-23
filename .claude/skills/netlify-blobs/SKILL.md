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
| `ratelimit` | `<action>/<user id>/<yyyy-mm-dd>`, and `approve/site/<yyyy-mm>` | `{count}`; the approve record is `{count, days:{<date>:n}}`. All updated with CAS. |
| `audit` | `<iso-timestamp>_<id>` | `{action, actor (Supabase user id), proposalId, commitSha, requestId}` |

IDs are `p_<ULID>` and `j_<ULID>` (ULID = 26 chars `[0-9A-Z]`). Validate with `^[pj]_[0-9A-Z]{26}$` before any lookup.

Proposal status: `pending` → `committing` → `committed` | `failed` | `stale`, or `pending` → `rejected`. Transitions always use CAS, and only the request that wins `pending` → `committing` calls GitHub.

**Approve cap, site-wide: 14 a month and 5 a day** (Dr. Lee). Keep both windows in one record so one CAS decides both (`knowledge/netlify-engineer/examples/03-cas-rate-limit-counter/`). "Month" is the UTC calendar month, not the Netlify billing cycle.

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
- **Retention:** delete jobs older than 7 days and keep the audit log. A scheduled function can prune once a day; it has a 30 s limit.

## Local dev
`netlify dev` uses a sandboxed local store that cannot read production data. In unit tests, inject a fake store that implements the same methods.

Plan availability of Blobs on the Free plan, and any quota, are **UNVERIFIED** (the Netlify docs were unreachable on 2026-11-23). The first deploy that writes a blob is the test; if Free refuses it, tell Dr. Lee, because paid features need his decision.
