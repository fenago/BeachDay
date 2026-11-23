// Shared Playwright helpers for the e2e specs (build wave W2). Locators come from the copy deck (t / STRINGS), so a copy edit
// updates the specs with it. Nothing here reaches a real host: guardHosts aborts anything outside the site, Open-Meteo and the fixture Supabase host.
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { harnessClient } from "./harness-client.mjs";
import { guardHosts, routeOpenMeteo, routeSupabase, loadFixture } from "./openmeteo-routes.mjs";
import { t, STRINGS, VERDICTS } from "../../public/js/copy/copy-deck.js";

export { t, STRINGS, VERDICTS, harnessClient, loadFixture };
export const BEACH_KEY = "beachday:beach";
export const FIXTURE_NOW = "2026-11-23T12:00:00Z"; // 7 am in New York: inside the beach window
export const ADMIN = { email: "lee@example.test", password: "correct horse battery staple" };
export const PLAIN = { email: "sam@example.test", password: "another long password 123" };
export const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** "iphone-chromium" must always be reported as Chromium emulation of an iPhone 15, never as Safari. */
export const projectLabel = (testInfo) => (testInfo.project.name === "iphone-chromium" ? "iphone-chromium (iPhone 15 viewport + UA, Chromium, NOT WebKit)" : testInfo.project.name);

/**
 * Beach app with a mocked forecast. fixture: name of a derived fixture ("great", "skip", ...) or {forecast, marine, now}.
 * Returns { om, guard } (om = routeOpenMeteo handle). The browser clock is set to the fixture's `now` and keeps ticking.
 */
export async function beachApp(page, { baseURL, fixture = "great", beach = "miami-beach", status = null, clock = true, saveBeach = true } = {}) {
  const fx = typeof fixture === "string" ? loadFixture(`${fixture}-derived`) : fixture;
  const guard = await guardHosts(page.context(), { siteOrigin: baseURL });
  const om = await routeOpenMeteo(page.context(), { forecast: fx.forecast, marine: fx.marine ?? null, status });
  if (clock) await page.clock.install({ time: new Date(fx.now ?? FIXTURE_NOW) });
  if (saveBeach && beach) await page.addInitScript(([k, v]) => { try { if (!localStorage.getItem(k)) localStorage.setItem(k, v); } catch { /* blocked */ } }, [BEACH_KEY, beach]);
  return { om, guard, fx };
}

/** Console pages: browser Supabase calls go to the harness fake; a fresh server state per test. */
export async function consoleApp(page, baseURL, { reset = true } = {}) {
  const h = harnessClient(baseURL);
  if (reset) await h.reset();
  const guard = await guardHosts(page.context(), { siteOrigin: baseURL });
  const supa = await routeSupabase(page.context(), { siteOrigin: baseURL });
  const apiCalls = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) apiCalls.push(`${r.method()} ${u.pathname}`); });
  const csp = [];
  page.on("console", (m) => { if (/Content Security Policy|Refused to (load|execute|connect|apply)/i.test(m.text())) csp.push(m.text()); });
  return { h, guard, supa, apiCalls, csp };
}

/** Add the two standard accounts to the fake Supabase. */
export async function seedUsers(h) {
  await h.supabase.addUser({ email: ADMIN.email, password: ADMIN.password, role: "super_admin" });
  await h.supabase.addUser({ email: PLAIN.email, password: PLAIN.password, role: "user" });
}

export async function noHorizontalScroll(page) {
  const o = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth, bw: document.body.scrollWidth }));
  expect(o.sw, `document is ${o.sw}px wide in a ${o.iw}px viewport`).toBeLessThanOrEqual(o.iw);
  expect(o.bw, `body is ${o.bw}px wide in a ${o.iw}px viewport`).toBeLessThanOrEqual(o.iw + 1);
}

/** 44 x 44 CSS px targets (axe only checks 24). Lists the offenders by accessible name so the report is actionable. */
export async function expectTargets44(page, selector = 'button, [role="button"], a.btn, a.day-row, a.beach-row, input:not([type="hidden"]), select, summary', { within } = {}) {
  const root = within ? page.locator(within) : page;
  const els = await root.locator(selector).all();
  const small = [];
  for (const el of els) {
    if (!(await el.isVisible())) continue;
    const b = await el.boundingBox();
    if (!b) continue;
    if (b.width < 43.5 || b.height < 43.5) small.push(`${(await el.evaluate((n) => (n.getAttribute("aria-label") || n.textContent || n.tagName).trim().replace(/\s+/g, " ").slice(0, 40)))} ${Math.round(b.width)}x${Math.round(b.height)}`);
  }
  expect(small, "targets under 44 x 44 CSS px").toEqual([]);
}

/** axe with Beach Day's tag set (wcag22aa is what turns target-size on). Returns { violations, incomplete } as short fingerprints. */
export async function axe(page, { include, exclude } = {}) {
  let b = new AxeBuilder({ page }).withTags(AXE_TAGS);
  if (include) b = b.include(include);
  if (exclude) b = b.exclude(exclude);
  const r = await b.analyze();
  const fp = (list) => list.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} node(s), first ${v.nodes[0]?.target?.join(" ")}`);
  return { violations: fp(r.violations), incomplete: fp(r.incomplete), raw: r };
}

export const verdictText = (key) => VERDICTS[key].label;
export const copy = t;

/** Drive the sign-in screen with role/text locators. */
export async function signIn(page, { email, password }) {
  await page.getByLabel(STRINGS["auth.field.email"], { exact: true }).fill(email);
  await page.getByLabel(STRINGS["auth.field.password"], { exact: true }).fill(password);
  await page.getByRole("button", { name: STRINGS["btn.signIn"], exact: true }).click();
}

/** Serve version.json changes: the "Live" check polls /version.json. */
export const setDeployedCommit = (h, sha) => h.harness.setVersion({ version: sha });
