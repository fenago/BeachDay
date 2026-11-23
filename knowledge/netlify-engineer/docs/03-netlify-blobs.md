# Netlify Blobs
Source: https://docs.netlify.com/build/data-and-storage/netlify-blobs/ (plus the `@netlify/blobs@11.1.10` type definitions, read locally from npm)
Retrieved: 2026-11-23

## Opening a store
```js
import { getStore, getDeployStore } from "@netlify/blobs";
const jobs = getStore({ name: "jobs", consistency: "strong" }); // site-wide, survives deploys
const tmp  = getDeployStore("build-cache");                      // tied to one deploy
```
- `getStore(name, { region, siteID, token })`.
  - `siteID` and `token` are set **automatically** inside Functions, Edge Functions and Build Plugins.
  - With `getStore`, `region` is **not** taken from the functions region. If you omit it, the store uses the default region, `us-east-2`.
  - [Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- `getDeployStore(name, { deployID, region, siteID, token })` is scoped to a deploy. Deleting a deploy deletes only deploy-specific stores. For other stores, write your own expiry logic. [Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- The installed types also accept the object form `getStore({ name, consistency, ... })`. (Read from `main.d.ts`.)

## Consistency
- **Default: eventual.** Data is stored in one region and cached at the edge. New blobs are available globally right away, but "Updates and deletions are guaranteed to be propagated to all edge locations within 60 seconds." [Blobs § Consistency](https://docs.netlify.com/build/data-and-storage/netlify-blobs/#consistency)
- **Strong:** opt in for a whole store (`getStore({ name, consistency: "strong" })`) or for a single read (`store.get(key, { consistency: "strong" })`). Strong reads are slower. The Netlify CLI always uses strong consistency. [Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)

## API (exact names)
| Method | Returns | Notes |
|---|---|---|
| `set(key, value, { metadata, onlyIfMatch, onlyIfNew })` | `{ modified: boolean, etag?: string }` | `value` can be a string, `ArrayBuffer` or `Blob`. |
| `setJSON(key, value, { metadata, onlyIfMatch, onlyIfNew })` | same | The value is JSON-serialized and overwrites any existing value. |
| `get(key, { consistency, type })` | value, or `null` if missing | `type`: `arrayBuffer`, `blob`, `json`, `stream` or `text` (default). |
| `getWithMetadata(key, { consistency, etag, type })` | `{ data, etag, metadata }`, or `null` | If you pass `etag` and it is still current, `data` is `null` (a conditional read). |
| `getMetadata(key, { consistency, etag })` | `{ etag, metadata }`, or `null` | Checks existence without downloading the blob. |
| `list({ prefix, directories, paginate })` | `{ blobs: [{ key, etag }], directories: [] }` | Pages hold up to 1,000 entries. Paging is automatic unless `paginate: true`, which returns an AsyncIterator. |
| `delete(key)` | `void` | |
| `deleteAll()` | `{ deletedBlobs }` | In the type definitions. Not re-read on the docs page **[UNVERIFIED in docs]**. |

Sources: [Blobs API](https://docs.netlify.com/build/data-and-storage/netlify-blobs/#netlify-blobs-api), `@netlify/blobs/dist/main.d.ts`.

### Conditional writes (compare-and-swap)
- `onlyIfNew`: "the write will only succeed if the entry does not exist". [Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- `onlyIfMatch: etag`: "the write will only succeed if the entry exists and has an ETag matching this value". [Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- If the condition fails, the write resolves to `{ modified: false }` with no `etag`. It does not throw. The type docs add: "or if a concurrent write to the same key wins the race".
- The two options are mutually exclusive. The types use `never` to forbid combining them.
- Without conditions, the last write wins. The docs suggest building "an object-locking mechanism" to manage race conditions. [Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)

```js
const cur = await store.getWithMetadata(id, { type: "json" });          // { data, etag }
const r = await store.setJSON(id, { ...cur.data, status: "approved" }, { onlyIfMatch: cur.etag });
if (!r.modified) { /* someone else changed it: re-read, re-validate, retry or 409 */ }
```

## Limits and rules
Source for every line: [Blobs § Requirements and limitations](https://docs.netlify.com/build/data-and-storage/netlify-blobs/#requirements-and-limitations).
- **Store names:**
  - Cannot include `/` or `:`.
  - At most **64 bytes**.
- **Keys:**
  - Can't be empty.
  - Can't start with `/`.
  - At most **600 bytes**.
  - Any Unicode is allowed. Most characters are 1 byte, but `à` is 2 bytes.
- **Object size:** at most **5 GB**.
- **Metadata:** at most **2 KB**.
- **Runtime:** Blobs uses `fetch()`, so it needs Node 18 or later.
- **Go functions** can't use Blobs.
- **Local dev (`netlify dev`):** uses a **sandboxed local store**. "You cannot read production data during local development."
- **HIPAA:** Blobs is not part of HIPAA-compliant hosting.

## Plan and pricing
- The pricing page lists "Built-in database, storage, and AI" for Free, but none of the pages read here gives a Blobs storage quota or price per plan. **[UNVERIFIED]** Check https://www.netlify.com/pricing/ before relying on large blobs. Re-check attempted 2026-11-23: docs.netlify.com was **not reachable** from the sandbox (DNS failure), so Free-plan availability and any quota stay **UNVERIFIED**. The cheap test: deploy once and watch the first function that writes a blob; if it fails, escalate to Dr. Lee (no paid feature without his decision). Our volume is tiny (a few KB per proposal, per job and per counter).

## Beach Day notes
- **Stores** (docs/03 §7):
  - `proposals`: key `p_<ULID>`
  - `jobs`: key `j_<ULID>`
  - `ratelimit`: key `<action>/<user id>/<YYYY-MM-DD>`, plus the single record `site:approvals` (value `{ times: [<ISO-8601 UTC>, ...] }`, pruned to 31 days on every write) for the site-wide Approve cap of ADR-0008: 14 in a rolling 31 days, 5 per America/New_York day (example 03)
  - `audit`: key `<ISO time>_<id>`
  - All are opened with **`consistency: "strong"`**, because approval state and counters must not read data that is up to 60 s stale.
- Use `getStore`, not `getDeployStore`. Proposals and jobs must survive the deploy that an approval itself triggers.
- **Approve flow:**
  1. Read the proposal with its etag.
  2. Re-validate it.
  3. CAS `pending → committing` with `onlyIfMatch`.
  4. Only the winner calls GitHub, which prevents double commits (docs/04 §3).
  5. CAS to `committed` with the commit SHA, or to `failed` or `stale`.
  - Status set: `pending → committing → committed | failed | stale`, and `pending → rejected`.
- **Job creation:** use `setJSON(id, job, { onlyIfNew: true })`. Every later change goes through CAS (example 01).
- **Counters:** CAS loop, shown in example 03. The test proves that a naive read-modify-write lets 50 of 50 requests through a limit of 20.
- **Store names:** `proposals`, `jobs`, `ratelimit` and `audit` are all valid (no `/` or `:`, under 64 bytes). Keys may use `/` as a folder separator (supported by `list({ directories: true })`), but must not *start* with `/`.
- **Tests:** never touch a real store. Inject a fake that honours `onlyIfNew`, `onlyIfMatch` and `{ modified, etag }` (example 01, `test/fake-blobs.mjs`).
- **Expiry:** there is no automatic expiry for site stores. Prune with a daily scheduled function (doc 02).
