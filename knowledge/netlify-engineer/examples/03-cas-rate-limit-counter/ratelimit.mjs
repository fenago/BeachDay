// App-level daily limits (chat turns, jobs, approvals) stored in Netlify
// Blobs. Netlify's own config.rateLimit is used up by /api/login and
// /api/chat on the Free plan (2 rules), so everything else counts here.
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
