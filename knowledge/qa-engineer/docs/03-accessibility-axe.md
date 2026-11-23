# Accessibility testing with axe-core and Playwright
Source: https://playwright.dev/docs/accessibility-testing , https://github.com/dequelabs/axe-core/blob/develop/doc/API.md
Retrieved: 2026-11-23

## Setup and basic scan
```js
import AxeBuilder from "@axe-core/playwright";        // the package also exports { AxeBuilder }
const results = await new AxeBuilder({ page })
  .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
  .analyze();
expect(results.violations).toEqual([]);
```
- Install with `npm i -D @axe-core/playwright`. [accessibility testing](https://playwright.dev/docs/accessibility-testing)
- **Builder methods:**
  - `withTags([...])` limits the rules to those tags.
  - `include(selector)` and `exclude(selector)` scope the scan.
  - `disableRules(['duplicate-id'])` turns off rules with known issues.
  - [accessibility testing](https://playwright.dev/docs/accessibility-testing)
- **Known issues:**
  - Prefer a snapshot of a violation **fingerprint**, for example `expect(violationFingerprints(results)).toMatchSnapshot()`, over disabling a rule everywhere.
  - Attach the full results with `testInfo.attach('accessibility-scan-results', { body: JSON.stringify(results, null, 2), contentType: 'application/json' })`.
  - [accessibility testing](https://playwright.dev/docs/accessibility-testing)
- **Shared builder:** a fixture such as `makeAxeBuilder` applies the same `withTags` and `exclude` everywhere. [accessibility testing](https://playwright.dev/docs/accessibility-testing)
- **Limits:** automated scans find only some issues. Manual and assistive-technology testing are still needed. [accessibility testing](https://playwright.dev/docs/accessibility-testing)

## Result shape
- `results.violations`, `passes`, `incomplete` ("needs review") and `inapplicable`.
- Each entry has `id`, `impact`, `tags`, `description`, `help`, `helpUrl` and `nodes[]`.
- Each node has `target`, `html` and `failureSummary`.
- [axe API](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md). The field names were confirmed by printing real results in example 02.

## axe tags (from the axe-core API doc)
| Tag | Meaning |
|---|---|
| `wcag2a` / `wcag2aa` / `wcag2aaa` | WCAG 2.0 A / AA / AAA |
| `wcag21a` / `wcag21aa` | WCAG 2.1 A / AA |
| `wcag22aa` | WCAG 2.2 AA |
| `best-practice` | Common practices that are not WCAG requirements |
| `wcag***` | A single success criterion, for example `wcag111` is SC 1.1.1 |
| `ACT`, `section508`, `TTv5`, `EN-301-549`, `RGAAv4` | Other standards |
| `experimental` | Cutting-edge rules, **disabled by default** |
| `cat.*` | Deque category, for example `cat.color` or `cat.keyboard` |
[axe API § tags](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md)

- **There is no `wcag22a` tag.** The doc's table doesn't list one, and with axe-core 4.14.1 locally, `axe.getRules(['wcag22a'])` returns 0 rules.
- **`wcag22aa` adds just one rule in 4.14.1:** `getRules(['wcag22aa'])` returns `["target-size"]`, which is SC 2.5.8 (24 px minimum, or enough spacing).
- **Tag lists are not cumulative.** `wcag22aa` alone does not include 2.0 or 2.1 rules, so always pass the full list.

## Gotchas seen when running (example 02)
- Calling `AxeBuilder.analyze()` on a page from `browser.newPage()` throws "Please use browser.newContext()". Use `context.newPage()` or the test's `page` fixture.
- **What the scan does not catch:**
  - Contrast on text over images, gradients or `backdrop-filter` is often reported as `incomplete`, not as a violation **[UNVERIFIED for our glass CSS]**. Review `incomplete`.
  - Beach Day's 44 px target size is stricter than WCAG's 24 px, so axe won't flag 30 px targets. Check them with a custom assertion on `boundingBox()`.

## Beach Day notes
- **Standard builder:**
  - `new AxeBuilder({ page }).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"])`.
  - Require `violations.length === 0` on every changed screen, on both the `pixel` and `iphone` projects. Scan after the verdict has loaded, because the scan only covers what is rendered.
  - Attach results to failing tests.
- Scan in light, dark and `contrast: 'more'` modes, because glass colours change.
- **Manual checklist (axe can't do these):**
  - Verdicts must not rely on colour. Assert the text, as example 01 does.
  - VoiceOver and TalkBack must read the verdict through `role="status"`.
  - Streaming chat uses `role="log"` with `aria-busy` while streaming.
  - Focus order.
  - Reflow at 320 CSS px.
- Never disable a rule globally to get a PASS. Use a fingerprint snapshot and file the issue with its owner (Sable or Wren).
