# Example 02 — axe scan: deliberate violations, then fixed

## What it demonstrates
`scan.mjs` opens two versions of a tiny verdict card in Chromium at a 390×844 viewport. It runs `@axe-core/playwright` with Beach Day's tag set, `["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]`, and prints each violation's `id`, `impact`, `help`, node count and WCAG tags.
- `pages/bad.html` has five deliberate bugs:
  - no `lang` attribute;
  - an image without `alt`;
  - low-contrast verdict text (`#9cc3a8` on white);
  - two icon-only buttons with no accessible name;
  - those buttons are 16×16 and touching.
- `pages/fixed.html` fixes them:
  - `lang="en"`, `alt="Sunny"`, and dark green `#14532d` text;
  - `aria-label`s on the buttons;
  - 44×44 px targets with an 8 px gap (the Beach Day target size).
- The script fails if the bad page shows **no** violations, which proves the scan works. It also fails if the fixed page shows **any**, which is the gate.

Lessons confirmed by running it:
1. **`wcag22aa` matters.** It is the tag that turns on `target-size` (WCAG 2.5.8). Without it, the bad page shows 4 violations and the tiny buttons pass. In axe-core 4.14.1, `axe.getRules(['wcag22aa'])` returns only `target-size`, and there is **no `wcag22a` tag**.
2. **`AxeBuilder` needs a page from an explicit context.** A page from `browser.newPage()` throws `Please use browser.newContext()`. The `page` fixture in `@playwright/test` is fine.
3. **axe is not the whole check.** It found contrast on plain text here, but text over glass or images, focus order, and screen-reader wording still need manual checks. Playwright's accessibility guide says automated tests can't find every issue ([accessibility testing](https://playwright.dev/docs/accessibility-testing)).

## How to run
```bash
npm install          # @playwright/test 1.63.0 + @axe-core/playwright
node scan.mjs
```

## Verified
Ran on 2026-11-23 with Node v22.23.5, `@axe-core/playwright@4.14.0` (axe-core 4.14.1) and the preinstalled Chromium, from a scratch copy:
```
$ node scan.mjs
== bad.html: 5 violation(s), axe 4.14.1
- button-name [critical] Buttons must have discernible text (2 node(s)) tags=wcag2a,wcag412
- color-contrast [serious] Elements must meet minimum color contrast ratio thresholds (1 node(s)) tags=wcag2aa,wcag143
- html-has-lang [serious] <html> element must have a lang attribute (1 node(s)) tags=wcag2a,wcag311
- image-alt [critical] Images must have alternative text (1 node(s)) tags=wcag2a,wcag111
- target-size [serious] All touch targets must be 24px large, or leave sufficient space (2 node(s)) tags=wcag22aa,wcag258

== fixed.html: 0 violation(s), axe 4.14.1

RESULT: bad page caught, fixed page clean
```
The same scan without `"wcag22aa"` found `bad.html: 4 violation(s)`, with no `target-size`.
The first attempt, using `browser.newPage()`, failed with `Error: Please use browser.newContext()`, which is why the script now creates a context.
