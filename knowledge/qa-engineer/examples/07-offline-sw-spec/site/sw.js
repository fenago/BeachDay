// TEST DOUBLE of the service worker plan in docs/02 §5 (the real public/sw.js does not exist yet).
const VERSION = "__BUILD_VERSION__";
const SHELL = `beachday-shell-${VERSION}`, DATA = "beachday-data-v1";
const PRECACHE = ["/", "/app.js", "/hint.js", "/offline.html"];
const NETWORK_ONLY = (u) => u.pathname === "/sw.js" || u.pathname === "/version.json" || u.pathname.startsWith("/api/") || u.pathname.startsWith("/generated/") ||
  u.pathname === "/console" || u.pathname === "/console.html" || u.pathname.startsWith("/js/console/") || u.pathname.startsWith("/vendor/") || u.hostname.endsWith(".supabase.co");

self.addEventListener("install", (e) => e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE))));
self.addEventListener("activate", (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k.startsWith("beachday-shell-") && k !== SHELL) await caches.delete(k);
})()));
self.addEventListener("message", (e) => { if (e.data?.type === "SKIP_WAITING") self.skipWaiting(); });

async function networkFirst(req) {
  const cache = await caches.open(DATA);
  try {
    const res = await fetch(req, { signal: AbortSignal.timeout(4000) });
    if (res.ok) { await cache.put(req, new Response(await res.clone().blob(), { headers: { "content-type": "application/json", "x-fetched-at": new Date().toISOString().slice(11, 16) + " UTC" } })); return res; }
  } catch { /* fall through to the cache */ }
  const hit = await cache.match(req);
  if (!hit) return Response.error();
  const h = new Headers(hit.headers); h.set("x-from-cache", "1");
  return new Response(await hit.blob(), { headers: h });
}

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || NETWORK_ONLY(url)) return;                     // not intercepted: the browser's own network error offline
  if (url.hostname.endsWith("open-meteo.com")) return e.respondWith(networkFirst(req));
  if (req.mode === "navigate") return e.respondWith(fetch(req).catch(async () => (await caches.match("/", { ignoreSearch: true })) ?? caches.match("/offline.html")));
  e.respondWith(caches.match(req, { ignoreSearch: true }).then((r) => r ?? fetch(req)));
});
