// Offline / service-worker project. Chromium only: Playwright supports service workers only there.
// Every other project in the real config sets serviceWorkers: "block" (docs/06 §4).
import { defineConfig, devices } from "@playwright/test";
const PORT = 4174;
export default defineConfig({
  testDir: "tests",
  fullyParallel: false, // the specs share one server whose "deploy" version they change
  reporter: "list",
  use: { baseURL: `http://127.0.0.1:${PORT}`, timezoneId: "America/New_York", locale: "en-US", trace: "off" },
  projects: [{ name: "offline-sw", use: { ...devices["Pixel 7"], serviceWorkers: "allow" } }],
  webServer: { command: "node server.mjs", url: `http://127.0.0.1:${PORT}/`, env: { PORT: String(PORT) }, reuseExistingServer: false },
});
