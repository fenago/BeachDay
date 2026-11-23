/* Beach Day service worker (reference example).
 * - Precache the app shell into a versioned cache on install (no automatic skipWaiting).
 * - Open-Meteo (api./marine-api.open-meteo.com): network-first with a 4 s timeout, fall back to cache.
 * - Same-origin /api/* (Netlify Functions for the Agent Console): network-only, never cached.
 * - Navigations: network-first, offline -> cached shell -> offline.html.
 * - Other same-origin GETs: cache-first (shell assets).
 * - Update flow: page shows "New version — Refresh", posts {type:"SKIP_WAITING"}; we then skipWaiting().
 * The build replaces __BUILD_VERSION__ so every deploy changes this file's bytes (stable URL /sw.js).
 */
const VERSION = "__BUILD_VERSION__";
const SHELL_CACHE = `beachday-shell-${VERSION}`;
const DATA_CACHE = "beachday-data-v1";
const SHELL_URLS = ["/", "/app.js", "/offline.html", "/manifest.webmanifest"];
const DATA_HOSTS = new Set(["api.open-meteo.com", "marine-api.open-meteo.com"]);
const NETWORK_TIMEOUT_MS = 4000;
const DATA_CACHE_MAX_ENTRIES = 20;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // cache: "reload" bypasses the HTTP cache so the new shell is really new.
      cache.addAll(SHELL_URLS.map((u) => new Request(u, { cache: "reload" })))
    )
  );
  // Deliberately NOT calling self.skipWaiting() here: the page asks for it after the user taps Refresh.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k.startsWith("beachday-shell-") && k !== SHELL_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data?.type === "GET_VERSION") event.ports[0]?.postMessage({ version: VERSION });
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // POSTs (e.g. /api/chat) go straight to the network
  const url = new URL(request.url);

  if (url.origin === self.location.origin && url.pathname.startsWith("/api/")) {
    return; // network-only: not intercepted, never cached
  }
  if (DATA_HOSTS.has(url.hostname)) {
    event.respondWith(networkFirstWithTimeout(event, request));
    return;
  }
  if (request.mode === "navigate") {
    event.respondWith(navigation(request));
    return;
  }
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request));
  }
  // Anything else cross-origin: not intercepted.
});

async function networkFirstWithTimeout(event, request) {
  const cache = await caches.open(DATA_CACHE);
  const network = fetch(request).then(async (response) => {
    // Only cache readable, successful CORS responses (Open-Meteo sends CORS headers).
    if (response.ok && response.type !== "opaque") {
      const stamped = await stamp(response.clone());
      await cache.put(request, stamped);
      await trim(cache, DATA_CACHE_MAX_ENTRIES);
    }
    return response;
  });
  // Even if we answer from cache after the timeout, let the network finish and refresh the cache.
  event.waitUntil(network.catch(() => {}));

  const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), NETWORK_TIMEOUT_MS));
  try {
    const winner = await Promise.race([network, timeout]);
    if (winner !== "timeout") return winner;
  } catch {
    /* network error: fall through to cache */
  }
  const cached = await cache.match(request);
  if (cached) return markSource(cached, "cache");
  // No cache: wait for the network after all (or fail).
  return network.catch(() => Response.error());
}

async function navigation(request) {
  try {
    return await fetch(request);
  } catch {
    const shell = await caches.open(SHELL_CACHE);
    return (
      (await shell.match(request, { ignoreSearch: true })) ||
      (await shell.match("/")) ||
      (await shell.match("/offline.html")) ||
      Response.error()
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch {
    return Response.error();
  }
}

// Record when the data left the network so the UI can say "Updated 8:15 am".
async function stamp(response) {
  const headers = new Headers(response.headers);
  headers.set("x-bd-fetched-at", String(Date.now()));
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers });
}

async function markSource(response, source) {
  const headers = new Headers(response.headers);
  headers.set("x-bd-source", source);
  return new Response(await response.blob(), { status: response.status, statusText: response.statusText, headers });
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - max))) await cache.delete(key);
}
