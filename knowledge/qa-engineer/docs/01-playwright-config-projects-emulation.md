# Playwright: configuration, projects and device emulation
Source: https://playwright.dev/docs/test-configuration , https://playwright.dev/docs/test-projects , https://playwright.dev/docs/emulation
Retrieved: 2026-11-23

## Config file
```js
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,          // fail CI if test.only was left in
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: { baseURL: "http://localhost:3000", trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: { command: "npm run start", url: "http://localhost:3000", reuseExistingServer: !process.env.CI },
});
```
- This is the example from [test-configuration](https://playwright.dev/docs/test-configuration).
- Each test gets **30 seconds** by default (`timeout`). That time includes fixtures and `beforeEach` hooks. [test-configuration](https://playwright.dev/docs/test-configuration)
- `outputDir` (default `test-results`) holds screenshots, videos and traces. [test-configuration](https://playwright.dev/docs/test-configuration)
- `webServer` starts the app before the tests and waits for `url`. [test-configuration](https://playwright.dev/docs/test-configuration)

## Projects
- All projects run by default. To run one, use `npx playwright test --project=<name>`. [test-projects](https://playwright.dev/docs/test-projects)
- A project can set its own `use`, `retries`, `testMatch` and `testIgnore`. [test-projects](https://playwright.dev/docs/test-projects)
- `dependencies: ["setup"]` runs a setup project first. [test-projects](https://playwright.dev/docs/test-projects)
- The docs' mobile example uses `devices['Pixel 5']` and `devices['iPhone 12']`. Any name in the device registry works. [test-projects](https://playwright.dev/docs/test-projects)

## Device descriptors
- `devices[...]` comes from Playwright's registry, `deviceDescriptorsSource.json`. [emulation](https://playwright.dev/docs/emulation)
- **Spread the device first, then override.** "It is important to define the `viewport` property after destructuring `devices`", and the same applies to `isMobile`. [emulation](https://playwright.dev/docs/emulation)
- **Platform user agents:** preset devices assume a specific platform. For example, "Desktop Chrome" sends a Windows user agent. To use the real platform's user agent, set `userAgent: undefined`. [emulation](https://playwright.dev/docs/emulation)

The two Beach Day devices, read locally from `playwright@1.63.0`:

| Device | Viewport | Screen | DPR | isMobile/hasTouch | Browser |
|---|---|---|---|---|---|
| `iPhone 15` | 393×659 | 393×852 | 3 | true/true | **webkit** |
| `Pixel 7` | 412×839 | 412×915 | 2.625 | true/true | chromium |

## Emulation options (all accepted in `use`, `test.use()` or `browser.newContext()`)
Source for every bullet: [emulation](https://playwright.dev/docs/emulation)
- **`viewport`, `deviceScaleFactor`:** `page.setViewportSize()` changes the size for a single page.
- **`isMobile`:** turns on the meta viewport tag and touch events.
- **`locale`, `timezoneId`:** these affect only the browser. The test runner's timezone is set with the `TZ` environment variable.
- **Permissions and location:**
  - `permissions: ['geolocation']` plus `geolocation: { latitude, longitude }`.
  - `context.setGeolocation()` changes the location for every page in the context.
  - `context.grantPermissions(...)` and `clearPermissions()` manage permissions.
- **Media features:**
  - `colorScheme: 'light' | 'dark' | 'no-preference'`
  - `reducedMotion: 'reduce' | 'no-preference'`
  - `forcedColors: 'active' | 'none'`
  - `contrast: 'more' | 'no-preference'`
  - `page.emulateMedia({...})` changes any of these for a single page.
- **`offline: true`:** affects requests that use the browser's normal network stack, such as navigations, `fetch`, XHR and WebSockets. It does not affect WebRTC.
- **`javaScriptEnabled: false`** and **`userAgent`** can also be set.

## Beach Day notes
- **Projects:**
  - `iphone` uses `{ ...devices["iPhone 15"] }`, which runs WebKit. It is the closest stand-in for iOS Safari, but it is **not** real Safari.
  - `pixel` uses `{ ...devices["Pixel 7"] }`, which runs Chromium.
  - Both use `serviceWorkers: "block"` (doc 02). The offline spec is a separate Chromium project with service workers allowed.
- **Shared `use` settings:**
  - `timezoneId: "America/New_York"`, because Open-Meteo times are local wall-clock for our `timezone` parameter.
  - `locale: "en-US"`.
- **In this sandbox only Chromium is installed** (`/opt/pw-browsers/chromium-1243`). The `iphone` project fails with `Executable doesn't exist at /opt/pw-browsers/webkit-2359/pw_run.sh` (example 01). Report it as **not run**, never PASS.
- **Run commands:**
  - Run with `--trace off` unless you are debugging.
  - Use `retries: 2` in CI only, together with `trace: 'on-first-retry'`.
- **Accessibility checks:**
  - Add a dark-mode, reduced-motion and forced-colors pass for the glass UI.
  - Verdicts must stay readable as text in `forcedColors: 'active'`.
  - Glass needs a fallback under `contrast: 'more'`.
- Check layout at 393 px and 412 px wide with no horizontal scroll. Example 01 asserts `scrollWidth <= innerWidth`.
