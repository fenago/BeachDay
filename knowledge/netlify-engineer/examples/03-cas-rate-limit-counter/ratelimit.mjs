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
 * Site-wide Approve cap (ADR-0008): at most 14 committed approvals in any
 * rolling 31-day window AND at most 5 per calendar day in America/New_York.
 *
 * ONE record, key "site:approvals" in the "ratelimit" store (strong
 * consistency), value { times: ["<ISO-8601 UTC>", ...] }, pruned to the last
 * 31 days on every write. Two functions, because ADR-0008 orders the work:
 *   1. checkApproveCap()  read-only, inside the single approve lock, BEFORE any GitHub call;
 *   2. recordApproval()   CAS append, only when the proposal reaches `committed`
 *                         (failed, stale and rejected never count).
 * "Month" is a rolling 31 days, not the calendar month and not Netlify's
 * billing cycle (whose reset date we do not know): any billing cycle of 31
 * days or less then holds at most 14 x 15 = 210 credits of approvals.
 */
export const APPROVE_CAP = { per31Days: 14, perDay: 5 };
export const APPROVE_KEY = "site:approvals";
export const WINDOW_MS = 31 * 86400_000;
export const CAP_TZ = "America/New_York";

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: CAP_TZ, year: "numeric", month: "2-digit", day: "2-digit" });
export const localDay = (d) => dayFmt.format(d); // "2026-11-23" in New York

// First instant after `now` whose New York calendar day differs (DST-safe: days are 23-25 h).
export function nextLocalMidnight(now) {
  const today = localDay(now);
  let lo = now.getTime(), hi = lo + 26 * 3600_000; // a day is never longer than 25 h
  while (hi - lo > 1) { // to the millisecond
    const mid = Math.floor((lo + hi) / 2);
    if (localDay(new Date(mid)) === today) lo = mid; else hi = mid;
  }
  return new Date(hi);
}

// Pure decision. A time t is inside the window while t > now - 31 days.
export function evaluate(times, now, caps = APPROVE_CAP) {
  const live = times.map((t) => new Date(t)).filter((t) => t.getTime() > now.getTime() - WINDOW_MS).sort((a, b) => a - b);
  const today = localDay(now);
  const todayN = live.filter((t) => localDay(t) === today).length;
  const retry = [];
  if (live.length >= caps.per31Days) retry.push(new Date(live[live.length - caps.per31Days].getTime() + WINDOW_MS));
  if (todayN >= caps.perDay) retry.push(nextLocalMidnight(now));
  if (retry.length === 0) return { allowed: true, used31: live.length, usedToday: todayN };
  const retryAt = new Date(Math.max(...retry.map((d) => d.getTime())));
  const reason = live.length >= caps.per31Days ? "month" : "day"; // "month" wins when both apply
  return { allowed: false, reason, used31: live.length, usedToday: todayN, retryAt: retryAt.toISOString() };
}

// Fail closed: a record that exists but is not { times: [ISO-8601 UTC string, ...] } is an error
// (the handler answers 503 `unavailable`), never an empty list (which would reset the cap).
export function assertApprovalsShape(data) {
  const t = data?.times;
  const ok = Array.isArray(t) && t.every((x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}T/.test(x) && Number.isFinite(Date.parse(x)));
  if (!ok) throw new Error("site:approvals unreadable");
}

export async function checkApproveCap(store, now = new Date(), caps = APPROVE_CAP) {
  const cur = await store.getWithMetadata(APPROVE_KEY, { type: "json" });
  if (cur !== null) assertApprovalsShape(cur.data);
  return evaluate(cur?.data?.times ?? [], now, caps);
}

// Append one committed approval with compare-and-swap; prune to the window. Fails closed (throws) under contention.
export async function recordApproval(store, now = new Date(), { maxAttempts = 20 } = {}) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const cur = await store.getWithMetadata(APPROVE_KEY, { type: "json" });
    if (cur !== null) assertApprovalsShape(cur.data);
    const kept = (cur?.data?.times ?? []).filter((t) => new Date(t).getTime() > now.getTime() - WINDOW_MS);
    const next = { times: [...kept, now.toISOString()] };
    const r = cur === null
      ? await store.setJSON(APPROVE_KEY, next, { onlyIfNew: true })
      : await store.setJSON(APPROVE_KEY, next, { onlyIfMatch: cur.etag });
    if (r.modified) return { recorded: true, count: next.times.length };
  }
  throw new Error("recordApproval: contended"); // caller marks the audit log; the commit already happened
}

/**
 * Site-wide compute budget (Vera, docs/04 §9): 180 function-minutes of
 * /api/chat + /api/jobs-run wall time per rolling 31 days, about 30 credits at
 * 1024 MB (10 credits per GB-hour; billed duration UNVERIFIED). THE NUMBER IS
 * PENDING DR. LEE: it lives in one constant. Over the budget -> 429 budget_exhausted.
 *
 * ONE record, key "site:compute" in the "ratelimit" store (strong), value
 * { days: { "<New York YYYY-MM-DD>": <milliseconds>, ... } }. Day buckets
 * keep the record small (at most 32 keys, however many turns run), unlike a
 * list with one entry per turn (200 chat turns a day would be 6,000+ entries).
 * Buckets whose day is before localDay(now - 31 days) are pruned on every
 * write, so the window is "31 days, rounded outwards to whole New York days":
 * slightly conservative, never lenient.
 *   checkComputeBudget()  read-only, BEFORE a chat turn (needs >= 60 s left)
 *                         or a job (needs >= 5 min left); no lock needed.
 *   recordCompute()       CAS add of the elapsed milliseconds when the turn or
 *                         job ends, and at each job progress write (pass only
 *                         the NEW milliseconds each time).
 */
export const COMPUTE_BUDGET = { windowMinutes: 180, chatNeedMs: 60_000, jobNeedMs: 5 * 60_000 }; // number pending Dr. Lee
export const COMPUTE_KEY = "site:compute";

const liveDays = (days, now) => {
  const first = localDay(new Date(now.getTime() - WINDOW_MS));
  return Object.entries(days ?? {}).filter(([d]) => d >= first).sort(([a], [b]) => (a < b ? -1 : 1));
};

// Fail closed: a record that exists but is not { days: { "YYYY-MM-DD": number } } is an error
// (the handler answers 503 `unavailable`), never an empty budget.
export function assertComputeShape(data) {
  const days = data?.days;
  const ok = days && typeof days === "object" && !Array.isArray(days) &&
    Object.entries(days).every(([d, ms]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && Number.isFinite(ms) && ms >= 0);
  if (!ok) throw new Error("site:compute unreadable");
}

export function evaluateCompute(days, now, needMs, budget = COMPUTE_BUDGET) {
  const live = liveDays(days, now);
  const limitMs = budget.windowMinutes * 60_000;
  const usedMs = live.reduce((n, [, ms]) => n + ms, 0);
  const remainingMs = Math.max(0, limitMs - usedMs);
  if (remainingMs >= needMs) return { allowed: true, usedMs, remainingMs };
  // Earliest moment enough oldest buckets have expired (conservative: a bucket leaves 32 days after its day starts).
  let freed = 0, retryAt = null;
  for (const [d, ms] of live) {
    freed += ms;
    if (remainingMs + freed >= needMs) { retryAt = new Date(Date.parse(`${d}T00:00:00Z`) + 32 * 86400_000).toISOString(); break; }
  }
  return { allowed: false, usedMs, remainingMs, retryAt };
}

export async function checkComputeBudget(store, needMs, now = new Date(), budget = COMPUTE_BUDGET) {
  const cur = await store.getWithMetadata(COMPUTE_KEY, { type: "json" }); // a Blobs error propagates: the caller answers 503
  if (cur !== null) assertComputeShape(cur.data); // unreadable record: throw, never "allowed"
  return evaluateCompute(cur?.data?.days, now, needMs, budget);
}

export async function recordCompute(store, ms, now = new Date(), { maxAttempts = 20 } = {}) {
  if (!Number.isFinite(ms) || ms <= 0) return { recorded: false };
  const today = localDay(now);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const cur = await store.getWithMetadata(COMPUTE_KEY, { type: "json" });
    if (cur !== null) assertComputeShape(cur.data);
    const days = Object.fromEntries(liveDays(cur?.data?.days, now));
    days[today] = Math.round((days[today] ?? 0) + ms);
    const r = cur === null
      ? await store.setJSON(COMPUTE_KEY, { days }, { onlyIfNew: true })
      : await store.setJSON(COMPUTE_KEY, { days }, { onlyIfMatch: cur.etag });
    if (r.modified) return { recorded: true, totalMs: Object.values(days).reduce((n, v) => n + v, 0) };
  }
  throw new Error("recordCompute: contended"); // the work already ran; log it, never block the response on it
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
