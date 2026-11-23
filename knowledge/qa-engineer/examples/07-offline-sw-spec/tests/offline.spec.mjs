// Offline and service-worker spec (Chromium only). The pages and sw.js are stand-ins; the assertions are the ones the real
// spec must make (docs/06 §4.2): shell for /?source=pwa offline, Console and vendor files fail offline, sw.js and
// version.json (and /api, Supabase, /generated) never in Cache Storage, update flow, 14-day install-hint snooze.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const forecast = JSON.parse(readFileSync(new URL("../../01-playwright-mobile-mock/fixtures/forecast-miami-beach-2026-11-23.json", import.meta.url), "utf8"));
const OPEN_METEO = "https://api.open-meteo.com/**";
const SITE = "http://127.0.0.1:4174";
const post = (path) => fetch(`${SITE}${path}`, { method: "POST" });

test.beforeEach(async ({ context }) => {
  await post("/__deploy?v=v1"); await post("/__mutant?kind=");
  await context.route(OPEN_METEO, (route) => route.fulfill({ json: forecast })); // the SW's own fetch is routed here
});

// Register, wait for activation, reload so the page is controlled (the SW does not claim clients on first install).
async function installed(page) {
  await page.goto("/?source=pwa");
  await expect(page.getByRole("status").first()).toContainText("Feels like");
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}
const cacheContents = (page) => page.evaluate(async () => Object.fromEntries(await Promise.all((await caches.keys()).map(async (k) => [k, (await (await caches.open(k)).keys()).map((r) => { const u = new URL(r.url); return u.host + u.pathname; })]))));
const NEVER_CACHED = [/\/sw\.js$/, /\/version\.json$/, /\/api\//, /\/console/, /\/vendor\//, /\/generated\//, /supabase\.co/, /\/js\/console\//];
const forbiddenInCaches = async (page) => Object.entries(await cacheContents(page)).flatMap(([cache, keys]) => keys.filter((k) => NEVER_CACHED.some((re) => re.test(k))).map((k) => `${cache}: ${k}`));

test("installs: shell precached under a versioned name, forecast cached; network-only paths stay out of Cache Storage even after being fetched", async ({ page }) => {
  await installed(page);
  // Touch every network-only path while online, as a user would.
  for (const p of ["/version.json", "/api/agents", "/vendor/auth.mjs", "/console.html", "/sw.js", "/generated/config.js"]) await page.evaluate((u) => fetch(u).catch(() => {}), p);
  await page.goto("/console"); await page.goto("/?source=pwa");
  const caches_ = await cacheContents(page);
  expect(Object.keys(caches_).sort()).toEqual(["beachday-data-v1", "beachday-shell-v1"]);
  expect(caches_["beachday-shell-v1"].sort()).toEqual(["127.0.0.1:4174/", "127.0.0.1:4174/app.js", "127.0.0.1:4174/hint.js", "127.0.0.1:4174/offline.html"]);
  expect(caches_["beachday-data-v1"]).toHaveLength(1);
  expect(await forbiddenInCaches(page)).toEqual([]);
});

test("offline: /?source=pwa (the installed start_url) gets the cached shell and the last forecast with an offline banner", async ({ page, context }) => {
  await installed(page);
  await context.setOffline(true);
  const res = await page.goto("/?source=pwa");
  expect(res.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("heading", { name: "Beach Day" })).toBeVisible();
  await expect(page.locator("#out")).toContainText("Feels like");
  await expect(page.locator("#banner")).toContainText(/^Offline — showing data from \d\d:\d\d UTC$/);
});

test("offline: /console, /vendor/*, /sw.js, /version.json and /api/* fail with a network error and never return the beach shell", async ({ page, context }) => {
  await installed(page);
  await context.setOffline(true);
  for (const p of ["/vendor/auth.mjs", "/sw.js", "/version.json", "/api/agents", "/generated/config.js"]) {
    expect(await page.evaluate((u) => fetch(u).then((r) => `status ${r.status}`, () => "network error"), p), p).toBe("network error");
  }
  await expect(page.goto("/console")).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
  await expect(page.goto("/console.html")).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
});

test("offline: the SW's own Open-Meteo fetch fails when the context is offline, even though page.route would answer (observed behaviour)", async ({ page, context }) => {
  await installed(page);
  let routed = 0;
  await context.route(OPEN_METEO, (route) => { routed++; return route.fulfill({ json: forecast }); });
  await context.setOffline(true);
  await page.goto("/?source=pwa");
  await expect(page.locator("#banner")).toContainText("Offline — showing data from"); // came from Cache Storage
  console.log(`  routed Open-Meteo requests while offline: ${routed}`);
  expect(routed).toBe(0);
});

test("update flow: a new deploy changes sw.js bytes; the new worker waits; SKIP_WAITING swaps it; the old shell cache is deleted", async ({ page }) => {
  await installed(page);
  const v1 = await page.evaluate(() => fetch("/sw.js").then((r) => r.text()));
  expect(v1).toContain('const VERSION = "v1"');
  expect(v1).not.toContain("__BUILD_VERSION__");
  await post("/__deploy?v=v2");
  const v2 = await page.evaluate(() => fetch("/sw.js").then((r) => r.text()));
  expect(v2).toContain('const VERSION = "v2"');
  expect(v2).not.toBe(v1);
  await page.evaluate(async () => { const reg = await navigator.serviceWorker.getRegistration(); await reg.update(); });
  await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting)).toBe(true);
  expect(Object.keys(await cacheContents(page)).sort()).toEqual(["beachday-data-v1", "beachday-shell-v1", "beachday-shell-v2"]); // v1 still serves until the user taps Refresh
  const changed = page.evaluate(() => new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", () => r(true), { once: true })));
  await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting.postMessage({ type: "SKIP_WAITING" }));
  expect(await changed).toBe(true);
  await expect.poll(async () => Object.keys(await cacheContents(page)).sort()).toEqual(["beachday-data-v1", "beachday-shell-v2"]);
});

// Do the assertions above have teeth? Plant the two bugs they exist to catch.
test("mutant: a SW that forgets ignoreSearch serves offline.html for /?source=pwa, and the shell assertion would fail", async ({ page, context }) => {
  await post("/__mutant?kind=no-ignore-search");
  await installed(page);
  await context.setOffline(true);
  await page.goto("/?source=pwa");
  await expect(page.getByRole("heading", { name: "You're offline" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Beach Day" })).toHaveCount(0);
});
test("mutant: a SW that precaches the Console, the vendored auth client and version.json is caught by the Cache Storage check", async ({ page }) => {
  await post("/__mutant?kind=precache-console");
  await installed(page);
  const bad = await forbiddenInCaches(page);
  console.log(`  caught: ${bad.join(" | ")}`);
  expect(bad.length).toBeGreaterThanOrEqual(3);
});

// ---- 14-day snooze of the iPhone install hint, with a fake clock ----
test.describe("install hint snooze", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1" });
  const T0 = new Date("2026-11-23T15:00:00Z");
  const at = (ms) => new Date(T0.getTime() + ms);
  const DAY = 24 * 3600_000;

  test("hidden until exactly 14 days have passed, then shown again", async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto("/");
    const hint = page.getByRole("dialog", { name: "Add to Home Screen" });
    await expect(hint).toBeVisible();
    await page.getByRole("button", { name: "Not now" }).click();
    await expect(hint).toBeHidden();
    for (const [label, when, shown] of [["1 hour later", at(3600_000), false], ["13 days 23 h 59 min 59.999 s", at(14 * DAY - 1), false], ["exactly 14 days", at(14 * DAY), true]]) {
      await page.clock.setFixedTime(when);
      await page.reload();
      if (shown) await expect(hint, label).toBeVisible(); else await expect(hint, label).toBeHidden();
    }
  });
  test("not shown when launched standalone (installed app)", async ({ page }) => {
    await page.emulateMedia({ media: null }).catch(() => {});
    await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
    await page.goto("/");
    await expect(page.getByRole("dialog", { name: "Add to Home Screen" })).toBeHidden();
  });
});
