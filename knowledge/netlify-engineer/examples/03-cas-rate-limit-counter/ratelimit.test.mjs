// Run: node --test ratelimit.test.mjs   (no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { hit, windowKey, pruneOlderThan, APPROVE_CAP, APPROVE_KEY, checkApproveCap, recordApproval } from "./ratelimit.mjs";

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
