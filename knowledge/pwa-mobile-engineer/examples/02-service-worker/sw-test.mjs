// Playwright (Chromium) proof for the Beach Day service worker.
// Run: node sw-test.mjs     (uses the preinstalled global `playwright`; no browser download)
// Open-Meteo is mocked with context.route() — Chromium routes service-worker fetches through the context.
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { startServer } from './server.mjs';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const FORECAST = { latitude: 25.814812, longitude: -80.12985, utc_offset_seconds: -18000, timezone: 'America/New_York',
  daily_units: { time: 'iso8601', sunrise: 'iso8601', sunset: 'iso8601' },
  daily: { time: ['2026-11-23'], sunrise: ['2026-11-23T06:44'], sunset: ['2026-11-23T17:29'] } };

const log = (...a) => console.log('✔', ...a);
let mode = 'ok'; // 'ok' | 'slow' | 'down'
let omHits = 0;

let srv = await startServer({ version: 'v1' });
const PORT = srv.port;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const browser = await chromium.launch();
const context = await browser.newContext({ serviceWorkers: 'allow' });
await context.route('https://api.open-meteo.com/**', async (route) => {
  omHits++;
  if (mode === 'down') return route.abort('internetdisconnected');
  if (mode === 'slow') await new Promise((r) => setTimeout(r, 6000));
  await route.fulfill({ status: 200, contentType: 'application/json',
    headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(FORECAST) }).catch(() => {});
});
const page = await context.newPage();

const cacheState = () => page.evaluate(async () => {
  const out = {};
  for (const name of await caches.keys()) {
    const c = await caches.open(name);
    out[name] = (await c.keys()).map((r) => r.url.replace(location.origin, ''));
  }
  return out;
});
const swVersion = () => page.evaluate(() => new Promise((resolve) => {
  const ch = new MessageChannel();
  ch.port1.onmessage = (e) => resolve(e.data.version);
  navigator.serviceWorker.controller.postMessage({ type: 'GET_VERSION' }, [ch.port2]);
}));

try {
  // 1. Registration: first visit installs + activates; second load is controlled.
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  const reg = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return { scope: r.scope, active: r.active.state, script: r.active.scriptURL };
  });
  assert.equal(reg.scope, `${ORIGIN}/`);
  assert.equal(reg.active, 'activated');
  assert.equal(await swVersion(), 'v1');
  log('registered, scope', reg.scope, 'state', reg.active, 'version v1, page controlled');

  // 2. Cache contents: shell precached into versioned cache; Open-Meteo response in data cache; /api never cached.
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Updated'));
  const apiRes = await page.evaluate(async () => (await fetch('/api/hello')).json());
  assert.ok(apiRes.hits >= 1);
  let cs = await cacheState();
  assert.deepEqual(Object.keys(cs).sort(), ['beachday-data-v1', 'beachday-shell-v1']);
  assert.deepEqual(cs['beachday-shell-v1'].sort(), ['/', '/app.js', '/manifest.webmanifest', '/offline.html']);
  assert.equal(cs['beachday-data-v1'].length, 1);
  assert.match(cs['beachday-data-v1'][0], /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?/);
  assert.ok(!JSON.stringify(cs).includes('/api/'), '/api/* must never be cached');
  log('caches:', JSON.stringify(cs));

  // 3. Network-first with 4 s timeout: slow Open-Meteo -> cached copy served after ~4 s.
  mode = 'slow';
  const t0 = Date.now();
  const slow = await page.evaluate(() => window.__bd.loadForecast());
  const took = Date.now() - t0;
  assert.equal(slow.fromCache, true);
  assert.ok(took >= 3900 && took < 5900, `expected ~4 s, took ${took} ms`);
  log(`slow network: answered from cache in ${took} ms; status = "${await page.textContent('#status')}"`);
  mode = 'ok';

  // 4. Offline reload: server stopped + browser offline + Open-Meteo unreachable.
  await srv.close();
  mode = 'down';
  await context.setOffline(true);
  await page.reload();
  await page.waitForFunction(() => /showing data from|no saved/.test(document.querySelector('#status').textContent));
  const offlineText = await page.textContent('#status');
  assert.match(offlineText, /^Offline — showing data from \d{1,2}:\d{2}/);
  assert.equal(await page.textContent('#sunrise'), 'Sunrise 06:44');
  const apiOffline = await page.evaluate(() => fetch('/api/hello').then(() => 'ok', () => 'failed'));
  assert.equal(apiOffline, 'failed', '/api/* must not be served from cache');
  log(`offline reload: shell from cache, status = "${offlineText}", /api/hello -> ${apiOffline}`);

  // 5. Update flow: deploy v2 (same URL, different bytes) -> waiting -> toast -> SKIP_WAITING -> reload once.
  await context.setOffline(false);
  mode = 'ok';
  srv = await startServer({ port: PORT, version: 'v2' });
  await page.reload(); // navigation triggers the update check
  await page.waitForSelector('#update-toast:not([hidden])', { timeout: 10000 });
  const waiting = await page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return { waiting: r.waiting?.state, active: r.active?.state };
  });
  assert.deepEqual(waiting, { waiting: 'installed', active: 'activated' });
  assert.equal(await swVersion(), 'v1', 'old worker still controls the page while the new one waits');
  cs = await cacheState();
  assert.ok(cs['beachday-shell-v1'] && cs['beachday-shell-v2'], 'both shells exist while waiting');
  log('update found: v2 waiting, toast shown, page still on v1');

  const navs = [];
  page.on('framenavigated', (f) => f === page.mainFrame() && navs.push(f.url()));
  // Tap Refresh: SW skips waiting -> controllerchange -> page reloads itself once.
  await Promise.all([page.waitForEvent('load'), page.click('#update-refresh')]);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await page.waitForTimeout(1000); // a second (looping) reload would show up here
  assert.equal(await swVersion(), 'v2');
  cs = await cacheState();
  assert.deepEqual(Object.keys(cs).sort(), ['beachday-data-v1', 'beachday-shell-v2'], 'old shell cache deleted, data kept');
  assert.equal(navs.length, 1, `page should reload exactly once, saw ${navs.length}`);
  log(`after Refresh: version v2, reloads=${navs.length}, caches=${Object.keys(cs).join(', ')}`);
  console.log(`\nALL CHECKS PASSED (Open-Meteo mock hits: ${omHits})`);
} finally {
  await browser.close();
  await srv.close().catch(() => {});
}
