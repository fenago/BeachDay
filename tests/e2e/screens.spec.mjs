// Screenshots for Dr. Lee: docs/qa/screenshots/<project>-<screen>.png at deviceScaleFactor 2 on the pixel project (Pixel 7, Chromium)
// and the iphone-chromium project (iPhone 15 viewport + UA in CHROMIUM: NOT Safari). They are evidence, not pixel-diff baselines.
import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { beachApp, consoleApp, seedUsers, loginAs, proposeViaChat, openFirstChat, sendMessage, STRINGS, ADMIN, PLAIN, turns as T } from "../helpers/e2e.mjs";

test.use({ deviceScaleFactor: 2 });
const OUT = join(process.cwd(), "docs", "qa", "screenshots");
mkdirSync(OUT, { recursive: true });
const shot = (page, testInfo, name, opts = {}) => page.screenshot({ path: join(OUT, `${testInfo.project.name}-${name}.png`), animations: "disabled", ...opts });

test.describe("beach app", () => {
  test("Today (Great and Skip), next days, day detail, offline banner, picker", async ({ page, context, baseURL }, testInfo) => {
    const { om } = await beachApp(page, { baseURL, fixture: "great" });
    await page.goto("/");
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    await shot(page, testInfo, "today-great");
    await page.getByTestId("day-strip").scrollIntoViewIfNeeded();
    await shot(page, testInfo, "next-days");
    await page.goto("/#/day/2026-11-24");
    await page.getByTestId("hourly-toggle").click();
    await expect(page.getByTestId("hourly")).toBeVisible();
    await shot(page, testInfo, "day-detail");
    await page.goto("/#/beaches");
    await expect(page.getByTestId("picker")).toBeVisible();
    await shot(page, testInfo, "picker");
    const skip = await import("../helpers/openmeteo-routes.mjs").then((m) => m.loadFixture("skip-derived"));
    om.setForecast(skip.forecast); om.setMarine(skip.marine);
    await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("beachday:forecast")) localStorage.removeItem(k); });
    await page.goto("/#/");
    await page.reload();
    await expect(page.getByTestId("verdict-card")).toHaveAttribute("data-verdict", "skip");
    await shot(page, testInfo, "today-skip");
    await context.setOffline(true);
    await expect(page.getByTestId("status")).toContainText(/Offline/);
    await shot(page, testInfo, "offline-banner");
    await context.setOffline(false);
  });
});

test.describe("content pages", () => {
  for (const [name, url] of [["how-it-works", "/how-it-works/"], ["resources", "/resources/"], ["guide", "/guide/"]]) {
    test(name, async ({ page }, testInfo) => {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await shot(page, testInfo, name);
    });
  }
});

test.describe("Agents page", () => {
  test("sign in, no access, agent list, chat, proposal diff, approve sheet, Live", async ({ page, baseURL }, testInfo) => {
    const c = await consoleApp(page, baseURL); await seedUsers(c.h);
    await page.goto("/console");
    await expect(page.locator('.auth-card[data-screen="S1"]')).toBeVisible();
    await shot(page, testInfo, "sign-in");
    await loginAs(page, PLAIN);
    await expect(page.getByTestId("no-access")).toBeVisible();
    await shot(page, testInfo, "no-access");
    await page.getByRole("button", { name: STRINGS["btn.signOut"], exact: true }).click();
    await page.getByLabel(STRINGS["auth.field.email"], { exact: true }).fill(ADMIN.email);
    await page.getByLabel(STRINGS["auth.field.password"], { exact: true }).fill(ADMIN.password);
    await page.getByRole("button", { name: STRINGS["btn.signIn"], exact: true }).click();
    await expect(page.getByTestId("agent-list")).toBeVisible();
    await shot(page, testInfo, "agent-list");
    await proposeViaChat(page, c.h, T, { summary: "Make the picker heading friendlier so first-time visitors feel welcome right away", files: [{ path: "public/js/score-config.js", content: "export const SCORE_CONFIG = { friendly: true };\n" }] });
    await shot(page, testInfo, "chat");
    const diff = page.getByTestId("proposal-diff").first();
    await diff.locator("summary").click();
    await page.getByTestId("proposal-card").scrollIntoViewIfNeeded();
    await shot(page, testInfo, "proposal-diff");
    await page.getByTestId("proposal-review").click();
    await expect(page.getByTestId("approve-sheet")).toBeVisible();
    await shot(page, testInfo, "approve-sheet");
    await page.getByTestId("stepup-password").fill(ADMIN.password);
    await page.getByTestId("sheet-approve").click();
    await expect(page.getByTestId("proposal-status")).toContainText(/Deploying/, { timeout: 15_000 });
    const sha = (await c.h.github.log())[0].sha;
    await c.h.harness.setVersion({ version: sha });
    await expect(page.getByTestId("proposal-status")).toContainText(STRINGS["console.status.live"], { timeout: 20_000 });
    await shot(page, testInfo, "live");
  });
});
