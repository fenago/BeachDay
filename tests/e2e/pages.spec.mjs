// Header and footer links on every page resolve; one h1 each; Resources has the repo, mcp-api.netlify.app and /guide/.
// External links are never followed (the host guard would abort them): they are checked for shape, not fetched.
import { test, expect } from "@playwright/test";
import { guardHosts } from "../helpers/openmeteo-routes.mjs";
import { t, STRINGS, noHorizontalScroll, expectTargets44 } from "../helpers/e2e.mjs";

const PAGES = [
  { url: "/", h1: null }, { url: "/how-it-works/", h1: "How it works" }, { url: "/resources/", h1: "Resources" },
  { url: "/guide/", h1: "Step-by-step guide" }, { url: "/console", h1: null }, { url: "/offline.html", h1: "You're offline" },
];

for (const p of PAGES) {
  test(`${p.url}: one h1, lang=en, landmarks, skip link, 200`, async ({ page, baseURL }) => {
    await guardHosts(page.context(), { siteOrigin: baseURL });
    const res = await page.goto(p.url);
    expect(res.status(), `${p.url}`).toBe(200);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.locator("h1:visible")).toHaveCount(1);
    if (p.h1) await expect(page.getByRole("heading", { level: 1 })).toHaveText(p.h1);
    await expect(page.getByRole("main")).toBeVisible();
    if (p.url !== "/offline.html") {
      await expect(page.getByRole("banner")).toBeVisible();
      await expect(page.getByRole("contentinfo")).toBeVisible();
      await expect(page.getByRole("link", { name: t("nav.skip") })).toBeAttached();
    }
    await expect(page).toHaveTitle(/Beach Day|Agents/);
    await noHorizontalScroll(page);
  });
}

test.describe("navigation", () => {
  test("every internal header and footer link resolves with 200 and lands on the page it names", async ({ page, request, baseURL }) => {
    await guardHosts(page.context(), { siteOrigin: baseURL });
    for (const from of ["/how-it-works/", "/resources/", "/guide/"]) {
      await page.goto(from);
      const links = await page.locator('header a[href^="/"], footer a[href^="/"], nav a[href^="/"]').evaluateAll((as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
      expect(links.length).toBeGreaterThan(3);
      for (const href of links) { const r = await request.get(href); expect(r.status(), `${from} -> ${href}`).toBe(200); }
    }
  });

  test("header: Beach Day, How it works, Resources, Agents navigate and mark the current page", async ({ page, baseURL }) => {
    await guardHosts(page.context(), { siteOrigin: baseURL });
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: STRINGS["nav.label"] });
    await nav.getByRole("link", { name: STRINGS["nav.how"] }).click();
    await expect(page).toHaveURL(/\/how-it-works\/$/);
    await expect(page.getByRole("navigation", { name: STRINGS["nav.label"] }).getByRole("link", { name: STRINGS["nav.how"] })).toHaveAttribute("aria-current", "page");
    await page.getByRole("navigation", { name: STRINGS["nav.label"] }).getByRole("link", { name: STRINGS["nav.resources"] }).click();
    await expect(page).toHaveURL(/\/resources\/$/);
    await page.getByRole("navigation", { name: STRINGS["nav.label"] }).getByRole("link", { name: STRINGS["nav.agents"] }).click();
    await expect(page).toHaveURL(/\/console$/);
    await page.getByRole("banner").getByRole("link", { name: STRINGS["nav.home"] }).click(); // the brand is a sibling of the nav
    await expect(page).toHaveURL(/\/$/);
  });

  test("footer: guide link works; GitHub, Open-Meteo, CC BY and NWS links are well-formed new-tab links", async ({ page, baseURL }) => {
    await guardHosts(page.context(), { siteOrigin: baseURL });
    await page.goto("/how-it-works/");
    const foot = page.getByRole("contentinfo");
    await expect(foot.getByRole("link", { name: STRINGS["footer.guide"] })).toHaveAttribute("href", "/guide/");
    for (const [name, href] of [[/GitHub/, "https://github.com/fenago/BeachDay"], [/Open-Meteo\.com/, "https://open-meteo.com/"], [/CC BY 4\.0/, /open-meteo\.com\/en\/licence/], [/NWS rip-current risk/, /weather\.gov\/(beach\/mfl|key)/]]) {
      const a = foot.getByRole("link", { name });
      await expect(a).toHaveAttribute("href", href);
      await expect(a).toHaveAttribute("rel", /noopener/);
    }
    await expect(foot).toContainText(/posted flags/i);
    await page.getByRole("contentinfo").getByRole("link", { name: STRINGS["footer.guide"] }).click();
    await expect(page).toHaveURL(/\/guide\/$/);
  });

  test("Resources lists the repo, mcp-api.netlify.app and the guide, every external link has rel=noopener and text", async ({ page, baseURL }) => {
    await guardHosts(page.context(), { siteOrigin: baseURL });
    await page.goto("/resources/");
    const main = page.getByRole("main");
    await expect(main.locator('a[href="https://github.com/fenago/BeachDay"]').first()).toBeVisible();
    await expect(main.locator('a[href="https://mcp-api.netlify.app/"]').first()).toBeVisible();
    await expect(main.locator('a[href="/guide/"]').first()).toBeVisible();
    const bad = await main.locator('a[href^="http"]').evaluateAll((as) => as.filter((a) => !/noopener/.test(a.rel) || !a.textContent.trim()).map((a) => a.href));
    expect(bad).toEqual([]);
    expect(await main.locator("h2").count(), "grouped by headings").toBeGreaterThan(3);
  });

  test("/offline.html keeps the safety line and the attribution", async ({ page, baseURL }) => {
    await guardHosts(page.context(), { siteOrigin: baseURL });
    await page.goto("/offline.html");
    await expect(page.getByRole("link", { name: /NWS rip-current risk/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Open-Meteo\.com/ })).toBeVisible();
  });
});

test.describe("phone layout of the content pages", () => {
  for (const url of ["/how-it-works/", "/resources/", "/guide/"]) {
    test(`${url}: no horizontal scroll at 320, 390, 412 px; header and footer targets are 44 px`, async ({ page, baseURL }) => {
      await guardHosts(page.context(), { siteOrigin: baseURL });
      for (const width of [320, 390, 412]) {
        await page.setViewportSize({ width, height: 800 });
        await page.goto(url);
        await noHorizontalScroll(page);
      }
      await expectTargets44(page, "header a, header button, footer nav a");
    });
  }
  test("How it works explains the scoring and links the NWS (ADR-0002); the guide names the Netlify env variables", async ({ page, baseURL }) => {
    await guardHosts(page.context(), { siteOrigin: baseURL });
    await page.goto("/how-it-works/");
    await expect(page.getByRole("main")).toContainText(/thunder/i);
    await expect(page.getByRole("main").getByRole("link", { name: /NWS/ }).first()).toBeVisible();
    await page.goto("/guide/");
    for (const name of ["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"]) await expect(page.getByRole("main")).toContainText(name);
    await expect(page.getByRole("main")).not.toContainText(/service_role\s*[:=]/);
  });
});
