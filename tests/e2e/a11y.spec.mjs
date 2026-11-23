// axe (wcag2a, wcag2aa, wcag21a, wcag21aa, wcag22aa) on every docs/06 §5 screen, in light, dark and contrast:more, on both phone projects.
// Zero violations. "incomplete" items (usually contrast over glass) are attached to the test as annotations for the manual review: never hidden, never a pass by themselves.
// Reduced transparency: Chromium has no emulation switch for it, so that pass is "not run" (docs/qa/README.md).
import { test, expect } from "@playwright/test";
import { beachApp, consoleApp, seedUsers, loginAs, openFirstChat, sendMessage, proposeViaChat, axe, noHorizontalScroll, signIn, STRINGS, ADMIN, PLAIN, turns as T } from "../helpers/e2e.mjs";

const MODES = [{ name: "light", media: { colorScheme: "light", contrast: "no-preference" } }, { name: "dark", media: { colorScheme: "dark", contrast: "no-preference" } }, { name: "contrast-more", media: { colorScheme: "light", contrast: "more" } }];

async function scanAllModes(page, testInfo, label) {
  const failures = [];
  for (const m of MODES) {
    await page.emulateMedia(m.media);
    await page.waitForTimeout(150);
    const r = await axe(page);
    if (r.violations.length) failures.push(`${label} [${m.name}]: ${r.violations.join(" | ")}`);
    for (const i of r.incomplete) testInfo.annotations.push({ type: "axe-incomplete", description: `${label} [${m.name}] ${i}` });
  }
  expect(failures, "axe violations").toEqual([]);
}

test.describe("beach app", () => {
  const STATES = ["great", "good", "fair", "skip", "short-window", "window-over", "no-verdict", "marine-missing", "thunder-afternoon", "high-uv"];
  for (const fx of STATES) {
    test(`Today: ${fx}`, async ({ page, baseURL }, testInfo) => {
      await beachApp(page, { baseURL, fixture: fx });
      await page.goto("/");
      await expect(page.getByTestId("verdict-card").or(page.getByTestId("message"))).toBeVisible();
      await scanAllModes(page, testInfo, `today-${fx}`);
    });
  }
  test("picker, day detail with hourly open, outlook day", async ({ page, baseURL }, testInfo) => {
    await beachApp(page, { baseURL, fixture: "outlook" });
    await page.goto("/#/beaches");
    await expect(page.getByTestId("picker")).toBeVisible();
    await scanAllModes(page, testInfo, "picker");
    await page.goto("/#/day/2026-11-24");
    await page.getByTestId("hourly-toggle").click();
    await expect(page.getByTestId("hourly")).toBeVisible();
    await scanAllModes(page, testInfo, "day-hourly");
    await page.goto("/#/day/2026-11-27");
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    await scanAllModes(page, testInfo, "day-outlook");
  });
  test("error state with Try Again, and the offline status", async ({ page, context, baseURL }, testInfo) => {
    const { om } = await beachApp(page, { baseURL, fixture: "great", status: 429 });
    await page.goto("/");
    await expect(page.getByRole("alert")).toBeVisible();
    await scanAllModes(page, testInfo, "error-429");
    om.setStatus(null);
    await page.getByRole("button", { name: STRINGS["btn.tryAgain"] }).click();
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    await context.setOffline(true);
    await expect(page.getByTestId("status")).toContainText(/Offline/);
    await scanAllModes(page, testInfo, "offline-status");
    await context.setOffline(false);
  });
});

test.describe("content pages", () => {
  for (const url of ["/how-it-works/", "/resources/", "/guide/", "/offline.html"]) {
    test(url, async ({ page }, testInfo) => {
      await page.goto(url);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await scanAllModes(page, testInfo, url);
    });
  }
});

test.describe("Agents page", () => {
  let c;
  test.beforeEach(async ({ page, baseURL }) => { c = await consoleApp(page, baseURL); await seedUsers(c.h); });
  test.afterEach(() => { c.guard.assertClean(); });

  test("sign in, sign up, check your email, forgot", async ({ page }, testInfo) => {
    await page.goto("/console");
    await expect(page.locator('.auth-card[data-screen="S1"]')).toBeVisible();
    await scanAllModes(page, testInfo, "S1-sign-in");
    await page.getByRole("button", { name: STRINGS["btn.signUp"] }).click();
    await expect(page.locator('.auth-card[data-screen="S2"]')).toBeVisible();
    await scanAllModes(page, testInfo, "S2-sign-up");
    await page.getByLabel(STRINGS["auth.field.email"], { exact: true }).fill("a11y@example.test");
    await page.getByLabel(STRINGS["auth.field.password"], { exact: true }).fill("a long enough password 42");
    await page.locator('.auth-card[data-screen="S2"] button[type=submit]').click();
    await expect(page.locator('.auth-card[data-screen="S3"]')).toBeVisible();
    await scanAllModes(page, testInfo, "S3-check-email");
    await page.goto("/console#/console/forgot");
    await expect(page.locator('.auth-card[data-screen="S4"]')).toBeVisible();
    await scanAllModes(page, testInfo, "S4-forgot");
    await page.goto("/console");
    await signIn(page, { email: ADMIN.email, password: "wrong wrong wrong wrong" });
    await expect(page.getByRole("alert").filter({ hasText: STRINGS["auth.error.credentials"] })).toBeVisible();
    await scanAllModes(page, testInfo, "S1-wrong-password");
  });

  test("no access, couldn't check, agent list, knowledge open", async ({ page }, testInfo) => {
    await loginAs(page, PLAIN);
    await expect(page.getByTestId("no-access")).toBeVisible();
    await scanAllModes(page, testInfo, "S6-no-access");
    await page.getByRole("button", { name: STRINGS["btn.signOut"], exact: true }).click();
    await c.h.supabase.fail({ target: "rest", mode: 500, times: -1 });
    await page.getByLabel(STRINGS["auth.field.email"], { exact: true }).fill(ADMIN.email);
    await page.getByLabel(STRINGS["auth.field.password"], { exact: true }).fill(ADMIN.password);
    await page.getByRole("button", { name: STRINGS["btn.signIn"], exact: true }).click();
    await expect(page.getByText(STRINGS["console.check.failed"])).toBeVisible();
    await scanAllModes(page, testInfo, "check-failed-503");
    await c.h.supabase.clearFailures();
    await page.getByTestId("retry-access").click();
    await expect(page.getByTestId("agent-list")).toBeVisible();
    await scanAllModes(page, testInfo, "agent-list");
    await page.getByTestId("agent-knowledge").first().locator("summary").click();
    await scanAllModes(page, testInfo, "agent-knowledge-open");
  });

  test("chat with a reply, a proposal card with its diff open, the approve sheet, the cap alert, Approve off", async ({ page }, testInfo) => {
    await loginAs(page, ADMIN);
    const longLine = "x".repeat(300);
    const id = await proposeViaChat(page, c.h, T, { summary: "Add a long line to a note so the diff has to scroll sideways on a phone", files: [{ path: "docs/long-line.md", content: `# Long\n\n${longLine}\n` }] });
    await expect(page.getByTestId("msg-agent")).toBeVisible();
    await scanAllModes(page, testInfo, "chat-with-proposal");
    const diff = page.getByTestId("proposal-diff").first();
    await diff.locator("summary").click();
    for (const w of [320, 412]) { await page.setViewportSize({ width: w, height: 800 }); await noHorizontalScroll(page); } // Sable's overflow fix: the page never widens
    await scanAllModes(page, testInfo, "proposal-diff-open");
    await page.getByTestId("proposal-review").click();
    await expect(page.getByTestId("approve-sheet")).toBeVisible();
    await scanAllModes(page, testInfo, "approve-sheet");
    await page.keyboard.press("Escape");
    // cap alert and Approve-off come from the proposal GET, so reload the same proposal under each condition
    await c.h.blobs.seed({ store: "ratelimit", key: "site:approvals", value: { times: Array.from({ length: 14 }, (_, i) => new Date(Date.now() - 60_000 - i * 2 * 24 * 3600_000).toISOString()) } });
    await page.goto(`/console#/console/proposal/${id}`);
    await page.reload();
    await expect(page.getByTestId("approve-cap")).toBeVisible({ timeout: 15_000 });
    await scanAllModes(page, testInfo, "cap-alert");
    await c.h.blobs.seed({ store: "ratelimit", key: "site:approvals", value: { times: [] } });
    await c.h.harness.setApproveEnabled({ value: false });
    await page.reload();
    await expect(page.getByTestId("approve-off")).toBeVisible({ timeout: 15_000 });
    await scanAllModes(page, testInfo, "approve-off");
  });
});
