// Offline, service worker and install hint against the REAL public/sw.js (docs/06 §4.3). Project offline-sw only: Pixel 7 in Chromium,
// service workers allowed, one worker. The harness stamps sw.js in memory from its settable version, so two builds = two stamps.
// Trap (observed, example 07): setOffline(true) does not stop a FULFILLING context.route from answering the SW's own fetch,
// so going offline here aborts the Open-Meteo routes first. WebKit is not covered: "iphone (webkit): not run".
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { harnessClient, loadFixture, t, STRINGS } from "../helpers/e2e.mjs";
import { guardHosts, routeOpenMeteo } from "../helpers/openmeteo-routes.mjs";

const SW_SRC = readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8");
const SHELL = [...SW_SRC.slice(SW_SRC.indexOf("const SHELL_URLS"), SW_SRC.indexOf("];", SW_SRC.indexOf("const SHELL_URLS"))).matchAll(/"(\/[^"]*)"/g)].map((m) => m[1]);
const V1 = "build-aaaa1111", V2 = "build-bbbb2222";
const OM = ["https://api.open-meteo.com/**", "https://marine-api.open-meteo.com/**"];
// keys are host+path, so anchor /api/ and /vendor/ at the root (public/js/api/openmeteo.js is a shell file)
const NEVER = [/^[^/]+\/sw\.js$/, /^[^/]+\/version\.json$/, /^[^/]+\/api\//, /^[^/]+\/console/, /^[^/]+\/vendor\//, /^[^/]+\/generated\//, /supabase\.co/, /^[^/]+\/js\/console\//];
const fx = loadFixture("good-derived");

let h, om;
test.beforeEach(async ({ baseURL, context, page }) => {
  h = harnessClient(baseURL);
  await h.reset();
  await h.harness.setVersion({ version: V1 });
  await guardHosts(context, { siteOrigin: baseURL });
  om = await routeOpenMeteo(context, { forecast: fx.forecast, marine: fx.marine });
  await page.addInitScript(() => { try { if (!localStorage.getItem("beachday:beach")) localStorage.setItem("beachday:beach", "miami-beach"); } catch { /* */ } });
});

async function goOffline(context) {
  for (const g of OM) await context.unroute(g).catch(() => {});
  for (const g of OM) await context.route(g, (r) => r.abort("internetdisconnected"));
  await context.setOffline(true);
}
// first visit registers the worker (no claim on first install), reload makes the page controlled
async function installed(page, url = "/?source=pwa") {
  await page.goto(url);
  await expect(page.getByTestId("verdict-card")).toBeVisible();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect(page.getByTestId("verdict-card")).toBeVisible();
  // The first load was not controlled and the reload used the saved forecast, so nothing went through the worker yet:
  // one user-forced refresh does, and fills beachday-data-v1.
  await page.getByTestId("refresh").click();
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).includes("beachday-data-v1") && (await (await caches.open("beachday-data-v1")).keys()).length)).toBeGreaterThan(0);
}
const shiftDays = (obj, n) => JSON.parse(JSON.stringify(obj).replace(/(\d{4})-(\d{2})-(\d{2})/g, (_, y, m, d) => new Date(Date.UTC(+y, +m - 1, +d + n)).toISOString().slice(0, 10)));
const caches_ = (page) => page.evaluate(async () => Object.fromEntries(await Promise.all((await caches.keys()).map(async (k) => [k, (await (await caches.open(k)).keys()).map((r) => { const u = new URL(r.url); return u.host + u.pathname; })]))));
const forbidden = async (page) => Object.entries(await caches_(page)).flatMap(([c, ks]) => ks.filter((k) => NEVER.some((re) => re.test(k))).map((k) => `${c}: ${k}`));

test.describe("install", () => {
  test("shell precached under beachday-shell-<VERSION>, forecast under beachday-data-v1, nothing network-only in Cache Storage", async ({ page, baseURL }) => {
    await installed(page);
    for (const p of ["/version.json", "/api/agents", "/vendor/x.mjs", "/console", "/console.html", "/sw.js", "/generated/config.js", "/js/console/api.js"]) await page.evaluate((u) => fetch(u).catch(() => {}), p);
    const c = await caches_(page);
    expect(Object.keys(c).sort()).toEqual(["beachday-data-v1", `beachday-shell-${V1}`]);
    const host = new URL(baseURL).host;
    expect(c[`beachday-shell-${V1}`].sort()).toEqual(SHELL.map((p) => host + p).sort()); // exactly the SHELL list of public/sw.js
    expect(c["beachday-data-v1"].length).toBeGreaterThanOrEqual(1);
    expect(c["beachday-data-v1"].every((k) => /open-meteo\.com/.test(k))).toBe(true);
    expect(await forbidden(page)).toEqual([]);
  });

  test("the stamped sw.js is served no-cache, has no placeholder, and the version equals /version.json's", async ({ request }) => {
    const sw = await request.get("/sw.js");
    expect(sw.headers()["cache-control"]).toBe("no-cache");
    const body = await sw.text();
    expect(body).not.toContain("__BUILD_VERSION__");
    expect(body).toContain(`const VERSION = "${V1}"`);
    expect((await (await request.get("/version.json")).json()).commit).toBe(V1);
  });
});

test.describe("offline", () => {
  test("the installed start_url /?source=pwa is served by the service worker with the cached forecast and the offline status", async ({ page, context }) => {
    await installed(page);
    await goOffline(context);
    const res = await page.goto("/?source=pwa");
    expect(res.fromServiceWorker()).toBe(true);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(/South Beach/);
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    await expect(page.getByTestId("status")).toContainText(/Offline — showing .* forecast/);
    await expect(page.getByText(t("ui.safety.flags"))).toBeVisible();
    await page.getByTestId("refresh").click({ force: true });
    await expect(page.getByTestId("status")).toHaveText(t("ui.offline.refresh"));
  });

  test("other shell pages work offline (how it works, resources, guide, offline.html)", async ({ page, context }) => {
    await installed(page);
    await goOffline(context);
    for (const [u, h1] of [["/how-it-works/", "How it works"], ["/resources/", "Resources"], ["/guide/", "Step-by-step guide"], ["/offline.html", "You're offline"]]) {
      const res = await page.goto(u);
      expect(res.fromServiceWorker(), u).toBe(true);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(h1);
    }
  });

  test("the Agents page, vendor files, sw.js, version.json, generated config and /api fail with a network error; the beach shell is never shown for them", async ({ page, context }) => {
    await installed(page);
    await goOffline(context);
    for (const p of ["/vendor/supabase-auth-js-2.119.2.mjs", "/sw.js", "/version.json", "/api/agents", "/generated/config.js", "/js/console/api.js"])
      expect(await page.evaluate((u) => fetch(u).then((r) => `status ${r.status}`, () => "network error"), p), p).toBe("network error");
    await expect(page.goto("/console")).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
    await expect(page.goto("/console.html")).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
  });

  test("observed trap: while offline a FULFILLING route still answers the worker's fetch (so offline specs must abort the routes)", async ({ page, context }) => {
    await installed(page);
    await context.setOffline(true);
    const before = om.requests.length;
    await page.getByTestId("refresh").click({ force: true }).catch(() => {}); // the app refuses to refresh offline: drive the worker directly
    const fetched = await page.evaluate((u) => fetch(u).then((r) => r.headers.get("x-bd-source"), () => "network error"), om.requests.find((u) => u.startsWith("https://api.open-meteo.com/")));
    expect(fetched, "the route answered the worker, so the page looked online to it").toBe("network");
    expect(om.requests.length).toBeGreaterThan(before);
    await goOffline(context);
    const after = om.requests.length;
    const cached = await page.evaluate((u) => fetch(u).then((r) => r.headers.get("x-bd-source"), () => "network error"), om.requests.find((u) => u.startsWith("https://api.open-meteo.com/")));
    expect(cached).toBe("cache");
    expect(om.requests.length, "aborted routes still see the request but cannot answer it").toBeGreaterThanOrEqual(after);
  });

  test("network-first has a 4 s timeout: a slow Open-Meteo answer falls back to the cached copy, stamped x-bd-source: cache", async ({ page, context }) => {
    await installed(page);
    const url = om.requests.find((u) => u.startsWith("https://api.open-meteo.com/"));
    expect(url).toBeTruthy();
    await context.unroute(OM[0]);
    await context.route(OM[0], async (r) => { await new Promise((ok) => setTimeout(ok, 6000)); await r.fulfill({ json: fx.forecast }).catch(() => {}); });
    const t0 = Date.now();
    const out = await page.evaluate(async (u) => { const r = await fetch(u); return { src: r.headers.get("x-bd-source"), at: Number(r.headers.get("x-bd-fetched-at")) }; }, url);
    const took = Date.now() - t0;
    expect(out.src).toBe("cache");
    expect(Number.isFinite(out.at) && out.at > 0).toBe(true);
    expect(took).toBeGreaterThanOrEqual(3500);
    expect(took).toBeLessThan(5800);
  });
});

test.describe("update flow", () => {
  test("a new deploy: new bytes, new worker WAITS and the old shell still serves; the toast's Refresh swaps it; one controllerchange; old cache deleted", async ({ page, context, request }) => {
    await page.addInitScript(() => { navigator.serviceWorker?.addEventListener("controllerchange", () => { sessionStorage.cc = String((Number(sessionStorage.cc) || 0) + 1); }); });
    await installed(page);
    const v1 = await (await request.get("/sw.js")).text();
    await h.harness.setVersion({ version: V2 });
    const v2 = await (await request.get("/sw.js")).text();
    expect(v2).not.toBe(v1);
    expect(v2).toContain(`const VERSION = "${V2}"`);
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting)).toBe(true);
    expect(Object.keys(await caches_(page)).sort()).toEqual(["beachday-data-v1", `beachday-shell-${V1}`, `beachday-shell-${V2}`]);
    // mixed window: while the update waits, a reload is served ENTIRELY by the old worker (old HTML and old JS from the old shell cache)
    const served = [];
    page.on("response", (r) => { if (/\/js\/|\/css\/|\.html$|\/$/.test(new URL(r.url()).pathname) && new URL(r.url()).host === new URL(page.url()).host) served.push(r.fromServiceWorker()); });
    await page.reload();
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    expect(served.length).toBeGreaterThan(5);
    expect(served.every(Boolean), "every shell file comes from the controlling (old) worker while an update waits").toBe(true);
    expect(await page.evaluate(() => sessionStorage.cc ?? "0")).toBe("0");
    const toast = page.getByTestId("update-toast");
    await expect(toast).toBeVisible();
    await expect(toast).toContainText(t("ui.update.ready"));
    await page.getByTestId("update-refresh").click();
    await expect.poll(async () => Object.keys(await caches_(page)).sort()).toEqual(["beachday-data-v1", `beachday-shell-${V2}`]);
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.cc), "exactly one controllerchange").toBe("1");
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).active.scriptURL.endsWith("/sw.js"))).toBe(true);
  });

  test("no skipWaiting without a message: the waiting worker stays waiting until SKIP_WAITING is posted", async ({ page }) => {
    await installed(page);
    await h.harness.setVersion({ version: V2 });
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration()).update(); });
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting)).toBe(true);
    await page.waitForTimeout(1500);
    expect(await page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration()).waiting)).toBe(true);
    const changed = page.evaluate(() => new Promise((r) => navigator.serviceWorker.addEventListener("controllerchange", () => r(true), { once: true })));
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).waiting.postMessage({ type: "SKIP_WAITING" }));
    expect(await changed).toBe(true);
  });

  test("a failed install keeps the old worker: sw.js stays no-cache and /version.json is never cached", async ({ page }) => {
    await installed(page);
    expect(await forbidden(page)).toEqual([]);
  });
});

test.describe("manifest and headers", () => {
  test("every page links the manifest; it is served as application/manifest+json; no shortcuts, no console", async ({ page, request }) => {
    for (const u of ["/", "/how-it-works/", "/resources/", "/guide/", "/offline.html"]) {
      await page.goto(u);
      await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
    }
    const m = await request.get("/manifest.webmanifest");
    expect(m.headers()["content-type"]).toContain("application/manifest+json");
    const j = await m.json();
    expect(j.shortcuts).toBeUndefined();
    expect(JSON.stringify(j).toLowerCase()).not.toContain("console");
    expect(j).toMatchObject({ id: "/", scope: "/", start_url: "/?source=pwa", theme_color: "#0b3b5c", background_color: "#0b3b5c", display: "standalone" });
  });
});

test.describe("install hint, 14-day snooze (iPhone user agent; Chromium emulation)", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1" });
  const T0 = new Date("2026-11-23T15:00:00Z");
  const DAY = 24 * 3600_000;
  const KEY = "bd.installHintDismissedAt";
  const sheet = (page) => page.getByRole("dialog", { name: t("install.ios.title") });

  test("first visit: the sheet opens 30 s after a verdict; Not Now / Done snoozes it; hidden at 14 d minus 1 ms, shown at exactly 14 d", async ({ page }) => {
    await page.clock.install({ time: T0 });
    await page.goto("/");
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    await expect(sheet(page)).toBeHidden();
    await page.clock.fastForward(31_000);
    await expect(sheet(page)).toBeVisible();
    await expect(sheet(page)).toContainText(t("install.ios.step2"));
    await page.getByRole("button", { name: t("btn.done") }).click();
    await expect(sheet(page)).toBeHidden();
    // pin the stored timestamp so the boundary is exact, then freeze Date.now() (timers keep running)
    await page.evaluate(([k, v]) => localStorage.setItem(k, String(v)), [KEY, T0.getTime()]);
    for (const [label, offset, shown] of [["1 hour later", 3600_000, false], ["14 days minus 1 ms", 14 * DAY - 1, false], ["exactly 14 days", 14 * DAY, true]]) {
      await page.clock.setFixedTime(new Date(T0.getTime() + offset));
      // Open-Meteo answers for the NEW date, or there would be no verdict and the hint (which waits for one) could not show
      const days = Math.floor(offset / DAY);
      om.setForecast(shiftDays(fx.forecast, days)); om.setMarine(shiftDays(fx.marine, days));
      await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("beachday:forecast")) localStorage.removeItem(k); });
      await page.reload();
      await expect(page.getByTestId("verdict-card")).toBeVisible();
      if (shown) await expect(sheet(page), label).toBeVisible({ timeout: 6000 }); // return visit: 2 s delay
      else { await page.waitForTimeout(2800); await expect(sheet(page), label).toBeHidden(); }
    }
  });

  test("never shown when launched standalone (installed app)", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "standalone", { value: true }));
    await page.clock.install({ time: T0 });
    await page.goto("/");
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    await page.clock.fastForward(60_000);
    await expect(sheet(page)).toBeHidden();
  });

  test("never over the picker (no beach chosen yet)", async ({ page }) => {
    await page.addInitScript(() => { localStorage.removeItem("beachday:beach"); });
    await page.clock.install({ time: T0 });
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(t("ui.choose.title"));
    await page.clock.fastForward(60_000);
    await expect(sheet(page)).toBeHidden();
  });
});
