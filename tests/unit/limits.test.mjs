// Run: npx vitest run tests/unit/limits.test.mjs   (also under TZ=UTC and TZ=Pacific/Auckland)
import { test } from "vitest";
import assert from "node:assert/strict";
import { SETTINGS } from "../../netlify/functions/lib/settings.mts";
import { hit, hitUserDaily, windowKey, pruneOlderThan, APPROVE_CAP, APPROVE_KEY, checkApproveCap, recordApproval, COMPUTE_BUDGET, COMPUTE_KEY, checkComputeBudget, recordCompute } from "../../netlify/functions/lib/limits.mts";

// Fake Blobs store with the documented conditional-write semantics.
// Each call yields to the event loop so parallel callers interleave.
const tick = () => new Promise((r) => setImmediate(r));
function createFakeStore() {
  const rows = new Map();
  let v = 0;
  return {
    async getWithMetadata(key, { type } = {}) {
      await tick();
      const row = rows.get(key);
      return row ? { data: type === "json" ? JSON.parse(row.raw) : row.raw, etag: row.etag, metadata: {} } : null;
    },
    async setJSON(key, value, { onlyIfNew, onlyIfMatch } = {}) {
      await tick();
      const cur = rows.get(key);
      if (onlyIfNew && cur) return { modified: false };
      if (onlyIfMatch !== undefined && (!cur || cur.etag !== onlyIfMatch)) return { modified: false };
      const etag = `"${++v}"`;
      rows.set(key, { raw: JSON.stringify(value), etag });
      return { modified: true, etag };
    },
    async list({ prefix = "" } = {}) {
      await tick();
      return { blobs: [...rows.keys()].filter((k) => k.startsWith(prefix)).map((key) => ({ key, etag: rows.get(key).etag })), directories: [] };
    },
    async delete(key) {
      await tick();
      rows.delete(key);
    },
  };
}

// The anti-pattern, kept here to prove the test can tell the difference.
async function naiveHit(store, key, limit) {
  const cur = await store.getWithMetadata(key, { type: "json" });
  const count = cur ? cur.data.count : 0;
  if (count >= limit) return { allowed: false };
  await store.setJSON(key, { count: count + 1 }); // unconditional: last write wins
  return { allowed: true };
}

const key = windowKey("user-abc", "chat", new Date("2026-11-23T15:00:00Z"));

test("key shape", () => {
  assert.equal(key, "chat/user-abc/2026-11-23");
  assert.ok(!key.startsWith("/") && Buffer.byteLength(key) <= 600);
});

test("sequential: allows exactly `limit` hits, then blocks without incrementing", async () => {
  const s = createFakeStore();
  const results = [];
  for (let i = 0; i < 7; i++) results.push(await hit(s, key, 5));
  assert.deepEqual(results.map((r) => r.allowed), [true, true, true, true, true, false, false]);
  assert.equal((await s.getWithMetadata(key, { type: "json" })).data.count, 5);
});

test("concurrent: 50 parallel hits against limit 20 admit exactly 20", async () => {
  const s = createFakeStore();
  const results = await Promise.all(Array.from({ length: 50 }, () => hit(s, key, 20, { maxAttempts: 100 })));
  const allowed = results.filter((r) => r.allowed).length;
  const stored = (await s.getWithMetadata(key, { type: "json" })).data.count;
  console.log(`  CAS:   allowed=${allowed} stored=${stored}`);
  assert.equal(allowed, 20);
  assert.equal(stored, 20);
});

test("concurrent: the naive read-modify-write over-admits (why CAS is needed)", async () => {
  const s = createFakeStore();
  const results = await Promise.all(Array.from({ length: 50 }, () => naiveHit(s, key, 20)));
  const allowed = results.filter((r) => r.allowed).length;
  const stored = (await s.getWithMetadata(key, { type: "json" })).data.count;
  console.log(`  naive: allowed=${allowed} stored=${stored}`);
  assert.ok(allowed > 20, "lost updates let extra requests through");
});

test("pruneOlderThan deletes only old day keys", async () => {
  const s = createFakeStore();
  for (const d of ["2026-11-01", "2026-11-20", "2026-11-23"]) await s.setJSON(`chat/x/${d}`, { count: 1 });
  const n = await pruneOlderThan(s, "chat", 7, new Date("2026-11-23T12:00:00Z"));
  assert.equal(n, 1);
  assert.deepEqual((await s.list({ prefix: "chat/" })).blobs.map((b) => b.key).sort(), ["chat/x/2026-11-20", "chat/x/2026-11-23"]);
});

// ---- site-wide Approve cap, ADR-0008: 14 per rolling 31 days AND 5 per day in America/New_York ----
const D = (iso) => new Date(iso);
const fill = async (s, isos) => { for (const i of isos) await recordApproval(s, D(i)); };
const five = (iso) => Array(5).fill(iso);

test("approve cap: the key is one fixed record, constants match ADR-0008", () => {
  assert.equal(APPROVE_KEY, "site:approvals");
  assert.deepEqual(APPROVE_CAP, { per31Days: 14, perDay: 5 });
});

test("approve cap: 6th approval on one New York day is refused; the NY day, not the UTC day, decides", async () => {
  const s = createFakeStore();
  await fill(s, five("2026-11-24T03:00:00Z")); // 22:00 on Nov 23 in New York (EST, UTC-5)
  const late = await checkApproveCap(s, D("2026-11-24T04:59:00Z")); // 23:59 NY, but already Nov 24 in UTC
  assert.equal(late.allowed, false);
  assert.equal(late.reason, "day");
  assert.equal(late.retryAt, "2026-11-24T05:00:00.000Z"); // next New York midnight
  assert.equal((await checkApproveCap(s, D("2026-11-24T05:00:01Z"))).allowed, true);
});

test("approve cap: the day boundary survives DST (spring forward 2027-03-14, fall back 2026-11-01)", async () => {
  const spring = createFakeStore();
  await fill(spring, five("2027-03-14T12:00:00Z"));
  assert.equal((await checkApproveCap(spring, D("2027-03-15T03:59:00Z"))).allowed, false); // still Mar 14 NY (EDT, UTC-4)
  assert.equal((await checkApproveCap(spring, D("2027-03-15T04:00:00Z"))).allowed, true);
  const fall = createFakeStore();
  await fill(fall, five("2026-11-01T12:00:00Z"));
  assert.equal((await checkApproveCap(fall, D("2026-11-02T04:59:00Z"))).allowed, false); // the 25-hour day
  assert.equal((await checkApproveCap(fall, D("2026-11-02T05:00:00Z"))).allowed, true);
});

test("approve cap: 14 in a rolling 31 days, the 15th is refused (reason: month) with the right retryAt", async () => {
  const s = createFakeStore();
  const times = [
    ...five("2026-11-03T15:00:00Z"), ...five("2026-11-10T15:00:00Z"), "2026-11-17T15:00:00Z", "2026-11-17T16:00:00Z", "2026-11-17T17:00:00Z", "2026-11-17T18:00:00Z",
  ]; // 14
  await fill(s, times);
  const r = await checkApproveCap(s, D("2026-11-24T12:00:00Z"));
  assert.deepEqual([r.allowed, r.reason, r.used31], [false, "month", 14]);
  assert.equal(r.retryAt, "2026-12-04T15:00:00.000Z"); // oldest of the last 14 (Nov 3 15:00Z) + 31 days
});

test("approve cap: the window is rolling, not a calendar month, and a time exactly 31 days old has expired", async () => {
  const s = createFakeStore();
  await fill(s, [...five("2026-10-31T15:00:00Z"), ...five("2026-11-10T15:00:00Z"), "2026-11-20T10:00:00Z", "2026-11-20T11:00:00Z", "2026-11-20T12:00:00Z", "2026-11-20T13:00:00Z"]);
  // Late Nov to early Dec crosses a calendar month, yet the 14 recorded approvals still count.
  assert.equal((await checkApproveCap(s, D("2026-12-01T12:00:00Z"))).allowed, false);
  assert.equal((await checkApproveCap(s, D("2026-12-01T14:59:59Z"))).allowed, false); // first one is 30 d 23:59:59 old
  assert.equal((await checkApproveCap(s, D("2026-12-01T15:00:00Z"))).allowed, true); // Oct 31 15:00Z + 31 d: expired
});

test("approve cap: sequential check-then-record admits exactly 5 on one day", async () => {
  const s = createFakeStore(), now = D("2026-11-23T15:00:00Z");
  let admitted = 0;
  for (let i = 0; i < 8; i++) if ((await checkApproveCap(s, now)).allowed) { await recordApproval(s, now); admitted++; }
  assert.equal(admitted, 5);
});

test("approve cap: failed, stale and rejected approvals are never recorded (record only on committed)", async () => {
  const s = createFakeStore(), now = D("2026-11-23T15:00:00Z");
  await checkApproveCap(s, now); // a check alone writes nothing
  assert.equal(await s.getWithMetadata(APPROVE_KEY, { type: "json" }), null);
});

test("approve cap: 30 parallel recordApproval calls lose none (CAS), and old times are pruned on write", async () => {
  const s = createFakeStore(), now = D("2026-11-23T15:00:00Z");
  await s.setJSON(APPROVE_KEY, { times: ["2026-09-01T00:00:00Z", "2026-10-30T00:00:00Z"] }); // one expired (84 d), one live (24 d)
  await Promise.all(Array.from({ length: 30 }, () => recordApproval(s, now, { maxAttempts: 100 })));
  const { data } = await s.getWithMetadata(APPROVE_KEY, { type: "json" });
  assert.equal(data.times.length, 31);
  assert.ok(!data.times.includes("2026-09-01T00:00:00Z"));
  assert.ok(data.times.includes("2026-10-30T00:00:00Z"));
});

// ---- site-wide compute budget (site:compute) -------------------------------
const MIN = 60_000;
test("approve cap: an unreadable site:approvals record or a store error fails closed (throws, so the handler answers 503), never an empty list", async () => {
  const now = new Date("2026-11-23T15:00:00Z");
  for (const bad of [{}, { times: null }, { times: "x" }, { times: ["not a date"] }, { times: [123] }, { times: ["2026-11-01T00:00:00Z", null] }]) {
    const store = createFakeStore();
    await store.setJSON(APPROVE_KEY, bad);
    await assert.rejects(() => checkApproveCap(store, now), /unreadable/, JSON.stringify(bad));
    await assert.rejects(() => recordApproval(store, now), /unreadable/, JSON.stringify(bad));
  }
  const broken = { getWithMetadata: async () => { throw new Error("blobs down"); } };
  await assert.rejects(() => checkApproveCap(broken, now));
});

test("compute budget: one fixed record, 180 minutes pending Dr. Lee, chat needs 60 s and a job 5 min", () => {
  assert.equal(COMPUTE_KEY, "site:compute");
  assert.deepEqual(COMPUTE_BUDGET, { windowMinutes: 180, chatNeedMs: 60_000, jobNeedMs: 300_000 });
});

test("compute budget: sequential records add up; a turn is refused when less than 60 s is left; a job when less than 5 min", async () => {
  const store = createFakeStore();
  const now = new Date("2026-11-23T15:00:00Z");
  assert.equal((await checkComputeBudget(store, COMPUTE_BUDGET.chatNeedMs, now)).allowed, true);
  await recordCompute(store, 170 * MIN, now);
  const job = await checkComputeBudget(store, COMPUTE_BUDGET.jobNeedMs, now);
  assert.deepEqual(job, { allowed: true, usedMs: 170 * MIN, remainingMs: 10 * MIN }, "10 minutes left: a 5-minute job may start");
  await recordCompute(store, 6 * MIN, now); // 176 used, 4 min left
  assert.equal((await checkComputeBudget(store, COMPUTE_BUDGET.jobNeedMs, now)).allowed, false, "a job needs 5 min");
  assert.equal((await checkComputeBudget(store, COMPUTE_BUDGET.chatNeedMs, now)).allowed, true, "a chat turn needs only 60 s");
  await recordCompute(store, 3.5 * MIN, now); // 179.5 used, 30 s left
  const chat = await checkComputeBudget(store, COMPUTE_BUDGET.chatNeedMs, now);
  assert.equal(chat.allowed, false);
  assert.ok(chat.retryAt > now.toISOString(), "retryAt is in the future (for the 429 budget_exhausted body)");
});

test("compute budget: the window rolls (31 days, whole New York days, rounded outwards) and old buckets are pruned on write", async () => {
  const store = createFakeStore();
  const t0 = new Date("2026-10-01T16:00:00Z");
  await recordCompute(store, 180 * MIN, t0);
  assert.equal((await checkComputeBudget(store, MIN, new Date("2026-10-31T16:00:00Z"))).allowed, false, "30 days later: still spent");
  assert.equal((await checkComputeBudget(store, MIN, new Date("2026-11-02T16:00:00Z"))).allowed, true, "32 days later: bucket expired");
  await recordCompute(store, MIN, new Date("2026-11-02T16:00:00Z"));
  const rec = (await store.getWithMetadata(COMPUTE_KEY, { type: "json" })).data;
  assert.deepEqual(Object.keys(rec.days), ["2026-11-02"], "the October bucket was pruned by the write");
});

test("compute budget: an unreadable record or a store error fails closed (throws, so the handler answers 503), never allowed", async () => {
  const now = new Date("2026-11-23T15:00:00Z");
  for (const bad of [{ days: "oops" }, { days: [1] }, {}, { days: { "2026-11-23": "x" } }, { days: { today: 5 } }, null]) {
    const store = createFakeStore();
    await store.setJSON(COMPUTE_KEY, bad);
    await assert.rejects(() => checkComputeBudget(store, MIN, now), /unreadable/, JSON.stringify(bad));
  }
  const broken = { getWithMetadata: async () => { throw new Error("blobs down"); } };
  await assert.rejects(() => checkComputeBudget(broken, MIN, now));
});

test("compute budget: 30 parallel recordCompute calls lose nothing (CAS), and the record stays small", async () => {
  const store = createFakeStore();
  const now = new Date("2026-11-23T15:00:00Z");
  await Promise.all(Array.from({ length: 30 }, () => recordCompute(store, 30_000, now, { maxAttempts: 100 })));
  const rec = (await store.getWithMetadata(COMPUTE_KEY, { type: "json" })).data;
  assert.equal(rec.days["2026-11-23"], 30 * 30_000);
  assert.equal(await recordCompute(store, 0, now).then((r) => r.recorded), false, "zero or negative is ignored");
});

// ---- additions for the real module -----------------------------------------------------------
test("constants are derived from SETTINGS (one place to change a decision)", () => {
  assert.equal(APPROVE_CAP.per31Days, SETTINGS.approveCap.per31Days);
  assert.equal(APPROVE_CAP.perDay, SETTINGS.approveCap.perDay);
  assert.equal(COMPUTE_BUDGET.windowMinutes, SETTINGS.computeBudgetMinutes);
  assert.equal(COMPUTE_BUDGET.chatNeedMs, SETTINGS.computeNeedChatMs);
  assert.equal(COMPUTE_BUDGET.jobNeedMs, SETTINGS.computeNeedJobMs);
});

test("per-user daily counters: key uses the New York day; limits come from SETTINGS (200 chat, 20 jobs)", async () => {
  assert.equal(windowKey("u1", "chat", new Date("2026-11-24T04:30:00Z")), "chat/u1/2026-11-23"); // 23:30 NY
  assert.equal(windowKey("u1", "chat", new Date("2026-11-24T05:00:00Z")), "chat/u1/2026-11-24");
  const s = createFakeStore();
  const now = new Date("2026-11-23T15:00:00Z");
  let jobs = 0;
  for (let i = 0; i < 25; i++) if ((await hitUserDaily(s, "jobs", "u1", now)).allowed) jobs++;
  assert.equal(jobs, SETTINGS.perUserDaily.jobs);
  assert.equal((await hitUserDaily(s, "chat", "u1", now)).limit, SETTINGS.perUserDaily.chat);
  assert.equal((await hitUserDaily(s, "chat", "u2", now)).count, 1, "another user has their own counter");
});

test("per-user counter: an unreadable record throws (fail closed); heavy contention refuses instead of over-admitting", async () => {
  const s = createFakeStore();
  await s.setJSON("chat/u1/2026-11-23", { count: "many" });
  await assert.rejects(() => hit(s, "chat/u1/2026-11-23", 5), /unreadable/);
  const racing = { getWithMetadata: async () => ({ data: { count: 1 }, etag: "x" }), setJSON: async () => ({ modified: false }) };
  const r = await hit(racing, "k", 5, { maxAttempts: 3 });
  assert.deepEqual([r.allowed, r.contended], [false, true]);
});
