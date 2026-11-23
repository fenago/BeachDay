// App-level limits kept in Netlify Blobs (docs/03 §7, docs/04 §9). Netlify's own config.rateLimit is used
// up by two rules on the Free plan (/api/chat and /api/jobs), so everything else counts here.
//
// Blobs writes are last-write-wins unless conditional, so every update is compare-and-swap:
// create with onlyIfNew, update with onlyIfMatch(etag), and retry when another writer won (modified: false).
// Every number comes from SETTINGS (one place to change a decision).
//
// Fail closed: an unreadable record or a Blobs error THROWS. The handler answers 503 `unavailable`,
// never "allowed".
import { SETTINGS } from "./settings.mts";
import type { BlobStore } from "./blobs.mts";

const DAY_MS = 86_400_000;
export const TZ: string = SETTINGS.approveCap.timeZone;
export const WINDOW_MS = 31 * DAY_MS;

const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
// "2026-11-23": the New York calendar day of an instant.
export const localDay = (d: Date): string => dayFmt.format(d);

// First instant after `now` whose New York calendar day differs (DST-safe: a day is 23 to 25 hours).
export function nextLocalMidnight(now: Date): Date {
  const today = localDay(now);
  let lo = now.getTime();
  let hi = lo + 26 * 3_600_000;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (localDay(new Date(mid)) === today) lo = mid; else hi = mid;
  }
  return new Date(hi);
}

// ---- per-user daily counters (chat turns, jobs) ------------------------------------------------
export type DailyAction = keyof typeof SETTINGS.perUserDaily;
export interface HitResult { allowed: boolean; count: number; limit: number; contended?: boolean }

// One counter per action, Supabase user id and New York day. Keys stay under 600 bytes and never start with "/".
export function windowKey(userId: string, action: string, now: Date = new Date()): string {
  return `${action}/${userId}/${localDay(now)}`;
}

// Count one hit. Never increments past the limit, so a blocked caller does not extend its block.
export async function hit(store: BlobStore, key: string, limit: number, { maxAttempts = 20 } = {}): Promise<HitResult> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const cur = await store.getWithMetadata(key, { type: "json" });
    if (cur === null) {
      const r = await store.setJSON(key, { count: 1 }, { onlyIfNew: true });
      if (r.modified) return { allowed: true, count: 1, limit };
      continue;
    }
    const count = (cur.data as { count?: unknown })?.count;
    if (typeof count !== "number" || !Number.isFinite(count) || count < 0) throw new Error("counter unreadable");
    if (count >= limit) return { allowed: false, count, limit };
    const r = await store.setJSON(key, { count: count + 1 }, { onlyIfMatch: cur.etag });
    if (r.modified) return { allowed: true, count: count + 1, limit };
  }
  return { allowed: false, count: NaN, limit, contended: true }; // under heavy contention refuse, never over-admit
}

// The limit for each action is SETTINGS.perUserDaily (200 chat turns, 20 jobs per New York day).
export function hitUserDaily(store: BlobStore, action: DailyAction, userId: string, now: Date = new Date()): Promise<HitResult> {
  return hit(store, windowKey(userId, action, now), SETTINGS.perUserDaily[action]);
}

// ---- site-wide Approve cap (ADR-0008) ------------------------------------------------------------
// At most per31Days committed approvals in any rolling 31 days AND at most perDay per New York calendar day.
// ONE record, key "site:approvals" in the "ratelimit" store, value { times: ["<ISO-8601 UTC>", ...] },
// pruned to the last 31 days on every write (no scheduler). Check is read-only and runs inside the approve lock
// BEFORE any GitHub call; record runs only when the proposal reaches `committed`.
export const APPROVE_CAP = Object.freeze({ per31Days: SETTINGS.approveCap.per31Days, perDay: SETTINGS.approveCap.perDay });
export const APPROVE_KEY = "site:approvals";

export interface ApproveVerdict {
  allowed: boolean; used31: number; usedToday: number; reason?: "month" | "day"; retryAt?: string;
}

// Pure decision. A time t is live while t > now - 31 days.
export function evaluate(times: readonly string[], now: Date, caps: { per31Days: number; perDay: number } = APPROVE_CAP): ApproveVerdict {
  const live = times.map((t) => new Date(t)).filter((t) => t.getTime() > now.getTime() - WINDOW_MS).sort((a, b) => a.getTime() - b.getTime());
  const today = localDay(now);
  const todayN = live.filter((t) => localDay(t) === today).length;
  const retry: Date[] = [];
  if (live.length >= caps.per31Days) retry.push(new Date(live[live.length - caps.per31Days].getTime() + WINDOW_MS));
  if (todayN >= caps.perDay) retry.push(nextLocalMidnight(now));
  if (retry.length === 0) return { allowed: true, used31: live.length, usedToday: todayN };
  const retryAt = new Date(Math.max(...retry.map((d) => d.getTime())));
  const reason = live.length >= caps.per31Days ? "month" : "day"; // "month" wins when both apply
  return { allowed: false, reason, used31: live.length, usedToday: todayN, retryAt: retryAt.toISOString() };
}

// A record that exists but is not { times: [ISO-8601 string, ...] } is an error, never an empty list (which would reset the cap).
export function assertApprovalsShape(data: unknown): asserts data is { times: string[] } {
  const t = (data as { times?: unknown } | null)?.times;
  const ok = Array.isArray(t) && t.every((x) => typeof x === "string" && /^\d{4}-\d{2}-\d{2}T/.test(x) && Number.isFinite(Date.parse(x)));
  if (!ok) throw new Error("site:approvals unreadable");
}

export async function checkApproveCap(store: BlobStore, now: Date = new Date(), caps = APPROVE_CAP): Promise<ApproveVerdict> {
  const cur = await store.getWithMetadata(APPROVE_KEY, { type: "json" });
  if (cur !== null) assertApprovalsShape(cur.data);
  return evaluate(cur === null ? [] : (cur.data as { times: string[] }).times, now, caps);
}

// Append one committed approval with CAS and prune to the window. Throws under contention
// (the commit already happened: the caller logs it and the reconciler can record it later).
export async function recordApproval(store: BlobStore, now: Date = new Date(), { maxAttempts = 20 } = {}): Promise<{ recorded: true; count: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const cur = await store.getWithMetadata(APPROVE_KEY, { type: "json" });
    if (cur !== null) assertApprovalsShape(cur.data);
    const old = cur === null ? [] : (cur.data as { times: string[] }).times;
    const kept = old.filter((t) => new Date(t).getTime() > now.getTime() - WINDOW_MS);
    const next = { times: [...kept, now.toISOString()] };
    const r = cur === null
      ? await store.setJSON(APPROVE_KEY, next, { onlyIfNew: true })
      : await store.setJSON(APPROVE_KEY, next, { onlyIfMatch: cur.etag });
    if (r.modified) return { recorded: true, count: next.times.length };
  }
  throw new Error("recordApproval: contended");
}

// ---- site-wide compute budget (docs/04 §9, D1) ----------------------------------------------------
// SETTINGS.computeBudgetMinutes of /api/chat + /api/jobs-run wall time per rolling 31 days (about 30 credits
// at 1024 MB). The number is pending Dr. Lee. ONE record, key "site:compute" in "ratelimit",
// value { days: { "<New York YYYY-MM-DD>": <milliseconds> } }: at most 32 keys however many turns run.
// The window rounds outwards to whole New York days (slightly conservative, never lenient).
export const COMPUTE_BUDGET = Object.freeze({
  windowMinutes: SETTINGS.computeBudgetMinutes,
  chatNeedMs: SETTINGS.computeNeedChatMs,
  jobNeedMs: SETTINGS.computeNeedJobMs,
});
export const COMPUTE_KEY = "site:compute";

type Days = Record<string, number>;
const liveDays = (days: Days | undefined, now: Date): [string, number][] => {
  const first = localDay(new Date(now.getTime() - WINDOW_MS));
  return Object.entries(days ?? {}).filter(([d]) => d >= first).sort(([a], [b]) => (a < b ? -1 : 1));
};

export function assertComputeShape(data: unknown): asserts data is { days: Days } {
  const days = (data as { days?: unknown } | null)?.days;
  const ok = !!days && typeof days === "object" && !Array.isArray(days) &&
    Object.entries(days as Record<string, unknown>).every(([d, ms]) => /^\d{4}-\d{2}-\d{2}$/.test(d) && typeof ms === "number" && Number.isFinite(ms) && ms >= 0);
  if (!ok) throw new Error("site:compute unreadable");
}

export interface ComputeVerdict { allowed: boolean; usedMs: number; remainingMs: number; retryAt?: string | null }

export function evaluateCompute(days: Days | undefined, now: Date, needMs: number, budget: { windowMinutes: number } = COMPUTE_BUDGET): ComputeVerdict {
  const live = liveDays(days, now);
  const limitMs = budget.windowMinutes * 60_000;
  const usedMs = live.reduce((n, [, ms]) => n + ms, 0);
  const remainingMs = Math.max(0, limitMs - usedMs);
  if (remainingMs >= needMs) return { allowed: true, usedMs, remainingMs };
  // Earliest moment enough of the oldest buckets have expired (a New York day bucket leaves at the New York midnight after day + 31 days).
  let freed = 0;
  let retryAt: string | null = null;
  for (const [d, ms] of live) {
    freed += ms;
    if (remainingMs + freed >= needMs) { retryAt = nextLocalMidnight(new Date(Date.parse(`${d}T12:00:00Z`) + 31 * DAY_MS)).toISOString(); break; }
  }
  return { allowed: false, usedMs, remainingMs, retryAt };
}

// Read-only. Call before a chat turn (needs >= chatNeedMs left) or a job (>= jobNeedMs left).
export async function checkComputeBudget(store: BlobStore, needMs: number, now: Date = new Date(), budget = COMPUTE_BUDGET): Promise<ComputeVerdict> {
  const cur = await store.getWithMetadata(COMPUTE_KEY, { type: "json" }); // a Blobs error propagates: the caller answers 503
  if (cur !== null) assertComputeShape(cur.data);
  return evaluateCompute(cur === null ? undefined : (cur.data as { days: Days }).days, now, needMs, budget);
}

// CAS add of elapsed milliseconds to today's bucket, when a turn or job ends and at each job progress write
// (pass only the NEW milliseconds each time). Prunes expired buckets on every write.
export async function recordCompute(store: BlobStore, ms: number, now: Date = new Date(), { maxAttempts = 20 } = {}): Promise<{ recorded: boolean; totalMs?: number }> {
  if (!Number.isFinite(ms) || ms <= 0) return { recorded: false };
  const today = localDay(now);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const cur = await store.getWithMetadata(COMPUTE_KEY, { type: "json" });
    if (cur !== null) assertComputeShape(cur.data);
    const days: Days = Object.fromEntries(liveDays(cur === null ? undefined : (cur.data as { days: Days }).days, now));
    days[today] = Math.round((days[today] ?? 0) + ms);
    const r = cur === null
      ? await store.setJSON(COMPUTE_KEY, { days }, { onlyIfNew: true })
      : await store.setJSON(COMPUTE_KEY, { days }, { onlyIfMatch: cur.etag });
    if (r.modified) return { recorded: true, totalMs: Object.values(days).reduce((n, v) => n + v, 0) };
  }
  throw new Error("recordCompute: contended"); // the work already ran: log it, never block the response on it
}

// Retention helper (no scheduled function in v1): delete per-user counter keys whose day is older than keepDays.
export async function pruneOlderThan(store: BlobStore, action: string, keepDays: number, now: Date = new Date()): Promise<number> {
  const cutoff = localDay(new Date(now.getTime() - keepDays * DAY_MS));
  const { blobs } = await store.list({ prefix: `${action}/` });
  let deleted = 0;
  for (const { key } of blobs) {
    if (key.slice(-10) < cutoff) { await store.delete(key); deleted++; }
  }
  return deleted;
}
