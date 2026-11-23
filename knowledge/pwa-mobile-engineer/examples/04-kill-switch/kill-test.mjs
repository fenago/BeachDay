// Run: node kill-test.mjs  (global Playwright, Chromium). Proves the kill switch recovers a page stuck on a cached shell.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { startServer } from '../02-service-worker/server.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const KILL = readFileSync(new URL('./kill-sw.js', import.meta.url), 'utf8');
assert.ok(!/importScripts|\bimport\b|addEventListener\("fetch"/.test(KILL), 'no imports, no fetch handler');

const app = await startServer({ version: 'v-bad' });
let killOn = false;
const front = createServer(async (req, res) => {
  if (killOn && req.url.startsWith('/sw.js')) {
    res.writeHead(200, { 'content-type': 'text/javascript', 'cache-control': 'no-cache' });
    return res.end(KILL);
  }
  const r = await fetch(`http://127.0.0.1:${app.port}${req.url}`);
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => front.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${front.address().port}`;

const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: 'allow' });
await context.route('https://api.open-meteo.com/**', (r) => r.fulfill({ status: 200, contentType: 'application/json',
  headers: { 'access-control-allow-origin': '*' }, body: '{"daily":{"time":["2026-11-23"],"sunrise":["2026-11-23T06:44"],"sunset":["2026-11-23T17:29"]}}' }));
const page = await context.newPage();
await page.goto(`${ORIGIN}/`);
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
const before = await page.evaluate(async () => ({ controlled: !!navigator.serviceWorker.controller, caches: await caches.keys() }));
assert.ok(before.controlled && before.caches.length > 0);
console.log('✔ before: page controlled by bad sw, caches =', before.caches.join(', '));

killOn = true;                       // human deploys the kill-switch at the stable /sw.js URL
let navs = 0; page.on('framenavigated', (f) => { if (f === page.mainFrame()) navs++; });
await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r.update()));
await page.waitForFunction(() => navigator.serviceWorker.getRegistrations().then((rs) => rs.length === 0), null, { timeout: 10000 });
await page.waitForLoadState('load');
await page.waitForTimeout(500);
const after = await page.evaluate(async () => ({ regs: (await navigator.serviceWorker.getRegistrations()).length,
  caches: await caches.keys(), controlled: !!navigator.serviceWorker.controller, status: document.querySelector('#status')?.textContent }));
assert.deepEqual([after.regs, after.caches.length, after.controlled], [0, 0, false]);
assert.ok(navs >= 1, 'controlled client was reloaded');
console.log(`✔ after: registrations=${after.regs}, caches=${after.caches.length}, controlled=${after.controlled}, client reloaded (${navs} navigation), page still loads from network`);
await browser.close(); front.close(); await app.close();
console.log('\nKILL SWITCH CHECKS PASSED');
