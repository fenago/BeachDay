// Render demo.html in Chromium (preinstalled Playwright) in light, dark and
// reduced-transparency (+ reduced-motion) modes, save PNGs, and assert the
// fallbacks actually apply. Serves ../ over a tiny node:http server so the
// external SVG sprite (<use href="../03-icon-sprite/icons.svg#sun">) loads.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml' };

const server = createServer(async (req, res) => {
  const path = resolve(root, '.' + decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0, '127.0.0.1');
await new Promise((r) => server.once('listening', r));
const url = `http://127.0.0.1:${server.address().port}/01-glass-tokens-demo/demo.html`;

const browser = await chromium.launch();
const failures = [];
const modes = [
  { name: 'light', colorScheme: 'light' },
  { name: 'dark', colorScheme: 'dark' },
  { name: 'reduced-transparency', colorScheme: 'light', reducedTransparency: true, reducedMotion: 'reduce' },
];

for (const m of modes) {
  // iPhone-sized viewport (CSS px) in Chromium; not real Safari.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: m.colorScheme, reducedMotion: m.reducedMotion ?? 'no-preference' });
  const page = await ctx.newPage();
  if (m.reducedTransparency) {
    // Playwright's emulateMedia has no reducedTransparency option; use CDP.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] });
  }
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500); // let the 350 ms entrance animation finish
  const facts = await page.evaluate(() => {
    const glass = [...document.querySelectorAll('*')].filter((el) => {
      const cs = getComputedStyle(el);
      const bf = cs.backdropFilter ?? cs.webkitBackdropFilter;
      return bf && bf !== 'none' && el.getClientRects().length;
    });
    const hero = getComputedStyle(document.querySelector('.hero'));
    const iconOk = [...document.querySelectorAll('.verdict svg')].every((s) => s.getBoundingClientRect().width >= 20);
    const smallTargets = [...document.querySelectorAll('button, a')]
      .filter((el) => !el.closest('p')) // inline links in sentences are exempt (WCAG 2.5.8 Inline)
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width < 44 || r.height < 44).length;
    return {
      blurSurfaces: glass.length,
      heroBackdrop: hero.backdropFilter,
      heroBackground: hero.backgroundColor,
      heroAnimation: hero.animationName,
      reducedTransparency: matchMedia('(prefers-reduced-transparency: reduce)').matches,
      iconOk, smallTargets,
      hScroll: document.documentElement.scrollWidth > innerWidth,
    };
  });
  await page.screenshot({ path: resolve(here, `screenshot-${m.name}.png`), fullPage: true });
  console.log(m.name, JSON.stringify(facts));

  if (!facts.iconOk) failures.push(`${m.name}: verdict icons did not render`);
  if (facts.hScroll) failures.push(`${m.name}: horizontal scroll`);
  if (facts.smallTargets) failures.push(`${m.name}: ${facts.smallTargets} controls under 44x44`);
  if (m.reducedTransparency) {
    if (facts.blurSurfaces !== 0) failures.push('reduced transparency: blur still applied');
    if (!/^rgb\(\d+, \d+, \d+\)$/.test(facts.heroBackground)) failures.push(`reduced transparency: hero not opaque (${facts.heroBackground})`);
    if (facts.heroAnimation !== 'none') failures.push('reduced motion: entrance animation still on');
  } else if (facts.blurSurfaces > 3) failures.push(`${m.name}: ${facts.blurSurfaces} blur surfaces (max 3)`);
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures.length ? `FAIL\n- ${failures.join('\n- ')}` : 'PASS: all mode assertions hold');
process.exit(failures.length ? 1 : 0);
