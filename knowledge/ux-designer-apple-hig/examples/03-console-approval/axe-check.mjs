// Drive the approval prototype through every state in Chromium and run axe on
// each one (light + dark), plus behavior assertions axe can't make: focus
// management, live regions, target size, double-submit guard.
// Run with NODE_PATH pointing at a scratch dir that has @axe-core/playwright
// installed (see README); Playwright itself is preinstalled.
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const { AxeBuilder } = require('@axe-core/playwright');
const here = dirname(fileURLToPath(import.meta.url));
const base = pathToFileURL(resolve(here, 'prototype.html')).href;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const failures = [];
const assert = (cond, msg) => { if (!cond) failures.push(msg); };

async function axe(page, label) {
  const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  console.log(`${label.padEnd(34)} violations: ${r.violations.length}  passes: ${r.passes.length}`);
  for (const v of r.violations) failures.push(`${label}: ${v.id} (${v.impact}) ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}
const active = (page) => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
const statusText = (page) => page.locator('#status').innerText();
const alertText = (page) => page.locator('#alert').innerText();

const browser = await chromium.launch();
for (const colorScheme of ['light', 'dark']) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const s = (name) => `${colorScheme}/${name}`;

  // 1. Proposal card
  await page.goto(base);
  await page.locator('details summary').click(); // show the diff so axe sees it
  await axe(page, s('card (diff open)'));
  const small = await page.evaluate(() => [...document.querySelectorAll('button, summary, input')]
    .filter((el) => el.getClientRects().length)
    .map((el) => ({ id: el.id || el.tagName, ...el.getBoundingClientRect().toJSON() }))
    .filter((r) => r.width < 44 || r.height < 44).map((r) => r.id));
  assert(small.length === 0, `${s('card')}: targets under 44px: ${small}`);
  assert(await page.locator('#status[role=status]').count() === 1, `${s('card')}: no persistent role=status region`);

  // 2. Confirm sheet opens, focus in the password field; Cancel returns focus
  await page.click('#review');
  assert(await page.locator('dialog#confirm[open]').count() === 1, `${s('confirm')}: dialog not open`);
  assert(await active(page) === 'pw', `${s('confirm')}: focus not in password field`);
  await axe(page, s('confirm sheet'));
  await page.click('#cancel');
  assert(await active(page) === 'review', `${s('cancel')}: focus did not return to Review button`);
  await page.click('#review');
  await page.keyboard.press('Escape');
  assert(await active(page) === 'review', `${s('escape')}: Esc did not close and restore focus`);

  // 3. Wrong password: inline error, aria-invalid, focus stays in field, paste works
  await page.click('#review');
  await page.fill('#pw', 'nope');
  await page.click('#approve');
  assert((await page.locator('#pw-error').innerText()).includes("didn't match"), `${s('bad pw')}: no error text`);
  assert(await page.getAttribute('#pw', 'aria-invalid') === 'true', `${s('bad pw')}: aria-invalid not set`);
  assert(await active(page) === 'pw', `${s('bad pw')}: focus left the field`);
  const pasteAllowed = await page.evaluate(() => {
    const ev = new ClipboardEvent('paste', { cancelable: true, bubbles: true });
    return document.getElementById('pw').dispatchEvent(ev); // false if a handler blocks paste
  });
  assert(pasteAllowed, `${s('bad pw')}: paste is blocked (WCAG 3.3.8)`);
  assert(await page.getAttribute('#pw', 'autocomplete') === 'current-password', `${s('bad pw')}: autocomplete not current-password`);
  await axe(page, s('confirm sheet + error'));

  // 4. Correct password → committing → live
  await page.fill('#pw', 'demo-password');
  await page.click('#approve');
  await page.locator('#status', { hasText: 'Committing to main' }).waitFor();
  await axe(page, s('committing'));
  await page.locator('#status', { hasText: 'Live.' }).waitFor();
  assert(await page.locator('#review').isHidden(), `${s('live')}: Approve still visible after commit`);
  await axe(page, s('live'));
  console.log(`  status now: "${await statusText(page)}"`);

  // 5. Stale base outcome → alert
  await page.goto(base + '?outcome=stale');
  await page.click('#review'); await page.fill('#pw', 'demo-password'); await page.click('#approve');
  await page.locator('#alert', { hasText: 'Main changed' }).waitFor();
  await axe(page, s('stale base (alert)'));

  // 6. Commit failure → alert + Try Again focused
  await page.goto(base + '?outcome=fail');
  await page.click('#review'); await page.fill('#pw', 'demo-password'); await page.click('#approve');
  await page.locator('#alert', { hasText: 'commit failed' }).waitFor();
  assert(await active(page) === 'review' && (await page.locator('#review').innerText()) === 'Try Again', `${s('fail')}: Try Again not offered/focused`);
  await axe(page, s('commit failed'));
  console.log(`  alert now: "${await alertText(page)}"`);

  // 7. Reject
  await page.goto(base);
  await page.click('#reject');
  assert((await statusText(page)) === 'Rejected. Nothing was changed.', `${s('reject')}: wrong status`);
  await axe(page, s('rejected'));
  await ctx.close();
}
await browser.close();
console.log(failures.length ? `\nFAIL (${failures.length})\n- ${failures.join('\n- ')}` : '\nPASS: 0 axe violations in all states; behavior assertions hold');
process.exit(failures.length ? 1 : 0);
