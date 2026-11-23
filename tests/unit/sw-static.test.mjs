import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";

const publicDir = join(import.meta.dirname, "../../public");
const source = readFileSync(join(publicDir, "sw.js"), "utf8");
const ORIGIN = "https://beachday.test";
const VERSION = "abc123def456";

// Every SHELL entry must exist on disk (one 404 in cache.addAll fails the install). W2 emptied the pending list.

// ---- A tiny service-worker harness: run sw.js in a vm with fakes for self, caches, fetch, Request. ----
function makeHarness({ fetchImpl } = {}) {
  const handlers = {};
  const stores = new Map(); // cacheName -> Map(url -> Response)
  const matchCalls = [];
  const makeCache = (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const m = stores.get(name);
    const key = (r) => (typeof r === "string" ? new URL(r, ORIGIN).href : r.url);
    const stripSearch = (u) => { const x = new URL(u); x.search = ""; return x.href; };
    const find = (r, opts = {}) => {
      matchCalls.push({ cache: name, url: key(r), opts });
      const k = key(r);
      if (m.has(k)) return m.get(k);
      if (opts.ignoreSearch) for (const [mk, v] of m) if (stripSearch(mk) === stripSearch(k)) return v;
      return undefined;
    };
    return {
      addAll: async (reqs) => { for (const r of reqs) m.set(key(r), new Response("shell:" + key(r))); },
      put: async (r, res) => { m.set(key(r), res); },
      match: async (r, opts) => find(r, opts)?.clone(),
      keys: async () => [...m.keys()].map((u) => ({ url: u })),
      delete: async (r) => m.delete(typeof r === "string" ? r : r.url),
    };
  };
  const caches = {
    open: async (n) => makeCache(n),
    keys: async () => [...stores.keys()],
    delete: async (n) => stores.delete(n),
    match: async (r, opts) => { for (const n of stores.keys()) { const c = await makeCache(n).match(r, opts); if (c) return c; } return undefined; },
  };
  let skipWaitingCalls = 0;
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => { handlers[type] = fn; },
    skipWaiting: () => { skipWaitingCalls++; },
    clients: { claim: vi.fn() },
  };
  class FakeRequest { constructor(u, init = {}) { this.url = new URL(u, ORIGIN).href; this.method = "GET"; this.cache = init.cache; } }
  const fetchLog = [];
  const ctx = vm.createContext({
    self, caches, Request: FakeRequest, Response, Headers, URL,
    fetch: (r) => { fetchLog.push(r.url ?? r); return fetchImpl(r); },
    setTimeout: (...a) => setTimeout(...a), clearTimeout: (...a) => clearTimeout(...a),
    Promise, Date,
  });
  vm.runInContext(source.replace("__BUILD_VERSION__", VERSION) + "\n;globalThis.__t = { SHELL_URLS, SHELL_CACHE, DATA_CACHE };", ctx);
  const waits = [];
  const fire = (type, ev) => { handlers[type]({ waitUntil: (p) => waits.push(p), ...ev }); };
  const fetchEvent = (url, { method = "GET", mode = "cors", destination = "" } = {}) => {
    let responded;
    fire("fetch", {
      request: { url, method, mode, destination },
      respondWith: (p) => { responded = Promise.resolve(p); },
    });
    return responded;
  };
  return { ...ctx.__t, handlers, stores, caches, fire, fetchEvent, waits, matchCalls, fetchLog, get skipWaitingCalls() { return skipWaitingCalls; }, self };
}
const offline = () => Promise.reject(new TypeError("Failed to fetch"));
afterEach(() => vi.useRealTimers());

describe("sw.js source rules", () => {
  it("has the build placeholder exactly once, as VERSION", () => {
    expect(source.match(/__BUILD_VERSION__/g)).toHaveLength(1);
    expect(source).toContain('const VERSION = "__BUILD_VERSION__";');
  });
  it("imports nothing", () => {
    expect(source).not.toMatch(/\bimportScripts\s*\(/);
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\bimport\s*\(/);
  });
  it("never calls clients.claim, and skipWaiting only inside the SKIP_WAITING message branch", () => {
    const code = source.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(code).not.toMatch(/clients\.claim/);
    const calls = [...code.matchAll(/skipWaiting\(\)/g)];
    expect(calls).toHaveLength(1);
    expect(code).toMatch(/type === "SKIP_WAITING"\)\s*self\.skipWaiting\(\)/);
  });
  it("has a real, non-empty fetch handler", () => {
    expect(source).toMatch(/addEventListener\("fetch",\s*\(event\)\s*=>\s*\{[\s\S]*respondWith/);
  });
  it("names the caches beachday-shell-<VERSION> and beachday-data-v1", () => {
    const h = makeHarness({ fetchImpl: offline });
    expect(h.SHELL_CACHE).toBe(`beachday-shell-${VERSION}`);
    expect(h.DATA_CACHE).toBe("beachday-data-v1");
  });
  it("shell list: never holds Console, vendor, generated, version, sw or api paths", () => {
    const { SHELL_URLS } = makeHarness({ fetchImpl: offline });
    for (const u of SHELL_URLS) expect(u, u).not.toMatch(/^\/(api\/|sw\.js|version\.json|generated\/|vendor\/|console|js\/console\/)/);
    expect(new Set(SHELL_URLS).size).toBe(SHELL_URLS.length);
    for (const u of ["/", "/how-it-works/", "/resources/", "/guide/", "/offline.html", "/manifest.webmanifest"]) expect(SHELL_URLS).toContain(u);
  });
  it("every SHELL file exists under public/", () => {
    const { SHELL_URLS } = makeHarness({ fetchImpl: offline });
    const missing = SHELL_URLS.filter((u) => {
      const p = u.endsWith("/") ? u + "index.html" : u;
      return !existsSync(join(publicDir, p));
    });
    expect(missing).toEqual([]);
  });
  it("SHELL covers every module and stylesheet the beach page loads (static import graph from /js/app.js and index.html)", () => {
    const { SHELL_URLS } = makeHarness({ fetchImpl: offline });
    const seen = new Set();
    const walk = (url) => {
      if (seen.has(url)) return;
      seen.add(url);
      const src = readFileSync(join(publicDir, url), "utf8");
      for (const m of src.matchAll(/(?:import|export)[^"';]*?from\s*["']([^"']+)["']/g)) {
        const spec = m[1];
        walk(spec.startsWith("/") ? spec : new URL(spec, "https://x" + url).pathname);
      }
    };
    walk("/js/app.js");
    const html = readFileSync(join(publicDir, "index.html"), "utf8");
    const css = [...html.matchAll(/rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]);
    for (const u of [...seen, ...css]) expect(SHELL_URLS, u).toContain(u);
    for (const u of seen) expect(u).not.toMatch(/^\/(vendor|generated|js\/console)\//); // the beach app never loads auth code
  });
});

describe("sw.js behaviour (vm harness)", () => {
  it("install precaches every SHELL url into the versioned cache and does not skipWaiting", async () => {
    const h = makeHarness({ fetchImpl: offline });
    h.fire("install", {});
    await Promise.all(h.waits);
    const stored = [...h.stores.get(h.SHELL_CACHE).keys()];
    expect(stored).toEqual(h.SHELL_URLS.map((u) => new URL(u, ORIGIN).href));
    expect(h.skipWaitingCalls).toBe(0);
  });

  it("activate deletes old shell caches and keeps the data cache", async () => {
    const h = makeHarness({ fetchImpl: offline });
    await h.caches.open("beachday-shell-old1"); await h.caches.open("beachday-data-v1"); await h.caches.open(h.SHELL_CACHE);
    h.fire("activate", {});
    await Promise.all(h.waits);
    expect([...h.stores.keys()].sort()).toEqual(["beachday-data-v1", h.SHELL_CACHE].sort());
  });

  it("SKIP_WAITING is a message; other messages do nothing", () => {
    const h = makeHarness({ fetchImpl: offline });
    h.fire("message", { data: { type: "nope" } });
    expect(h.skipWaitingCalls).toBe(0);
    h.fire("message", { data: { type: "SKIP_WAITING" } });
    expect(h.skipWaitingCalls).toBe(1);
  });

  it.each([
    "/api/chat", "/api/agents", "/sw.js", "/version.json", "/generated/config.js", "/vendor/supabase-auth-js-2.119.2.mjs",
    "/console", "/console.html", "/js/console/main.js", "/console/",
  ])("never intercepts %s", (path) => {
    const h = makeHarness({ fetchImpl: offline });
    expect(h.fetchEvent(ORIGIN + path, { mode: path.startsWith("/console") ? "navigate" : "cors" })).toBeUndefined();
  });

  it("never intercepts Supabase hosts, other cross-origin requests or non-GET", () => {
    const h = makeHarness({ fetchImpl: offline });
    expect(h.fetchEvent("https://bdlocaltest.supabase.co/auth/v1/token")).toBeUndefined();
    expect(h.fetchEvent("https://example.com/x.js")).toBeUndefined();
    expect(h.fetchEvent(ORIGIN + "/", { method: "POST" })).toBeUndefined();
    expect(h.fetchEvent("https://api.open-meteo.com/v1/forecast", { method: "POST" })).toBeUndefined();
  });

  it("nothing from /api, /sw.js or the Supabase host is ever written to any cache", async () => {
    const h = makeHarness({ fetchImpl: () => Promise.resolve(new Response("{}", { status: 200 })) });
    h.fire("install", {}); await Promise.all(h.waits);
    for (const p of ["/api/chat", "/sw.js", "/version.json", "/generated/config.js", "/vendor/x.mjs", "/js/console/main.js"]) h.fetchEvent(ORIGIN + p);
    h.fetchEvent("https://x.supabase.co/auth/v1/user");
    await Promise.all(h.waits);
    for (const [, store] of h.stores) for (const k of store.keys()) expect(new URL(k).pathname + new URL(k).host).not.toMatch(/^\/(api\/|sw\.js|version\.json|generated|vendor|console|js\/console)|supabase/);
  });

  it("navigation: network first; offline serves the shell with ignoreSearch (start_url has ?source=pwa)", async () => {
    const h = makeHarness({ fetchImpl: offline });
    h.fire("install", {}); await Promise.all(h.waits);
    const res = await h.fetchEvent(ORIGIN + "/?source=pwa", { mode: "navigate" });
    expect(await res.text()).toBe("shell:" + ORIGIN + "/");
    expect(h.matchCalls.some((c) => c.opts.ignoreSearch === true)).toBe(true);
    expect(await (await h.fetchEvent(ORIGIN + "/guide", { mode: "navigate" })).text()).toBe("shell:" + ORIGIN + "/guide/");
    expect(await (await h.fetchEvent(ORIGIN + "/how-it-works/", { mode: "navigate" })).text()).toBe("shell:" + ORIGIN + "/how-it-works/");
  });

  it("navigation online uses the network, not the cache", async () => {
    const h = makeHarness({ fetchImpl: () => Promise.resolve(new Response("fresh")) });
    h.fire("install", {}); await Promise.all(h.waits);
    expect(await (await h.fetchEvent(ORIGIN + "/", { mode: "navigate" })).text()).toBe("fresh");
  });

  it("shell assets are cache-first with ignoreSearch", async () => {
    const h = makeHarness({ fetchImpl: offline });
    h.fire("install", {}); await Promise.all(h.waits);
    const res = await h.fetchEvent(ORIGIN + "/js/app.js?v=1", { destination: "script" });
    expect(await res.text()).toBe("shell:" + ORIGIN + "/js/app.js");
  });

  it("cache-first reads only its own version's shell cache, not another version's", async () => {
    const h = makeHarness({ fetchImpl: () => Promise.resolve(new Response("network")) });
    const other = await h.caches.open("beachday-shell-newer");
    await other.put(ORIGIN + "/js/app.js", new Response("from-newer-cache"));
    expect(await (await h.fetchEvent(ORIGIN + "/js/app.js", { destination: "script" })).text()).toBe("network");
    h.fire("install", {}); await Promise.all(h.waits);
    expect(await (await h.fetchEvent(ORIGIN + "/js/app.js", { destination: "script" })).text()).toBe("shell:" + ORIGIN + "/js/app.js");
  });

  it("Open-Meteo: network response is cached with a fetched-at stamp, and served from cache when offline", async () => {
    let online = true;
    const h = makeHarness({ fetchImpl: () => (online ? Promise.resolve(new Response('{"ok":1}', { headers: { "content-type": "application/json" } })) : offline()) });
    const url = "https://api.open-meteo.com/v1/forecast?latitude=25.78&longitude=-80.13";
    const first = await h.fetchEvent(url);
    expect(await first.json()).toEqual({ ok: 1 });
    await Promise.all(h.waits);
    const stored = h.stores.get("beachday-data-v1").get(url);
    expect(Number(stored.headers.get("x-bd-fetched-at"))).toBeGreaterThan(0);
    online = false;
    const second = await h.fetchEvent(url);
    expect(second.headers.get("x-bd-source")).toBe("cache");
    expect(await second.json()).toEqual({ ok: 1 });
    expect(second.headers.get("x-bd-fetched-at")).toBe(stored.headers.get("x-bd-fetched-at"));
  });

  it("Open-Meteo: marine host is handled the same way; errors and non-OK are not cached", async () => {
    const h = makeHarness({ fetchImpl: () => Promise.resolve(new Response("nope", { status: 500 })) });
    const url = "https://marine-api.open-meteo.com/v1/marine?latitude=25.78";
    const res = await h.fetchEvent(url);
    expect(res.status).toBe(500);
    await Promise.all(h.waits);
    expect(h.stores.get("beachday-data-v1").size).toBe(0);
  });

  it("Open-Meteo: after 4 s with no answer the cached copy is served", async () => {
    vi.useFakeTimers();
    let slow = false;
    const h = makeHarness({ fetchImpl: () => (slow ? new Promise(() => {}) : Promise.resolve(new Response('{"v":1}'))) });
    const url = "https://api.open-meteo.com/v1/forecast?x=1";
    await h.fetchEvent(url); await Promise.all(h.waits);
    slow = true;
    const pending = h.fetchEvent(url);
    let settled = false; pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(3999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const res = await pending;
    expect(res.headers.get("x-bd-source")).toBe("cache");
  });

  it("Open-Meteo: nothing cached and offline is a network error, not a fake answer", async () => {
    const h = makeHarness({ fetchImpl: offline });
    const res = await h.fetchEvent("https://api.open-meteo.com/v1/forecast?x=2");
    expect(res.type).toBe("error");
  });

  it("data cache is trimmed to 20 entries", async () => {
    const h = makeHarness({ fetchImpl: () => Promise.resolve(new Response("{}")) });
    for (let i = 0; i < 25; i++) { await h.fetchEvent(`https://api.open-meteo.com/v1/forecast?i=${i}`); await Promise.all(h.waits); }
    expect(h.stores.get("beachday-data-v1").size).toBe(20);
  });
});
