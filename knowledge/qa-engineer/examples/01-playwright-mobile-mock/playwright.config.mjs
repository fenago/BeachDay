// Beach Day mobile e2e config (example). Run: npx playwright test --trace off
import { defineConfig, devices } from "@playwright/test";

const PORT = 4173;

export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    timezoneId: "America/New_York",
    locale: "en-US",
    trace: "off", // turn on ('on-first-retry') only when debugging
    // Requests a service worker handles never reach page.route(); block SWs
    // in data/UI specs. The offline spec (not here) runs with SWs allowed.
    serviceWorkers: "block",
  },
  projects: [
    // devices[...] must be spread FIRST; overrides go after it.
    // iPhone 15 uses WebKit (defaultBrowserType: "webkit").
    { name: "iphone", use: { ...devices["iPhone 15"] } },
    // Pixel 7 uses Chromium.
    { name: "pixel", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `node server.mjs`,
    url: `http://127.0.0.1:${PORT}/`,
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
  },
});
