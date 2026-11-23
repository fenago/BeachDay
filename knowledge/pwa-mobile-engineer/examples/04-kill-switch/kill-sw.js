/* Beach Day EMERGENCY kill-switch service worker. Self-contained: no imports, no fetch handler.
 * Ship it as /sw.js only when a bad service worker keeps phones on a broken shell.
 * install : activate immediately (skip waiting).
 * activate: delete every cache, unregister this worker, reload every controlled tab/app window.
 * With no fetch handler and the registration gone, all requests go straight to the network.
 */
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) await caches.delete(key);
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      await self.registration.unregister();
      for (const client of clients) {
        try { await client.navigate(client.url); } catch { /* client gone or cross-origin: ignore */ }
      }
    })()
  );
});
