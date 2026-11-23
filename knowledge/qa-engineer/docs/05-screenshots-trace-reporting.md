# Screenshots, traces and honest reporting
Source: https://playwright.dev/docs/screenshots , https://playwright.dev/docs/trace-viewer , https://playwright.dev/docs/test-configuration
Retrieved: 2026-11-23

## Screenshots
Source for both bullets: [screenshots](https://playwright.dev/docs/screenshots)
- **Ways to capture:**
  - `await page.screenshot({ path: "screenshot.png" })`
  - Add `fullPage: true` for the whole scrollable page.
  - `const buffer = await page.screenshot()` gives a buffer instead of a file.
  - `await page.locator(".header").screenshot({ path })` captures one element.
- **Visual comparison:** `expect(page).toHaveScreenshot()` is the visual-comparison assertion. It is covered on a separate page, not re-read here.

Store screenshots under the test's output dir with `testInfo.outputPath("name.png")`. The file name should include `testInfo.project.name`, so the iPhone and Pixel images don't overwrite each other. Example 01 does this.

## Trace viewer
Source for every bullet: [trace viewer](https://playwright.dev/docs/trace-viewer)
- **Options:**
  - `'off'`
  - `'on'` ("not recommended as it's performance heavy")
  - `'retain-on-failure'`
  - `'on-first-retry'`
  - `'on-all-retries'`
- **CI:** record on the first retry, `trace: 'on-first-retry'`. If you don't use retries, `retain-on-failure` still keeps traces of failed tests.
- **CLI override:** `npx playwright test --trace on` records a trace while debugging.

## Test timeout and artifacts
- The default per-test timeout is **30 s**. `outputDir` defaults to `test-results`. [test-configuration](https://playwright.dev/docs/test-configuration)

## Beach Day notes
- Run with **`--trace off`** by default (agent rule). Turn traces on only to debug a failure, then attach or describe the trace in the HANDOFF.
- **UI changes:**
  - Take screenshots on both the `iphone` and `pixel` projects for review.
  - Each device already sets its own DPR: 3 for iPhone 15, 2.625 for Pixel 7. Override with `deviceScaleFactor: 2` after the device spread if the review needs equal sizes.
  - If WebKit isn't installed (as in this sandbox), say so. Don't substitute a Chromium screenshot labelled "iPhone".
- **Gate report format:**
  - List the exact commands, the pass and fail counts, which projects were **not run**, and why.
  - Example: "iphone: not run — WebKit not installed (`Executable doesn't exist at /opt/pw-browsers/webkit-2359/pw_run.sh`)."
  - Mark the gate **PASS** only when everything required was run and passed. Otherwise use FAIL or "incomplete".
- Commit no `test-results/` or `playwright-report/` folders. Add them to `.gitignore` when the real test suite is created (owner: qa-engineer).
