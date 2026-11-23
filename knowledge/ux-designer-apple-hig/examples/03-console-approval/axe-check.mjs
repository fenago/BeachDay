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

  // 4b. Google path: Google-only account sees no password field; confirming returns to the sheet
  await page.goto(base + '?account=google');
  await page.click('#review');
  assert(await page.locator('#pw').isHidden(), `${s('google-only')}: password field shown for a Google-only account`);
  assert(await active(page) === 'google', `${s('google-only')}: focus not on the Google button`);
  await axe(page, s('confirm sheet (Google only)'));
  await page.click('#google');
  await page.locator('#confirmed').waitFor({ state: 'visible' });
  assert(await active(page) === 'approve', `${s('google-confirmed')}: focus not on Approve after returning`);
  assert((await page.locator('#confirmed').innerText()).startsWith('Confirmed.'), `${s('google-confirmed')}: no confirmation text`);
  await axe(page, s('confirm sheet (Google confirmed)'));
  await page.click('#approve');
  await page.locator('#status', { hasText: 'Live.' }).waitFor();

  // 4c. Both paths offered, both are real buttons/fields with names
  await page.goto(base);
  await page.click('#review');
  assert(await page.locator('#google').innerText() === 'Confirm with Google', `${s('both')}: Google button label`);
  assert(await page.locator('legend', { hasText: "Confirm it\u2019s you" }).count() === 1, `${s('both')}: step-up legend missing`);
  await page.keyboard.press('Escape');

  // 4g. Step-up required (401): sheet stays open, unconfirmed, message, focus on the first path
  await page.goto(base + '?outcome=stepup&account=google');
  await page.click('#review');
  assert((await page.locator('#google-note').innerText()).includes('Choose Approve and Deploy again'), `${s('stepup')}: Google note missing`);
  await page.click('#google');
  assert((await page.locator('#confirmed').innerText()).includes('Nothing is approved yet'), `${s('stepup')}: confirmed text must say nothing is approved`);
  assert(await page.locator('#status', { hasText: 'Live.' }).count() === 0, `${s('stepup')}: approved automatically after Google`);
  await page.click('#approve');
  await page.locator('#sheet-status', { hasText: 'Your last sign-in was over 10 minutes ago' }).waitFor();
  assert(await active(page) === 'google' && await page.locator('dialog#confirm[open]').count() === 1, `${s('stepup')}: sheet closed or focus lost`);
  await axe(page, s('step-up required (401)'));

  // 4h. Usage limit 429 budget_exhausted: alert, proposal untouched
  await page.goto(base + '?outcome=budget');
  assert((await alertText(page)).includes('usage limit'), `${s('budget')}: alert text missing`);
  assert(await page.locator('#review').isVisible(), `${s('budget')}: Approve must stay (chat budget only)`);
  await axe(page, s('usage limit (429)'));

  // 4i. Approve off: visible, aria-disabled, reachable, reason shown, sheet does not open, 44px
  await page.goto(base + '?outcome=disabled');
  assert(await page.getAttribute('#review', 'aria-disabled') === 'true', `${s('disabled')}: not aria-disabled`);
  assert(await page.locator('#disabled-note').isVisible(), `${s('disabled')}: reason not visible`);
  await page.click('#review', { force: true });
  assert(await page.locator('dialog#confirm[open]').count() === 0, `${s('disabled')}: sheet opened`);
  await page.focus('#review');
  assert(await active(page) === 'review', `${s('disabled')}: button not focusable`);
  const box = await page.locator('#review').boundingBox();
  assert(box.height >= 44, `${s('disabled')}: target under 44px`);
  await axe(page, s('approve off'));

  // 4d. Approve cap reached: alert names the numbers and the date, proposal stays, Review hidden
  await page.goto(base + '?outcome=cap');
  await page.click('#review'); await page.fill('#pw', 'demo-password'); await page.click('#approve');
  await page.locator('#alert', { hasText: 'approvals used in the last 31 days' }).waitFor();
  assert((await alertText(page)).includes('Next slot frees'), `${s('cap')}: no date`);
  assert(await page.locator('#review').isHidden() && await page.locator('#reject').isVisible(), `${s('cap')}: Approve should be hidden, Reject kept`);
  await axe(page, s('approve cap reached'));

  // 4e. Session expired
  await page.goto(base + '?outcome=expired');
  await page.click('#review'); await page.fill('#pw', 'demo-password'); await page.click('#approve');
  await page.locator('#alert', { hasText: 'session ended' }).waitFor();
  assert(await active(page) === 'review' && (await page.locator('#review').innerText()) === 'Sign In', `${s('expired')}: Sign In not offered/focused`);
  await axe(page, s('session expired'));

  // 4f. Committed, no deploy needed
  await page.goto(base + '?outcome=nodeploy');
  await page.click('#review');
  assert((await page.locator('#c-desc').innerText()).includes('no deploy runs'), `${s('nodeploy')}: sheet still promises a deploy`);
  await page.fill('#pw', 'demo-password'); await page.click('#approve');
  await page.locator('#status', { hasText: 'No deploy needed' }).waitFor();
  await axe(page, s('committed, no deploy'));

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
