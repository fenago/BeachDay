// In-memory stand-in for a @netlify/blobs Store (tests only), same shape as
// knowledge/netlify-engineer/examples/01-functions-jobs-blobs/test/fake-blobs.mjs.
// Every call yields first so concurrent callers interleave like real network calls (needed to test CAS).
const tick = () => new Promise((r) => setImmediate(r));

export function createFakeStore({ failReads = false } = {}) {
  const rows = new Map();
  let version = 0;
  const calls = [];
  const read = (row, type) => (type === "json" ? JSON.parse(row.raw) : row.raw);
  return {
    rows,
    calls,
    async get(key, { type } = {}) {
      calls.push(["get", key]);
      await tick();
      if (failReads) throw new Error("blobs down");
      const row = rows.get(key);
      return row ? read(row, type) : null;
    },
    async getWithMetadata(key, { type } = {}) {
      calls.push(["getWithMetadata", key]);
      await tick();
      if (failReads) throw new Error("blobs down");
      const row = rows.get(key);
      return row ? { data: read(row, type), etag: row.etag, metadata: row.metadata } : null;
    },
    async set(key, raw, { onlyIfNew, onlyIfMatch, metadata = {} } = {}) {
      calls.push(["set", key]);
      await tick();
      if (onlyIfNew && onlyIfMatch) throw new Error("onlyIfNew and onlyIfMatch are mutually exclusive");
      const cur = rows.get(key);
      if (onlyIfNew && cur) return { modified: false };
      if (onlyIfMatch !== undefined && (!cur || cur.etag !== onlyIfMatch)) return { modified: false };
      const etag = `"v${++version}"`;
      rows.set(key, { raw: String(raw), etag, metadata });
      return { modified: true, etag };
    },
    async setJSON(key, value, opts) {
      return this.set(key, JSON.stringify(value), opts);
    },
    async delete(key) {
      await tick();
      rows.delete(key);
    },
    json(key) {
      const r = rows.get(key);
      return r ? JSON.parse(r.raw) : null;
    },
  };
}
