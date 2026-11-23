// Run: node --test validate-manifest.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { validate, pngInfo } from './validate-manifest.mjs';
import { png } from './make-icons.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, 'manifest.webmanifest'), 'utf8'));
const readAsset = (p) => (existsSync(join(here, p)) ? readFileSync(join(here, p)) : null);

test('Beach Day manifest passes with zero errors and zero warnings', () => {
  const r = validate(manifest, { readAsset });
  assert.deepEqual(r, { errors: [], warnings: [] });
});

test('each Chromium install criterion is enforced', () => {
  const cases = [
    [{ name: undefined, short_name: undefined }, /name or short_name/],
    [{ start_url: undefined }, /start_url is required/],
    [{ display: 'browser' }, /display must be one of/],
    [{ prefer_related_applications: true }, /prefer_related_applications/],
    [{ icons: manifest.icons.filter((i) => i.sizes !== '192x192') }, /192x192/],
    [{ icons: manifest.icons.filter((i) => i.purpose !== 'maskable') }, /maskable/],
    [{ start_url: '/console/', scope: '/app/' }, /outside scope/],
    [{ start_url: 'https://evil.example/' }, /same-origin/],
    [{ shortcuts: [{ name: 'Agent Console', url: '/console' }] }, /no \/console shortcut/],
  ];
  for (const [patch, re] of cases) {
    const { errors } = validate({ ...manifest, ...patch });
    assert.ok(errors.some((e) => re.test(e)), `expected ${re} for ${JSON.stringify(patch)}; got ${errors}`);
  }
});

test('display_override can satisfy the display rule', () => {
  const { errors } = validate({ ...manifest, display: 'browser', display_override: ['standalone'] });
  assert.equal(errors.filter((e) => /display/.test(e)).length, 0);
});

test('asset checks catch missing files and size mismatches', () => {
  const bad = { ...manifest, icons: [...manifest.icons, { src: '/icons/nope.png', sizes: '96x96', type: 'image/png' }] };
  const lying = (p) => (p === '/icons/icon-192.png' ? png(190, 190, () => [0, 0, 0]) : readAsset(p));
  const r = validate(bad, { readAsset: lying });
  assert.ok(r.errors.includes('icon not found: /icons/nope.png'));
  assert.ok(r.errors.some((e) => /icon-192.png is 190x190 but declares "192x192"/.test(e)));
});

test('generated PNGs have the declared pixel sizes and are opaque RGB', () => {
  assert.deepEqual(pngInfo(readAsset('/icons/icon-maskable-512.png')), { width: 512, height: 512, colourType: 2 });
  assert.deepEqual(pngInfo(readAsset('/icons/apple-touch-icon-180.png')), { width: 180, height: 180, colourType: 2 });
});
