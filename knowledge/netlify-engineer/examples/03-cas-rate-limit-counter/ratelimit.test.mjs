// Run: node --test ratelimit.test.mjs   (no dependencies)
import { test } from "node:test";
import assert from "node:assert/strict";
import { hit, windowKey, pruneOlderThan } from "./ratelimit.mjs";

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

const key = windowKey("session-abc", "chat", new Date("2026-11-23T15:00:00Z"));

test("key shape", () => {
  assert.equal(key, "chat/session-abc/2026-11-23");
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
