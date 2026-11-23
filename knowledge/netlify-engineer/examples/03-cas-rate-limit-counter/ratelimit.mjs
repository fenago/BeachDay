// App-level limits (chat turns, jobs, approvals) stored in Netlify Blobs.
// Netlify's own config.rateLimit is used up by two rules on the Free plan
// (/api/chat and /api/jobs), so everything else counts here.
//
// Blobs is last-write-wins unless you write conditionally, so a naive
// read-increment-write loses counts under concurrency. This uses
// compare-and-swap: create with onlyIfNew, update with onlyIfMatch(etag),
// and retry when another writer won the race (modified: false).

export function windowKey(subject, action, now = new Date()) {
  // One counter per subject, action and UTC day. Keys must not start with
  // "/" and must stay under 600 bytes; store names may not contain "/" or ":".
  const day = now.toISOString().slice(0, 10);
  return `${action}/${subject}/${day}`;
}

/**
 * Count one hit. Returns { allowed, count, limit }.
 * Never increments past the limit, so a blocked caller does not extend its block.
 */
export async function hit(store, key, limit, { maxAttempts = 20 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const cur = await store.getWithMetadata(key, { type: "json" });
    if (cur === null) {
      const r = await store.setJSON(key, { count: 1 }, { onlyIfNew: true });
      if (r.modified) return { allowed: true, count: 1, limit };
      continue; // someone else created it first; re-read
    }
    const count = cur.data.count;
    if (count >= limit) return { allowed: false, count, limit };
    const r = await store.setJSON(key, { count: count + 1 }, { onlyIfMatch: cur.etag });
    if (r.modified) return { allowed: true, count: count + 1, limit };
    // lost the race: loop and re-read the new value
  }
  // Fail closed: under heavy contention refuse rather than over-admit.
  return { allowed: false, count: NaN, limit, contended: true };
}

/**
 * Two windows in ONE record, for the site-wide Approve cap (14 per UTC month,
 * 5 per UTC day). One record means one compare-and-swap decides both limits
 * at once, so a request refused by the day cap never burns a month slot (and
 * the reverse). Key: approveKey(now) -> "approve/site/2026-11".
 */
export const approveKey = (now = new Date()) => `approve/site/${now.toISOString().slice(0, 7)}`;

export async function hitCapped(store, key, { dayLimit, monthLimit }, { now = new Date(), maxAttempts = 20 } = {}) {
  const day = now.toISOString().slice(0, 10);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const cur = await store.getWithMetadata(key, { type: "json" });
    const rec = cur?.data ?? { count: 0, days: {} };
    const today = rec.days[day] ?? 0;
    if (rec.count >= monthLimit) return { allowed: false, reason: "month", count: rec.count, today };
    if (today >= dayLimit) return { allowed: false, reason: "day", count: rec.count, today };
    const next = { count: rec.count + 1, days: { ...rec.days, [day]: today + 1 } };
    const r = cur === null
      ? await store.setJSON(key, next, { onlyIfNew: true })
      : await store.setJSON(key, next, { onlyIfMatch: cur.etag });
    if (r.modified) return { allowed: true, reason: null, count: next.count, today: next.days[day] };
  }
  return { allowed: false, reason: "contended", count: NaN, today: NaN }; // fail closed
}

// Pruning: keys are per day, so a daily scheduled function can delete
// keys whose date part is older than N days via store.list({ prefix }).
export async function pruneOlderThan(store, action, keepDays, now = new Date()) {
  const cutoff = new Date(now.getTime() - keepDays * 86400_000).toISOString().slice(0, 10);
  const { blobs } = await store.list({ prefix: `${action}/` });
  let deleted = 0;
  for (const { key } of blobs) {
    if (key.slice(-10) < cutoff) {
      await store.delete(key);
      deleted++;
    }
  }
  return deleted;
}
