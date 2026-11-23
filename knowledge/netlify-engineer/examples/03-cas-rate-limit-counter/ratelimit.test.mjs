// Run: node --test ratelimit.test.mjs   (no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { hit, hitCapped, approveKey, windowKey, pruneOlderThan } from "./ratelimit.mjs";

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

// ---- site-wide Approve cap: 5 per UTC day AND 14 per UTC month (Dr. Lee, 2026-11-23) ----
const CAPS = { dayLimit: 5, monthLimit: 14 };
const at = (iso) => ({ now: new Date(iso) });

test("approve cap: key is per UTC month", () => {
  assert.equal(approveKey(new Date("2026-11-23T23:59:59Z")), "approve/site/2026-11");
  assert.equal(approveKey(new Date("2026-12-01T00:00:00Z")), "approve/site/2026-12");
});

test("approve cap: the 6th approval in a day is refused (reason: day), the next day allows more", async () => {
  const s = createFakeStore(), k = approveKey(new Date("2026-11-23T10:00:00Z"));
  const got = [];
  for (let i = 0; i < 6; i++) got.push(await hitCapped(s, k, CAPS, at("2026-11-23T10:00:00Z")));
  assert.deepEqual(got.map((g) => g.allowed), [true, true, true, true, true, false]);
  assert.equal(got[5].reason, "day");
  assert.equal(got[5].count, 5, "a refused request does not use a month slot");
  assert.equal((await hitCapped(s, k, CAPS, at("2026-11-24T00:00:01Z"))).allowed, true);
});

test("approve cap: 14 per month across days, the 15th is refused (reason: month)", async () => {
  const s = createFakeStore(), k = "approve/site/2026-11";
  const days = ["03", "03", "03", "03", "03", "10", "10", "10", "10", "10", "17", "17", "17", "17", "24"]; // 15 attempts
  const res = [];
  for (const d of days) res.push(await hitCapped(s, k, CAPS, at(`2026-11-${d}T12:00:00Z`)));
  assert.equal(res.filter((r) => r.allowed).length, 14);
  assert.equal(res[14].allowed, false);
  assert.equal(res[14].reason, "month");
});

test("approve cap: 30 parallel approvals admit exactly 5 (one CAS decides both windows)", async () => {
  const s = createFakeStore(), k = "approve/site/2026-11";
  const res = await Promise.all(Array.from({ length: 30 }, () => hitCapped(s, k, CAPS, { ...at("2026-11-23T12:00:00Z"), maxAttempts: 100 })));
  assert.equal(res.filter((r) => r.allowed).length, 5);
  assert.equal((await s.getWithMetadata(k, { type: "json" })).data.count, 5);
});
