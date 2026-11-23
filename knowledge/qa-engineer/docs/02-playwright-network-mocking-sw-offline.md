# Playwright: network mocking, service workers and offline
Source: https://playwright.dev/docs/mock , https://playwright.dev/docs/network , https://playwright.dev/docs/service-workers , https://playwright.dev/docs/emulation#offline , https://playwright.dev/docs/api/class-browsercontext
Retrieved: 2026-11-23

## Mocking with `page.route` / `context.route`
```js
await page.route("*/**/api/v1/fruits", async (route) => {
  await route.fulfill({ json: [{ name: "Strawberry", id: 21 }] });
});
```
- `route.fulfill({ json })` sends a JSON body. You can also pass `status`, `contentType`, `body` and `headers`. [mock](https://playwright.dev/docs/mock)
- **Patch a real response:** `const response = await route.fetch(); const json = await response.json(); ... await route.fulfill({ response, json })`. [mock](https://playwright.dev/docs/mock)
- **HAR files:**
  - `page.routeFromHAR(path, { url, update })` serves recorded responses.
  - `update: true` records new data into the HAR.
  - Unmatched requests can be aborted.
  - [mock](https://playwright.dev/docs/mock)
- `route.abort()` and `route.continue()` are also available. Their details weren't re-read here; see [network](https://playwright.dev/docs/network).

### Glob rules
Source for every bullet: [network § glob](https://playwright.dev/docs/network#glob-url-patterns)
- `*` matches any characters except `/`. `**` matches any characters, including `/`.
- `{a,b}` matches either option.
- `?` is a **literal question mark**. Use `*` to match "any character".
- "The glob pattern must match the entire URL, not just a part of it."
- So the Open-Meteo pattern must cover the query string: `https://api.open-meteo.com/v1/forecast?**`. `https://api.open-meteo.com/**` also works.

## Service workers vs routing
- "Service workers are only supported on Chromium-based browsers." [service workers](https://playwright.dev/docs/service-workers)
- Requests the page makes that a service worker's `fetch` handler serves are **not routable** with `page.route`. Only the service worker's own outgoing requests are, through `context.route`, where `route.request().serviceWorker()` is set. [service workers](https://playwright.dev/docs/service-workers)
- If network events seem to be missing, set the context option `serviceWorkers: 'block'`. MSW in the browser also registers its own service worker, which hides requests from `route()`. [network](https://playwright.dev/docs/network)
- **Readiness:**
  - `context.waitForEvent('serviceworker')` fires **before** the service worker controls the page.
  - Wait for activation, for example `navigator.serviceWorker` `controllerchange`, before relying on it.
  - `context.serviceWorkers()` lists the service workers.
  - [service workers](https://playwright.dev/docs/service-workers)
- `response.fromServiceWorker()` is `true` when the service worker's `fetch` handler served the response. [service workers](https://playwright.dev/docs/service-workers)
- **Known limitation:** "Requests for updated Service Worker main script code currently cannot be routed." [service workers](https://playwright.dev/docs/service-workers)

## Offline
- Set `offline: true` in `use` or `newContext`. At runtime, call `context.setOffline(true)`. Both affect normal browser network traffic. [emulation § offline](https://playwright.dev/docs/emulation#offline), [BrowserContext](https://playwright.dev/docs/api/class-browsercontext)
- How `setOffline` interacts with a service worker's own fetches wasn't stated on the pages read **[UNVERIFIED]**. The offline spec should assert what the user sees (cached verdict plus offline banner), not internal requests.

## Beach Day notes
- **Data and UI specs:**
  - Use `serviceWorkers: "block"`.
  - Mock Open-Meteo with `page.route("https://api.open-meteo.com/**", r => r.fulfill({ json }))`, and mock Marine the same way.
  - Use **real fixtures** captured from the API. Example 01 does this.
- **Never let a test reach real Claude or GitHub.**
  - Mock `/api/*` with `page.route("**/api/**", ...)` and Claude SSE bodies with `route.fulfill({ body, contentType: "text/event-stream" })`.
  - Add a request guard that fails on unexpected hosts. Example 01 records the hosts in `beforeEach` and asserts them in `afterEach`.
- **Offline spec** (Chromium project, service workers allowed):
  1. Load the page with a mocked forecast.
  2. Wait until `navigator.serviceWorker.controller` is set.
  3. Call `context.setOffline(true)` and reload.
  4. Assert the cached verdict text and the offline banner.
  5. Assert that `/api/*` is never served from cache. The service worker must not cache it.
- SW update flow: because "updated SW main script" requests can't be routed, test updates by serving a new `sw.js` from the local test server, not by routing it.
- **Error paths:**
  - `429` and `400 {"error":true,"reason":...}` from Open-Meteo must show a friendly text, not a blank page. Example 01 covers the `429`.
  - Test a `429` from `/api/chat` the same way. That is the Netlify rate-limit response.
