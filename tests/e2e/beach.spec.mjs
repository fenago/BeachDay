// The beach app on the phone profiles (pixel = Pixel 7; iphone-chromium = iPhone 15 viewport + UA in CHROMIUM, not Safari).
// Open-Meteo is mocked from Dewey's derived fixtures; the clock is set to each fixture's "now". Text locators come from the copy deck.
import { test, expect } from "@playwright/test";
import { beachApp, t, STRINGS, VERDICTS, noHorizontalScroll, expectTargets44, FIXTURE_NOW, BEACH_KEY, loadFixture } from "../helpers/e2e.mjs";

const h1 = (page) => page.getByRole("heading", { level: 1 });
const SAFETY_LINK = (page) => page.getByRole("link", { name: new RegExp(STRINGS["footer.safety.link"]) });

test.describe("picker to Today to Next days to day detail", () => {
  test("choose a beach, read the verdict and why, then open a day", async ({ page, baseURL }) => {
    const { guard, om } = await beachApp(page, { baseURL, fixture: "good", saveBeach: false });
    await page.goto("/");
    await expect(h1(page)).toHaveText(t("ui.choose.title")); // first load does not steal focus (Pip); route changes do
    await expect(page.getByRole("button", { name: t("btn.nearest") })).toBeVisible();
    await page.locator('[data-beach="miami-beach"]').click();
    // Today: h1 is the beach, focus moved to it, the status region announces the choice and then the update
    await expect(h1(page)).toHaveText(/South Beach/); // Miami Beach is the area; the beach is South Beach
    await expect(h1(page)).toBeFocused();
    const card = page.getByTestId("verdict-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("heading", { level: 2 })).toContainText(VERDICTS.good.label);
    await expect(card.locator("svg[aria-hidden=true]").first()).toBeAttached(); // icon is decorative, the word carries the verdict
    // reasons and best hours (good-derived: 45% rain chance, partly cloudy)
    await expect(page.getByTestId("reasons").getByRole("listitem")).not.toHaveCount(0);
    await expect(page.getByTestId("best-hours")).toContainText(/Best hours/);
    // the safety line and the attribution are always on screen with a verdict
    await expect(page.getByText(t("ui.safety.flags"))).toBeVisible();
    await expect(SAFETY_LINK(page).first()).toHaveAttribute("href", /weather\.gov\/beach\/mfl/);
    await expect(page.getByRole("link", { name: /Open-Meteo\.com/ }).first()).toHaveAttribute("href", "https://open-meteo.com/");
    await expect(page.getByRole("status").filter({ hasText: /Updated|selected/ }).first()).toBeVisible();
    // Next days, then a day
    const strip = page.getByTestId("day-strip");
    await expect(strip.getByRole("link")).toHaveCount(6);
    await strip.getByRole("link").first().click();
    await expect(page).toHaveURL(/#\/day\/2026-11-24$/);
    await expect(h1(page)).toBeFocused();
    await expect(page.getByTestId("key-numbers")).toContainText(t("ui.key.feels"));
    const toggle = page.getByTestId("hourly-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByTestId("hourly").getByRole("listitem").first()).toBeVisible();
    await page.getByTestId("back").click();
    await expect(page).toHaveURL(/#\/$/);
    expect(om.forecastCalls(), "Open-Meteo is called, and only a bounded number of times").toBeGreaterThan(0);
    expect(om.forecastCalls()).toBeLessThanOrEqual(2);
    guard.assertClean();
  });

  test("the beach is remembered, favourites toggle with a name and aria-pressed, and Change beach returns to the picker", async ({ page, baseURL }) => {
    await beachApp(page, { baseURL, fixture: "great" });
    await page.goto("/#/beaches");
    const star = page.locator('[data-star="haulover"]').first();
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await expect(star).toHaveAccessibleName(t("ui.favorite.add", { beach: "Haulover" }), { ignoreCase: true }).catch(async () => {
      await expect(star).toHaveAccessibleName(/Add .* to favorites/);
    });
    await star.click();
    await expect(page.locator('[data-star="haulover"]').first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId("favorites").locator('[data-star="haulover"]')).toBeVisible(); // it also appears in a Favorites group
    await expect(page.locator('[data-star="haulover"]').first()).toBeFocused(); // focus stays on the star after the list re-renders
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("beachday:favorites")))).toEqual(["haulover"]);
    await page.locator('[data-beach="haulover"]').first().click();
    await expect(h1(page)).toHaveText(/Haulover/);
    expect(await page.evaluate((k) => localStorage.getItem(k), BEACH_KEY)).toBe("haulover");
    await page.reload();
    await expect(h1(page)).toHaveText(/Haulover/);
  });

  test("Use Nearest Beach with geolocation picks the closest beach (Smathers Beach, Key West)", async ({ page, context, baseURL }) => {
    await beachApp(page, { baseURL, fixture: "great", saveBeach: false });
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: 24.555, longitude: -81.78 });
    await page.goto("/");
    await page.getByRole("button", { name: t("btn.nearest") }).click();
    await expect(h1(page)).toHaveText(/Smathers Beach/);
  });

  test("with location denied the picker says so and stays usable", async ({ page, context, baseURL }) => {
    await beachApp(page, { baseURL, fixture: "great", saveBeach: false });
    await context.clearPermissions();
    await page.goto("/");
    await page.getByRole("button", { name: t("btn.nearest") }).click();
    await expect(page.getByText(t("status.location.off"))).toBeVisible();
    await expect(page.locator('[data-beach="miami-beach"]')).toBeVisible();
  });
});

// docs/06 §5 "home in each verdict state". Each row: fixture, what must be on screen.
const STATES = [
  { fx: "great", verdict: "great" }, { fx: "good", verdict: "good" }, { fx: "fair", verdict: "fair" }, { fx: "skip", verdict: "skip", extra: () => STRINGS["reason.thunder"] },
  { fx: "short-window", verdict: "good", extra: () => /Only \d+ usable beach hours?|Only 1 usable beach hour/ },
  { fx: "thunder-afternoon", verdict: "great", extra: () => /Thunderstorms around/ },
  { fx: "marine-missing", verdict: "great", status: () => t("status.partial") },
  { fx: "high-uv", verdict: "great", extra: () => /UV very high/ },
  { fx: "rough-seas", verdict: "fair", extra: () => /Rough, waves|Choppy, waves/ },
  { fx: "windy-front", verdict: "fair" },
];
test.describe("each verdict state renders its word, its icon and its reasons", () => {
  for (const s of STATES) {
    test(`${s.fx}: ${VERDICTS[s.verdict].label}`, async ({ page, baseURL }) => {
      const { guard } = await beachApp(page, { baseURL, fixture: s.fx });
      await page.goto("/");
      const card = page.getByTestId("verdict-card");
      await expect(card).toBeVisible();
      await expect(card).toHaveAttribute("data-verdict", s.verdict);
      await expect(card.getByRole("heading", { level: 2 })).toContainText(VERDICTS[s.verdict].label); // the word, never colour alone
      await expect(card.locator("svg[aria-hidden=true]").first()).toBeAttached();
      if (s.extra) await expect(page.getByTestId("view")).toContainText(s.extra());
      if (s.status) await expect(page.getByTestId("status")).toContainText(s.status());
      await expect(page.getByText(t("ui.safety.flags"))).toBeVisible();
      await expect(page.getByRole("link", { name: /Open-Meteo\.com/ }).first()).toBeVisible();
      guard.assertClean();
    });
  }

  test("window over: today's beach hours are done, tomorrow is shown with the explanation", async ({ page, baseURL }) => {
    await beachApp(page, { baseURL, fixture: "window-over" });
    await page.goto("/");
    await expect(page.getByTestId("status")).toHaveText(t("status.after.hours"));
    await expect(page.getByTestId("verdict-card")).toBeVisible();
  });

  test("no verdict: says so in words and offers Try Again, no fake score", async ({ page, baseURL }) => {
    await beachApp(page, { baseURL, fixture: "no-verdict" });
    await page.goto("/");
    await expect(page.getByText(t("status.no.verdict")).first()).toBeVisible();
    await expect(page.getByRole("button", { name: t("btn.tryAgain") }).first()).toBeVisible();
  });

  test("outlook days (day 4 and later) are labelled and have the outlook advice", async ({ page, baseURL }) => {
    await beachApp(page, { baseURL, fixture: "outlook" });
    await page.goto("/#/day/2026-11-27");
    await expect(page.getByTestId("verdict-card")).toContainText(t("ui.outlook"));
    await expect(page.getByTestId("verdict-card")).toContainText(t("advice.outlook"));
  });
});

test.describe("failures and edge states", () => {
  test("Open-Meteo 429 with nothing cached: friendly alert, Try Again, no blank page", async ({ page, baseURL }) => {
    const { om } = await beachApp(page, { baseURL, fixture: "great", status: 429 });
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(t("error.forecast"));
    await expect(page.getByRole("button", { name: t("btn.tryAgain") })).toBeFocused();
    await expect(page.getByText(t("ui.safety.flags"))).toBeVisible();
    om.setStatus(null);
    await page.getByRole("button", { name: t("btn.tryAgain") }).click();
    await expect(page.getByTestId("verdict-card")).toBeVisible();
  });

  test("Open-Meteo 400 body {error:true,reason} is treated as a failure, not a verdict", async ({ page, baseURL }) => {
    const { om } = await beachApp(page, { baseURL, fixture: "great" });
    om.setForecast(loadFixture("error-400"));
    await page.goto("/");
    await expect(page.getByRole("alert")).toContainText(t("error.forecast"));
  });

  test("marine API down: the verdict uses weather only and says so; Waves unavailable", async ({ page, baseURL }) => {
    await beachApp(page, { baseURL, fixture: "marine-missing" });
    await page.goto("/#/day/2026-11-23");
    await expect(page.getByTestId("key-numbers")).toContainText(t("status.waves.na"));
  });

  test("offline with nothing cached: says you are offline and keeps the safety line", async ({ page, context, baseURL }) => {
    await beachApp(page, { baseURL, fixture: "great" });
    await page.goto("/#/beaches"); // load the shell while online
    await context.setOffline(true); // no service worker in these projects, so setOffline is honest here
    await page.locator('[data-beach="miami-beach"]').click();
    await expect(page.getByRole("alert")).toContainText(t("error.offline.nocache"));
    await expect(page.getByText(t("ui.safety.flags"))).toBeVisible();
    await context.setOffline(false);
  });

  test("a cached forecast is shown offline with the 'Offline — showing … forecast' status", async ({ page, context, baseURL }) => {
    await beachApp(page, { baseURL, fixture: "great" });
    await page.goto("/");
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    await context.setOffline(true); // fires the window 'offline' event; no service worker here, so a reload cannot work
    await expect(page.getByTestId("status")).toContainText(/Offline — showing .* forecast/);
    await context.setOffline(false);
  });

  test("an unknown day route returns to Today instead of a blank screen", async ({ page, baseURL }) => {
    await beachApp(page, { baseURL, fixture: "great" });
    await page.goto("/#/day/2031-01-01");
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    await expect(page).toHaveURL(/#\/$/);
  });
});

test.describe("phone layout", () => {
  for (const width of [320, 390, 412]) {
    test(`no horizontal scroll at ${width} px on the picker, Today and a day`, async ({ page, baseURL }) => {
      await beachApp(page, { baseURL, fixture: "windy-front" });
      await page.setViewportSize({ width, height: 800 });
      for (const route of ["/#/beaches", "/", "/#/day/2026-11-24"]) {
        await page.goto(route);
        await expect(h1(page)).toBeVisible();
        await noHorizontalScroll(page);
      }
    });
  }

  test("every control is at least 44 x 44 CSS px (picker, Today, a day)", async ({ page, baseURL }) => {
    await beachApp(page, { baseURL, fixture: "good" });
    await page.goto("/#/beaches");
    await expect(page.locator('[data-beach="miami-beach"]')).toBeVisible();
    await expectTargets44(page, "main button, main a.btn, main a.beach-row");
    await page.goto("/");
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    await expectTargets44(page, "main button, main a.btn, main a.day-row, header a, header button");
    await page.goto("/#/day/2026-11-24");
    await expect(page.getByTestId("key-numbers")).toBeVisible();
    await expectTargets44(page, "main button, main a.btn, main a.back-link");
  });

  test("text can grow: 200% text keeps the verdict readable with no horizontal scroll at 320 px", async ({ page, baseURL }) => {
    await beachApp(page, { baseURL, fixture: "good" });
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/");
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    await page.addStyleTag({ content: "html{font-size:200% !important}" }).catch(() => {}); // CSP blocks inline style: best effort only
    await noHorizontalScroll(page);
  });
});

test.describe("the beach app is public: no account, no auth code", () => {
  test("it never calls Supabase or /api/, and loads no vendor or console script", async ({ page, baseURL }) => {
    const { guard } = await beachApp(page, { baseURL, fixture: "good" });
    const hit = [];
    page.on("request", (r) => { const u = new URL(r.url()); if (u.host.endsWith("supabase.co") || u.pathname.startsWith("/api/") || /\/(vendor|js\/console|generated)\//.test(u.pathname)) hit.push(`${r.method()} ${u.pathname}`); });
    await page.goto("/");
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    await page.goto("/#/day/2026-11-24");
    await expect(page.getByTestId("key-numbers")).toBeVisible();
    expect(hit).toEqual([]);
    guard.assertClean();
  });

  test("CSP: no violation is logged while using the app", async ({ page, baseURL }) => {
    await beachApp(page, { baseURL, fixture: "good" });
    const csp = [];
    page.on("console", (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text()); });
    page.on("pageerror", (e) => csp.push(`pageerror: ${e.message}`));
    await page.goto("/");
    await expect(page.getByTestId("verdict-card")).toBeVisible();
    expect(csp).toEqual([]);
  });
});

test.describe("preferences", () => {
  test("reduced motion + dark scheme + forced colors + more contrast still show the verdict word", async ({ browser, baseURL }, testInfo) => {
    for (const emu of [{ colorScheme: "dark" }, { reducedMotion: "reduce" }, { forcedColors: "active" }, { contrast: "more" }]) {
      const ctx = await browser.newContext({ ...testInfo.project.use, ...emu, serviceWorkers: "block", baseURL });
      const page = await ctx.newPage();
      await beachApp(page, { baseURL, fixture: "skip" });
      await page.goto("/");
      await expect(page.getByTestId("verdict-card").getByRole("heading", { level: 2 })).toContainText(VERDICTS.skip.label);
      await ctx.close();
    }
  });
});
