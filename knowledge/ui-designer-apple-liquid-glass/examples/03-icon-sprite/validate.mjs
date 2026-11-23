// Validate icons.svg: well-formed XML (Chromium's XML parser via DOMParser),
// required symbols present, sprite rules followed, then render a preview PNG.
// Uses the preinstalled Playwright (no npm install). Node 22+.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const svgText = readFileSync(resolve(here, 'icons.svg'), 'utf8');
const REQUIRED = ['sun', 'sun-cloud', 'cloud', 'storm'];

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
const report = await page.evaluate(({ svgText, REQUIRED }) => {
  const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) return { wellFormed: false, error: err.textContent };
  const problems = [];
  const root = doc.documentElement;
  if (root.namespaceURI !== 'http://www.w3.org/2000/svg') problems.push('root is not an SVG element');
  if (doc.querySelector('script, foreignObject')) problems.push('contains <script> or <foreignObject>');
  for (const el of doc.querySelectorAll('*')) {
    for (const a of el.attributes) {
      if (/^on/i.test(a.name)) problems.push(`event handler attribute ${a.name}`);
      if (/href$/i.test(a.name) && !a.value.startsWith('#')) problems.push(`external reference ${a.value}`);
    }
  }
  const symbols = [...doc.querySelectorAll('symbol')].map((s) => ({
    id: s.id,
    viewBox: s.getAttribute('viewBox'),
    title: s.querySelector('title')?.textContent ?? null,
    stroke: s.getAttribute('stroke'),
  }));
  for (const id of REQUIRED) if (!symbols.some((s) => s.id === id)) problems.push(`missing symbol #${id}`);
  for (const s of symbols) {
    if (s.viewBox !== '0 0 24 24') problems.push(`#${s.id} viewBox is ${s.viewBox}`);
    if (!s.title) problems.push(`#${s.id} has no <title>`);
    if (s.stroke !== 'currentColor') problems.push(`#${s.id} stroke is not currentColor`);
  }
  return { wellFormed: true, symbols, problems };
}, { svgText, REQUIRED });

console.log(JSON.stringify(report, null, 2));

if (report.wellFormed) {
  // Preview: each icon at 24px and 48px, light and dark chips.
  const cells = REQUIRED.map((id) => `
    <figure><svg width="24" height="24"><use href="#${id}"/></svg>
    <svg width="48" height="48"><use href="#${id}"/></svg><figcaption>${id}</figcaption></figure>`).join('');
  await page.setContent(`<!doctype html><html lang="en"><body style="margin:0;font:13px system-ui;display:inline-block">
    ${svgText}
    <div style="display:flex;gap:16px;padding:16px;background:#f4f7fa;color:#0b1b2b">${cells}</div>
    <div style="display:flex;gap:16px;padding:16px;background:#101c28;color:#f2f6fa">${cells}</div>
    <style>figure{margin:0;display:grid;justify-items:center;gap:6px}</style></body></html>`);
  await page.locator('body').screenshot({ path: resolve(here, 'icons-preview.png') });
  console.log('wrote icons-preview.png');
}
await browser.close();
process.exit(report.wellFormed && report.problems.length === 0 ? 0 : 1);
