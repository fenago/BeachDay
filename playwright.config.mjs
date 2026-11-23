// Beach Day browser tests (docs/06 §4). Run: npm run e2e   (= playwright test --trace off)
// Projects:
//   pixel           Pixel 7, Chromium.
//   iphone-chromium iPhone 15 viewport + user agent + touch, but CHROMIUM. No WebKit is installed here, so this is NOT
//                   Safari: it checks the iPhone-sized layout only. Real WebKit: "iphone (webkit): not run".
//   offline-sw      Pixel 7, Chromium, service workers allowed, offline.spec only, one worker.
// The webServer is the full-stack harness (real function code, fake Supabase/GitHub/Anthropic): tests/harness/server.mjs.
import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 4173);
const baseURL = process.env.BASE_URL ?? `http://127.0.0.1:${PORT}`;
const useHarness = !process.env.BASE_URL; // BASE_URL set = run @prod specs against a deployed site, no local server

export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.(mjs|js|ts)$/,
  fullyParallel: false,
  workers: 1, // one harness, shared fakes and shared "deploy" version
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 7_000 },
  outputDir: "test-results",
  use: { baseURL, timezoneId: "America/New_York", locale: "en-US", trace: "off", screenshot: "off", video: "off" },
  projects: [
    { name: "pixel", testIgnore: /offline\.spec/, use: { ...devices["Pixel 7"], serviceWorkers: "block" } },
    // Spread the device first, then override: iPhone 15 normally runs WebKit.
    { name: "iphone-chromium", testIgnore: /offline\.spec/, use: { ...devices["iPhone 15"], defaultBrowserType: "chromium", browserName: "chromium", serviceWorkers: "block" } },
    { name: "offline-sw", testMatch: /offline\.spec/, use: { ...devices["Pixel 7"], serviceWorkers: "allow" } },
  ],
  webServer: useHarness
    ? { command: "node tests/harness/server.mjs", url: `${baseURL}/__harness/health`, env: { PORT: String(PORT) }, reuseExistingServer: false, timeout: 30_000, stdout: "ignore", stderr: "pipe" }
    : undefined,
});
