// Validates a web app manifest against Chromium's install criteria plus Beach Day's own rules.
// Usage: node validate-manifest.mjs [path/to/manifest.webmanifest] [--root <dir that "/" maps to>]
// Exit code 1 when any ERROR is found. No dependencies.
// Sources: https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
//          https://web.dev/articles/install-criteria  https://web.dev/articles/maskable-icon
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

const INSTALLABLE_DISPLAY = ['fullscreen', 'standalone', 'minimal-ui', 'window-controls-overlay'];
const PNG_SIG = '89504e470d0a1a0a';

/** Read width/height/colourType from a PNG's IHDR. */
export function pngInfo(buf) {
  if (buf.subarray(0, 8).toString('hex') !== PNG_SIG) return null;
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), colourType: buf[25] };
}

const sizesOf = (icon) => String(icon.sizes ?? '').split(/\s+/).filter(Boolean);
const purposesOf = (icon) => String(icon.purpose ?? 'any').split(/\s+/).filter(Boolean);
const hasIcon = (icons, size, purpose) =>
  icons.some((i) => sizesOf(i).includes(size) && purposesOf(i).includes(purpose));

/**
 * @param manifest parsed JSON
 * @param opts.manifestUrl absolute URL the manifest is served from (for resolving src/start_url/scope)
 * @param opts.readAsset   (pathname) => Buffer|null, to check icon files
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validate(manifest, { manifestUrl = 'https://beachday.example/manifest.webmanifest', readAsset } = {}) {
  const errors = [], warnings = [];
  const err = (m) => errors.push(m), warn = (m) => warnings.push(m);
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return { errors: ['manifest must be a JSON object'], warnings };

  // --- Chromium install criteria (MDN "Required manifest members", web.dev install-criteria) ---
  if (!manifest.name && !manifest.short_name) err('name or short_name is required');
  if (manifest.short_name && manifest.short_name.length > 12) warn(`short_name "${manifest.short_name}" may be truncated on home screens (keep ≤ 12 chars)`);
  if (!manifest.start_url) err('start_url is required');
  const display = manifest.display ?? 'browser';
  const override = Array.isArray(manifest.display_override) ? manifest.display_override : [];
  if (!INSTALLABLE_DISPLAY.includes(display) && !override.some((d) => INSTALLABLE_DISPLAY.includes(d))) {
    err(`display must be one of ${INSTALLABLE_DISPLAY.join(', ')} (got "${display}")`);
  }
  if (manifest.prefer_related_applications === true) err('prefer_related_applications must be false or absent');
  const icons = Array.isArray(manifest.icons) ? manifest.icons : [];
  if (!icons.some((i) => sizesOf(i).includes('192x192'))) err('icons must include a 192x192 icon');
  if (!icons.some((i) => sizesOf(i).includes('512x512'))) err('icons must include a 512x512 icon');

  // --- Beach Day rules (pwa-manifest-service-worker skill) ---
  if (!hasIcon(icons, '192x192', 'any') || !hasIcon(icons, '512x512', 'any')) err('Beach Day: 192 and 512 icons with purpose "any" are required');
  if (!hasIcon(icons, '512x512', 'maskable')) err('Beach Day: a separate 512x512 icon with purpose "maskable" is required');
  if (icons.some((i) => purposesOf(i).includes('any') && purposesOf(i).includes('maskable'))) {
    warn('avoid purpose "any maskable" on one file: padded maskable art looks small where "any" is used');
  }
  if (display !== 'standalone') warn('Beach Day uses display "standalone" (iOS supports only standalone)');
  if (!manifest.id) warn('set "id" so the app identity survives start_url changes');
  for (const k of ['theme_color', 'background_color', 'description']) if (!manifest[k]) warn(`${k} is recommended`);

  // URLs: start_url must be inside scope, same origin.
  const base = new URL(manifestUrl);
  try {
    const start = new URL(manifest.start_url ?? '.', base);
    const scope = new URL(manifest.scope ?? '.', base);
    if (start.origin !== base.origin) err('start_url must be same-origin as the manifest');
    if (!start.pathname.startsWith(scope.pathname)) err(`start_url ${start.pathname} is outside scope ${scope.pathname}`);
  } catch { err('start_url or scope is not a valid URL'); }

  // Screenshots (shown in Android's richer install UI together with description).
  const shots = Array.isArray(manifest.screenshots) ? manifest.screenshots : [];
  if (!shots.length) warn('add at least one "narrow" screenshot for the Android install dialog');
  for (const s of shots) {
    if (!s.label) warn(`screenshot ${s.src} has no label (accessible name)`);
    if (s.form_factor && !['narrow', 'wide'].includes(s.form_factor)) err(`screenshot form_factor must be narrow or wide: ${s.src}`);
  }

  // Asset checks: file exists, PNG, real size matches declared size, maskable is opaque.
  if (readAsset) {
    for (const item of [...icons.map((i) => ({ ...i, kind: 'icon' })), ...shots.map((s) => ({ ...s, kind: 'screenshot' }))]) {
      const url = new URL(item.src, base);
      const buf = readAsset(url.pathname);
      if (!buf) { err(`${item.kind} not found: ${url.pathname}`); continue; }
      if (item.type === 'image/png' || url.pathname.endsWith('.png')) {
        const info = pngInfo(buf);
        if (!info) { err(`${url.pathname} is not a PNG`); continue; }
        const actual = `${info.width}x${info.height}`;
        if (!sizesOf(item).includes(actual)) err(`${url.pathname} is ${actual} but declares "${item.sizes}"`);
        if (item.kind === 'icon' && purposesOf(item).includes('maskable') && ![0, 2].includes(info.colourType)) {
          warn(`${url.pathname}: maskable icons should be opaque (PNG colour type ${info.colourType} has alpha)`);
        }
      }
    }
  }
  return { errors, warnings };
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const file = resolve(args.find((a) => !a.startsWith('--')) ?? 'manifest.webmanifest');
  const rootIdx = args.indexOf('--root');
  const root = rootIdx >= 0 ? resolve(args[rootIdx + 1]) : dirname(file);
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const readAsset = (p) => { const f = join(root, decodeURIComponent(p)); return existsSync(f) ? readFileSync(f) : null; };
  const { errors, warnings } = validate(manifest, { readAsset });
  for (const e of errors) console.log(`ERROR   ${e}`);
  for (const w of warnings) console.log(`WARN    ${w}`);
  console.log(errors.length ? `FAIL: ${errors.length} error(s), ${warnings.length} warning(s)` : `OK: installable per Chromium criteria + Beach Day rules (${warnings.length} warning(s))`);
  process.exit(errors.length ? 1 : 0);
}
