/* Beach Day service worker (docs/02 §5; knowledge/pwa-mobile-engineer/examples/02-service-worker).
 * - Precache the app shell into a versioned cache on install. No automatic skipWaiting: the page asks for it
 *   (message SKIP_WAITING) after the user taps Refresh.
 * - Open-Meteo (api./marine-api.open-meteo.com): network-first with a 4 s timeout, then beachday-data-v1.
 * - NEVER intercepted or cached (network-only): /api/*, /sw.js, /version.json, /generated/*, /vendor/*, /console,
 *   /console.html, /js/console/*, the Supabase host. Console assets are deliberately not in SHELL (stale auth client risk).
 * - Imports: none. sw.js may import only from /sw/** (deny-listed, human-only).
 * - The build stamps the version below from COMMIT_REF so every deploy changes this file's bytes (URL stays /sw.js).
 */
const VERSION = "__BUILD_VERSION__";
const SHELL_CACHE = `beachday-shell-${VERSION}`;
const DATA_CACHE = "beachday-data-v1";

// App shell. Keep every entry real: one 404 here fails the install and the old version stays (docs/03).
// PENDING W2: add the js/ui/* modules and any page-specific CSS once those files exist.
const SHELL_URLS = [
  "/",
  "/how-it-works/",
  "/resources/",
  "/guide/",
  "/offline.html",
  "/manifest.webmanifest",
  "/css/tokens.css",
  "/css/base.css",
  "/css/glass.css",
  "/css/components.css",
  "/img/sprite.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon-180.png",
  "/js/app.js",
  "/js/forecast.js",
  "/js/score.js",
  "/js/score-config.js",
  "/js/api/openmeteo.js",
  "/js/data/beaches.js",
  "/js/data/beach-window.js",
  "/js/data/cache-age.js",
  "/js/copy/copy-deck.js",
  "/js/pwa/install-hint.js",
  "/js/pwa/sw-register.js",
];

const DATA_HOSTS = new Set(["api.open-meteo.com", "marine-api.open-meteo.com"]);
const NETWORK_ONLY_PATHS = ["/sw.js", "/version.json", "/console", "/console.html"];
const NETWORK_ONLY_PREFIXES = ["/api/", "/generated/", "/vendor/", "/js/console/", "/console/"];
const isSupabaseHost = (h) => h.endsWith(".supabase.co") || h.endsWith(".supabase.in"); // UNVERIFIED: a custom Supabase domain would need adding
const NETWORK_TIMEOUT_MS = 4000;
const DATA_CACHE_MAX_ENTRIES = 20;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      // cache: "reload" bypasses the HTTP cache so the new shell really is new.
      cache.addAll(SHELL_URLS.map((u) => new Request(u, { cache: "reload" })))
    )
  );
  // Deliberately no skipWaiting() here.
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith("beachday-shell-") && k !== SHELL_CACHE).map((k) => caches.delete(k)))
    )
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
  if (event.data && event.data.type === "GET_VERSION" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // POSTs (e.g. /api/chat) go straight to the network
  const url = new URL(request.url);

  if (isSupabaseHost(url.hostname)) return; // auth traffic: never touched
  if (
    url.origin === self.location.origin &&
    (NETWORK_ONLY_PATHS.includes(url.pathname) || NETWORK_ONLY_PREFIXES.some((p) => url.pathname.startsWith(p)))
  ) {
    return; // network-only: not intercepted, never cached (keeps the beach shell from answering /console offline)
  }
  if (DATA_HOSTS.has(url.hostname)) {
    event.respondWith(networkFirstWithTimeout(event, request));
    return;
  }
  if (url.origin !== self.location.origin) return; // any other cross-origin request: not intercepted
  if (request.mode === "navigate") {
    event.respondWith(navigation(request));
    return;
  }
  if (request.destination === "image") {
    event.respondWith(staleWhileRevalidate(event, request));
    return;
  }
  event.respondWith(cacheFirst(request));
});

async function networkFirstWithTimeout(event, request) {
  const cache = await caches.open(DATA_CACHE);
  const network = fetch(request).then(async (response) => {
    // Only readable, successful CORS responses are cached (Open-Meteo sends CORS headers).
    if (response.ok && response.type !== "opaque") {
      await cache.put(request, await stamp(response.clone()));
      await trim(cache, DATA_CACHE_MAX_ENTRIES);
    }
    return response;
  });
  // Even after answering from cache on a timeout, let the network finish and refresh the cache.
  event.waitUntil(network.catch(() => {}));

  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve("timeout"), NETWORK_TIMEOUT_MS); });
  try {
    const winner = await Promise.race([network, timeout]);
    if (winner !== "timeout") return winner;
  } catch {
    /* network error: fall through to the cache */
  } finally {
    clearTimeout(timer);
  }
  const cached = await cache.match(request);
  if (cached) return markSource(cached, "cache");
  return network.catch(() => Response.error()); // nothing cached: wait for the network after all
}

async function navigation(request) {
  try {
    return await fetch(request);
  } catch {
    const shell = await caches.open(SHELL_CACHE);
    const url = new URL(request.url);
    const withSlash = url.pathname.endsWith("/") ? null : url.pathname + "/"; // /guide -> /guide/
    return (
      (await shell.match(request, { ignoreSearch: true })) ||
      (withSlash && (await shell.match(withSlash))) ||
      (await shell.match("/")) ||
      (await shell.match("/offline.html")) ||
      Response.error()
    );
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  return fetch(request); // not precached: plain network (a failure is a normal network error)
}

async function staleWhileRevalidate(event, request) {
  const cache = await caches.open(SHELL_CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const refresh = fetch(request).then(async (response) => {
    if (response.ok && response.type === "basic") await cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }
  return refresh;
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
