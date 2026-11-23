#!/usr/bin/env node
// Validates Mermaid files by parsing and rendering them with the real mermaid library inside
// headless Chromium (Playwright). Usage:
//   MERMAID_JS=/path/to/node_modules/mermaid/dist/mermaid.min.js node validate-mermaid.mjs a.mmd b.mmd
// Writes <file>.svg next to each input when it renders. Exit 1 on any parse/render error.
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const mermaidJs = process.env.MERMAID_JS;
if (!mermaidJs) { console.error('set MERMAID_JS to mermaid/dist/mermaid.min.js'); process.exit(2); }

const files = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');
await page.addScriptTag({ content: readFileSync(mermaidJs, 'utf8') });
await page.evaluate(() => { mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', htmlLabels: false, flowchart: { htmlLabels: false } }); return null; });
const mv = process.env.MERMAID_VERSION || JSON.parse(readFileSync(mermaidJs.replace(/dist\/mermaid.min.js$/, 'package.json'), 'utf8')).version;
console.log(`mermaid ${mv} in Chromium ${browser.version()} (htmlLabels off, so the SVG is valid XML)`);
let failed = 0;
for (const [i, f] of files.entries()) {
  const src = readFileSync(f, 'utf8');
  const r = await page.evaluate(async ({ src, id }) => {
    try {
      const parsed = await mermaid.parse(src);
      const { svg } = await mermaid.render(id, src);
      return { ok: true, type: parsed?.diagramType, svg };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }, { src, id: `d${i}` });
  if (r.ok) {
    writeFileSync(f.replace(/\.mmd$/, '.svg'), r.svg);
    console.log(`ok    ${f} (type=${r.type}, svg ${r.svg.length} bytes)`);
  } else { failed++; console.log(`ERROR ${f}: ${r.error.split('\n').slice(0, 3).join(' | ')}`); }
}
await browser.close();
process.exit(failed ? 1 : 0);
