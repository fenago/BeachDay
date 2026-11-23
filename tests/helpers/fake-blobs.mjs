// In-memory stand-in for @netlify/blobs. Honours onlyIfNew / onlyIfMatch like the real strong-consistency
// store, yields to the event loop on every call so concurrent callers interleave (CAS tests need that),
// and counts every call so "this request touched no store" is assertable.
const tick = () => new Promise((r) => setImmediate(r));

export function createFakeStore(name = "store", onCall = () => {}) {
  const rows = new Map(); // key -> { raw, etag, metadata }
  let version = 0;
  const read = (row, type) => (type === "json" ? JSON.parse(row.raw) : row.raw);
  const enter = async (op, key) => { onCall({ store: name, op, key }); await tick(); };
  return {
    name,
    rows,
    async get(key, { type } = {}) {
      await enter("get", key);
      const row = rows.get(key);
      return row ? read(row, type) : null;
    },
    async getWithMetadata(key, { type } = {}) {
      await enter("getWithMetadata", key);
      const row = rows.get(key);
      return row ? { data: read(row, type), etag: row.etag, metadata: row.metadata } : null;
    },
    async set(key, value, { onlyIfNew, onlyIfMatch, metadata = {} } = {}) {
      await enter("set", key);
      if (onlyIfNew && onlyIfMatch !== undefined) throw new Error("onlyIfNew and onlyIfMatch are mutually exclusive");
      const cur = rows.get(key);
      if (onlyIfNew && cur) return { modified: false };
      if (onlyIfMatch !== undefined && (!cur || cur.etag !== onlyIfMatch)) return { modified: false };
      const etag = `"v${++version}"`;
      rows.set(key, { raw: String(value), etag, metadata });
      return { modified: true, etag };
    },
    async setJSON(key, value, opts) {
      return this.set(key, JSON.stringify(value), opts);
    },
    async list({ prefix = "" } = {}) {
      await enter("list", prefix);
      const blobs = [...rows].filter(([k]) => k.startsWith(prefix)).map(([key, r]) => ({ key, etag: r.etag }));
      return { blobs, directories: [] };
    },
    async delete(key) {
      await enter("delete", key);
      rows.delete(key);
    },
  };
}

// getStore(name | { name, consistency }) returns the same store for the same name, like Netlify does per site.
export function createFakeBlobs() {
  const stores = new Map();
  const calls = [];
  const onCall = (c) => calls.push(c);
  const blobs = {
    stores,
    calls,
    getStore(nameOrOpts) {
      const name = typeof nameOrOpts === "string" ? nameOrOpts : nameOrOpts?.name;
      if (!name) throw new Error("fake-blobs: getStore needs a name");
      if (!stores.has(name)) stores.set(name, createFakeStore(name, onCall));
      return stores.get(name);
    },
    // Convenience for assertions and seeding (does not count as a call).
    seed(name, key, value) {
      const s = blobs.getStore(name);
      s.rows.set(key, { raw: typeof value === "string" ? value : JSON.stringify(value), etag: `"seed"`, metadata: {} });
    },
    peek(name, key) {
      const row = stores.get(name)?.rows.get(key);
      return row ? JSON.parse(row.raw) : null;
    },
    get callCount() { return calls.length; },
    resetCalls() { calls.length = 0; },
    reset() { stores.clear(); calls.length = 0; },
  };
  return blobs;
}

// The Netlify Context object the harness passes to handlers.
export function fakeContext({ params = {}, ip = "203.0.113.7", deployContext = "production", siteUrl, requestId = "req-test" } = {}) {
  return {
    ip,
    params,
    requestId,
    deploy: { context: deployContext, id: "deploy-test" },
    site: { id: "site-test", name: "beachday-test", url: siteUrl },
    geo: { country: { code: "US" } },
    cookies: { get() {}, set() {}, delete() {} },
    waitUntil() {},
  };
}
