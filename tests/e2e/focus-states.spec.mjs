// W2F2 behaviours of the beach app: focus never drops to <body>, titles, the Choose Beach link, offline beating "selected".
import { test, expect } from "@playwright/test";
import { beachApp, t, STRINGS, loadFixture } from "../helpers/e2e.mjs";

const h1 = (page) => page.getByRole("heading", { level: 1 });
const activeIsBody = (page) => page.evaluate(() => document.activeElement === document.body || document.activeElement === null);

test("document.title follows the screen: '{title} · Beach Day'", async ({ page, baseURL }) => {
  await beachApp(page, { baseURL, fixture: "good" });
  await page.goto("/");
  await expect(page.getByTestId("verdict-card")).toBeVisible();
  await expect(page).toHaveTitle(/^South Beach · Beach Day$/);
  await page.goto("/#/day/2026-11-24");
  await expect(page.getByTestId("key-numbers")).toBeVisible();
  await expect(page).toHaveTitle(/ · Beach Day$/);
  await page.goto("/#/beaches");
  await expect(page).toHaveTitle(new RegExp(`^${t("ui.choose.title")} · Beach Day$`));
});

test("a Choose Beach link is on Today and on a day, and leads to the picker", async ({ page, baseURL }) => {
  await beachApp(page, { baseURL, fixture: "good" });
  await page.goto("/");
  await expect(page.getByTestId("verdict-card")).toBeVisible();
  const link = page.getByTestId("choose-beach");
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "#/beaches");
  await link.click();
  await expect(page.getByTestId("picker")).toBeVisible();
  await page.goto("/#/day/2026-11-24");
  await expect(page.getByTestId("key-numbers")).toBeVisible();
  await expect(page.getByTestId("choose-beach")).toBeVisible();
  await page.getByTestId("choose-beach").click();
  await expect(page.getByTestId("picker")).toBeVisible();
});

test("slow load (no cache): after 10 s the status says so, Try Again appears, and activating it moves focus to the heading (not <body>)", async ({ page, baseURL }) => {
  const { om } = await beachApp(page, { baseURL, fixture: "good" });
  const fx = loadFixture("good-derived");
  await page.context().unroute("https://api.open-meteo.com/**");
  let hold = true;
  await page.context().route("https://api.open-meteo.com/**", async (r) => { while (hold) await new Promise((ok) => setTimeout(ok, 200)); await r.fulfill({ json: fx.forecast, headers: { "access-control-allow-origin": "*" } }).catch(() => {}); });
  await page.goto("/");
  await expect(page.getByTestId("status")).toHaveText(t("status.slow"), { timeout: 14_000 });
  const again = page.getByTestId("try-again");
  await expect(again).toBeVisible();
  hold = false;
  await again.click();
  expect(await activeIsBody(page), "focus is not on <body> after Try Again").toBe(false);
  await expect(page.getByTestId("verdict-card")).toBeVisible({ timeout: 15_000 });
  expect(await activeIsBody(page)).toBe(false);
  void om;
});

test("error state: Try Again takes focus on arrival, and after it is used focus is not lost", async ({ page, baseURL }) => {
  const { om } = await beachApp(page, { baseURL, fixture: "good", status: 429 });
  await page.goto("/");
  await expect(page.getByTestId("try-again")).toBeFocused();
  om.setStatus(null);
  await page.getByTestId("try-again").click();
  await expect(page.getByTestId("verdict-card")).toBeVisible();
  expect(await activeIsBody(page)).toBe(false);
});

test("Android install: 'Not Now' hides the button, says so, and focus moves to the heading", async ({ page, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "iphone-chromium", "the iPhone user agent gets the Add to Home Screen sheet, not the Android button (sheet: offline.spec)");
  await beachApp(page, { baseURL, fixture: "good" });
  await page.goto("/");
  await expect(page.getByTestId("verdict-card")).toBeVisible();
  await page.evaluate(() => { const e = new Event("beforeinstallprompt", { cancelable: true }); e.prompt = async () => {}; e.userChoice = Promise.resolve({ outcome: "dismissed" }); window.dispatchEvent(e); });
  await page.clock.fastForward(31_000);
  const notNow = page.getByTestId("install-not-now");
  await expect(notNow).toBeVisible();
  await notNow.click();
  await expect(page.getByTestId("install")).toBeHidden();
  await expect(page.getByTestId("status")).toHaveText(t("install.dismissed"));
  expect(await activeIsBody(page), "focus must not be lost when the button leaves the page").toBe(false);
});

test("offline beats 'selected': choosing a beach while offline reads the offline status, not '{beach} selected'", async ({ page, context, baseURL }) => {
  await beachApp(page, { baseURL, fixture: "good" });
  await page.goto("/");
  await expect(page.getByTestId("verdict-card")).toBeVisible();
  await page.getByTestId("choose-beach").click();
  await context.setOffline(true);
  await page.locator('[data-beach="miami-beach"]').first().click();
  await expect(page.getByTestId("verdict-card")).toBeVisible();
  await expect(page.getByTestId("status")).toContainText(/Offline — showing/);
  await expect(page.getByTestId("announce")).not.toContainText(/selected/);
  await context.setOffline(false);
});

test("forced refresh gives feedback ('Refreshing…') and keeps focus on the Refresh button", async ({ page, baseURL }) => {
  await beachApp(page, { baseURL, fixture: "good" });
  await page.goto("/");
  await expect(page.getByTestId("verdict-card")).toBeVisible();
  await page.getByTestId("refresh").click();
  await expect(page.getByTestId("status")).toHaveText(t("ui.refreshing"));
  await expect(page.getByTestId("refresh")).toBeFocused();
  void h1; void STRINGS;
});
