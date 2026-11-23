// In-memory stand-in for a @netlify/blobs Store, for tests only.
// Mirrors the documented return shapes:
//   get(key, {type})            -> value | null
//   getWithMetadata(key, {type}) -> { data, etag, metadata } | null
//   set/setJSON(key, v, {onlyIfNew | onlyIfMatch, metadata}) -> { modified, etag? }
//   list({prefix})              -> { blobs: [{key, etag}], directories: [] }
//   delete(key)                 -> void
// Every call yields to the event loop first, so concurrent callers interleave
// the way real network calls do (needed to prove compare-and-swap works).
const tick = () => new Promise((r) => setImmediate(r));

export function createFakeStore() {
  const rows = new Map(); // key -> { raw, etag, metadata }
  let version = 0;
  const read = (row, type) => (type === "json" ? JSON.parse(row.raw) : row.raw);

  return {
    rows,
    async get(key, { type } = {}) {
      await tick();
      const row = rows.get(key);
      return row ? read(row, type) : null;
    },
    async getWithMetadata(key, { type } = {}) {
      await tick();
      const row = rows.get(key);
      return row ? { data: read(row, type), etag: row.etag, metadata: row.metadata } : null;
    },
    async set(key, raw, { onlyIfNew, onlyIfMatch, metadata = {} } = {}) {
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
    async list({ prefix = "" } = {}) {
      await tick();
      const blobs = [...rows].filter(([k]) => k.startsWith(prefix)).map(([key, r]) => ({ key, etag: r.etag }));
      return { blobs, directories: [] };
    },
    async delete(key) {
      await tick();
      rows.delete(key);
    },
  };
}

// Minimal stand-in for the Netlify Context object used by these handlers.
export function fakeContext({ params = {}, ip = "203.0.113.7" } = {}) {
  const setCookies = [];
  return {
    ip,
    params,
    requestId: "test-request",
    cookies: {
      get: () => undefined,
      set: (c) => setCookies.push(c),
      delete: () => {},
    },
    setCookies,
  };
}
