# Caching strategies for the Beach Day service worker
Source: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching
Source: https://web.dev/articles/service-worker-lifecycle (versioned caches, cleanup in activate)
Retrieved: 2026-11-23

## Strategies as MDN describes them
**Cache first (with precaching)** — for resources "that the PWA is certain to need, that will not change for this version of the app, and that need to be fetched as quickly as possible", e.g. the UI shell.
- Precache in `install` with `event.waitUntil(cache.addAll([...]))`: "if caching fails for any reason, the installation of the service worker fails".
- In `fetch`: return `caches.match(request)` if found, else network; if `networkResponse.ok`, `cache.put(request, networkResponse.clone())`.
- Still fall back to the network for precached files because "it is possible for the cache to be cleared, either by the browser or by the user."
- "If we don't call `respondWith()` for a given request, then the request is sent to the network as if the service worker had not intercepted it."
- Clone rule: "we must clone the response and add the copy to the cache, returning the original. This is because Response objects are streamable, so may only be read once."

**Cache first with cache refresh** (= stale-while-revalidate) — always fetch in the background to refresh; answer from cache if present. "A good choice when responsiveness is important, and freshness is somewhat important but not essential."

**Network first** — "try to retrieve the resource from the network. If the network request succeeds, we return the response and update the cache. If it fails, we try the cache." For data where freshness matters "but for which a cached resource is better than nothing".

**Network only** — "There are still requests for which no response is better than a possibly-outdated response".

**Quota / eviction**: "Caches have a limited amount of storage space, and the browser may evict an app's cached data if the limit is exceeded … In practice, eviction of cached data is a very rare event. The user can also clear an app's cache at any time."
**Cleanup**: delete old cache versions in `activate`, when "no previous versions of the service worker are running".

MDN's network-first example has **no timeout**: on a slow (not failed) connection the user waits for the network. Beach Day adds one.

## Beach Day mapping (pwa-manifest-service-worker skill)
| Request | Strategy | Cache |
|---|---|---|
| App shell: `/`, `/app.js`, CSS, icons, `/offline.html`, `/manifest.webmanifest` (match with `ignoreSearch: true`, because `start_url` is `/?source=pwa`) | Precache on install, cache-first | `beachday-shell-${VERSION}` (deleted on activate when version changes) |
| `api.open-meteo.com`, `marine-api.open-meteo.com` | Network-first, **4 s timeout**, then cache; stamp `x-bd-fetched-at` | `beachday-data-v1` (survives deploys; trimmed to 20 entries) |
| Same-origin `/api/*` (Netlify Functions: Console chat, proposals, approve; all carry a Supabase bearer token) | **Network-only; not intercepted; never cached** | — |
| Non-GET (POST `/api/chat`, etc.) | Not intercepted | — |
| Navigations | Network; offline → cached shell → `offline.html` | shell |
| Other images | Stale-while-revalidate (not in the example) | shell or separate |

## Network-first with timeout — shape (from examples/02-service-worker/public/sw.js)
```js
async function networkFirstWithTimeout(event, request) {
  const cache = await caches.open("beachday-data-v1");
  const network = fetch(request).then(async (res) => {
    if (res.ok && res.type !== "opaque") await cache.put(request, await stamp(res.clone()));
    return res;
  });
  event.waitUntil(network.catch(() => {}));           // keep refreshing even after we answered from cache
  const timeout = new Promise((r) => setTimeout(() => r("timeout"), 4000));
  try { const w = await Promise.race([network, timeout]); if (w !== "timeout") return w; } catch {}
  const cached = await cache.match(request);
  return cached ? markSource(cached, "cache") : network.catch(() => Response.error());
}
```
Notes:
- Only cache `ok`, non-opaque responses. Open-Meteo answers with CORS headers so the browser's `fetch` gets a readable (`cors`) response **[UNVERIFIED on the Open-Meteo docs pages; observed behaviour and stated in docs/README.md of this repo]**.
- Re-wrapping a Response (`new Response(await res.blob(), {status, statusText, headers})`) is how we add `x-bd-fetched-at`; the UI uses it for "Updated 8:15 am" / "Offline — showing data from 8:15 am".
- `event.waitUntil(network)` lets the late network response refresh the cache after a timeout answer.
- Playwright proved: slow upstream (6 s) → cached answer at ~4.0 s; offline reload → shell + cached forecast.

## What never to cache
- `/api/*` — Console bearer-authenticated responses, chat streams, approve results. Caching them could replay authenticated data offline or to another user on a shared device. The server also sends `Cache-Control: no-store`.
- Responses with `Set-Cookie` or `Authorization`-dependent content (every Console request carries an `Authorization` header).
- Opaque cross-origin responses (status unknown; can fill quota).

## Storage size and persistence
- Keep `beachday-data-v1` small: latest response per beach (favourites); trim by count.
- Ask `navigator.storage.persist()` after install (skill rule); the browser may still evict (MDN quota page linked from the caching guide).

## Beach Day notes
- ADR-0001: there is no server-side weather cache — this SW data cache + the app's 30-minute staleness rule (open-meteo-integrator `examples/03-cache-age`) is the whole caching layer.
- Changing strategies for `/api/*` requires security-engineer review; changing `_headers` requires security-engineer + netlify-engineer.
- Attribution text lives in the shell HTML so it is visible offline too (CLAUDE.md rule).
