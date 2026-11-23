// axe scan of a page with deliberate bugs, then the fixed page.
// Run: node scan.mjs   (uses Playwright's Chromium; no network needed)
import { chromium } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

// Beach Day's tag set. NOTE: axe has no "wcag22a" tag; "wcag22aa" adds the
// WCAG 2.2 AA rule(s) (target-size) on top of the 2.0/2.1 tags.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const browser = await chromium.launch();
let exitCode = 0;
try {
  for (const name of ["bad", "fixed"]) {
    // AxeBuilder needs a page from an explicit context: browser.newPage()
    // fails with "Please use browser.newContext()" (seen with 4.14.0).
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(new URL(`./pages/${name}.html`, import.meta.url).href);
    const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
    console.log(`\n== ${name}.html: ${results.violations.length} violation(s), axe ${results.testEngine.version}`);
    for (const v of results.violations) {
      console.log(`- ${v.id} [${v.impact}] ${v.help} (${v.nodes.length} node(s)) tags=${v.tags.filter((t) => t.startsWith("wcag")).join(",")}`);
    }
    if (name === "bad" && results.violations.length === 0) exitCode = 1; // scan must catch the bugs
    if (name === "fixed" && results.violations.length > 0) exitCode = 1; // gate: zero violations
    await context.close();
  }
} finally {
  await browser.close();
}
console.log(exitCode ? "\nRESULT: FAIL" : "\nRESULT: bad page caught, fixed page clean");
process.exit(exitCode);
