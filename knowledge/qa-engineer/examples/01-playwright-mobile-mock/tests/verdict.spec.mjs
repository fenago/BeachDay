// Verdict e2e with Open-Meteo mocked by page.route. No real network.
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";

const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/forecast-miami-beach-2026-11-23.json", import.meta.url), "utf8"),
);
// The glob must match the WHOLE URL, including the query string.
const OPEN_METEO = "https://api.open-meteo.com/v1/forecast?**";

// Guard: record every host the page contacts; afterEach fails the test if
// anything other than our server or the (mocked) Open-Meteo API was hit.
let hosts;
test.beforeEach(async ({ page }) => {
  hosts = new Set();
  page.on("request", (req) => hosts.add(new URL(req.url()).hostname));
});
test.afterEach(() => {
  expect([...hosts].filter((h) => !["127.0.0.1", "api.open-meteo.com"].includes(h))).toEqual([]);
});

test("calm real-world day shows a text verdict, best window and reasons", async ({ page }) => {
  let calls = 0;
  await page.route(OPEN_METEO, async (route) => {
    calls++;
    expect(new URL(route.request().url()).searchParams.get("timezone")).toBe("America/New_York");
    await route.fulfill({ json: fixture });
  });
  await page.goto("/");

  const verdict = page.getByRole("status");
  await expect(verdict).toHaveText("Great beach day (95/100)");
  await expect(page.getByText("Best time: 10:00–13:00")).toBeVisible();
  await expect(page.getByRole("listitem")).toHaveText(["Partly cloudy", "A bit cool"]);
  // Safety + attribution must always be on screen.
  await expect(page.getByRole("link", { name: "NWS rip-current risk" })).toHaveAttribute("href", "https://www.weather.gov/beach/mfl");
  await expect(page.getByRole("link", { name: "Weather data by Open-Meteo.com" })).toBeVisible();
  expect(calls).toBe(1);
});

test("thunderstorms all day -> Skip it", async ({ page }) => {
  const stormy = structuredClone(fixture);
  for (let i = 8; i <= 17; i++) stormy.hourly.weather_code[i] = 95;
  await page.route(OPEN_METEO, (route) => route.fulfill({ json: stormy }));
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Skip it (0/100)");
  await expect(page.getByRole("listitem").first()).toHaveText("Thunderstorms");
});

test("API error (429) degrades to a friendly message", async ({ page }) => {
  await page.route(OPEN_METEO, (route) =>
    route.fulfill({ status: 429, json: { error: true, reason: "Too many requests" } }),
  );
  await page.goto("/");
  await expect(page.getByRole("status")).toHaveText("Forecast unavailable — try again later.");
});

test("layout fits the phone viewport (no horizontal scroll)", async ({ page }, testInfo) => {
  await page.route(OPEN_METEO, (route) => route.fulfill({ json: fixture }));
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Great beach day");
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(innerWidth);
  await page.screenshot({ path: testInfo.outputPath(`verdict-${testInfo.project.name}.png`) });
});
