# Example 01: valid manifest + install-field validator

## What it shows
- `manifest.webmanifest`: Beach Day's manifest meeting every Chromium install criterion (`name`/`short_name`, 192 + 512 icons, `start_url`, installable `display`, no `prefer_related_applications`) plus our rules: `id: "/"`, `scope: "/"`, separate 512 `maskable` icon, `description`, a labelled `narrow` screenshot, `/console` shortcut.
- `validate-manifest.mjs`: a no-dependency Node CLI/module that reports **ERRORs** (install-blocking or Beach Day-required) and **WARNings**, resolves `src`/`start_url`/`scope` against the manifest URL, checks `start_url` is same-origin and inside `scope`, and opens every icon/screenshot PNG to confirm its real pixel size matches `sizes` (reads the IHDR) and that maskable icons are opaque.
- `make-icons.mjs`: generates the placeholder PNGs at exact sizes (192, 512, 512 maskable with the sun inside the 40%-radius safe zone, 180 apple-touch-icon, 1080×2340 screenshot). Real art comes from the UI designer.
- `validate-manifest.test.mjs`: one negative test per criterion, plus asset checks.

Why it is "what good looks like": criteria come straight from MDN "Making PWAs installable" and web.dev "install-criteria"; the check runs in CI without a browser; asset sizes are verified, not assumed.

## Run
```bash
cd knowledge/pwa-mobile-engineer/examples/01-manifest-validator
node make-icons.mjs                      # (re)generate icons/ and screenshots/
node validate-manifest.mjs manifest.webmanifest
node --test validate-manifest.test.mjs
```
In the real app: `node validate-manifest.mjs public/manifest.webmanifest --root public`.

## Verified
Node v22.23.5, 2026-11-23.
```
$ node validate-manifest.mjs manifest.webmanifest; echo "exit=$?"
OK: installable per Chromium criteria + Beach Day rules (0 warning(s))
exit=0

$ node validate-manifest.mjs bad.webmanifest   # {"name":"x","icons":[],"display":"browser"}
ERROR   start_url is required
ERROR   display must be one of fullscreen, standalone, minimal-ui, window-controls-overlay (got "browser")
ERROR   icons must include a 192x192 icon
ERROR   icons must include a 512x512 icon
ERROR   Beach Day: 192 and 512 icons with purpose "any" are required
ERROR   Beach Day: a separate 512x512 icon with purpose "maskable" is required
WARN    Beach Day uses display "standalone" (iOS supports only standalone)
...
FAIL: 6 error(s), 6 warning(s)
exit=1

$ node --test --test-reporter=spec validate-manifest.test.mjs
✔ Beach Day manifest passes with zero errors and zero warnings
✔ each Chromium install criterion is enforced
✔ display_override can satisfy the display rule
✔ asset checks catch missing files and size mismatches
✔ generated PNGs have the declared pixel sizes and are opaque RGB
ℹ tests 5  ℹ pass 5  ℹ fail 0
```
Not verified here: how the maskable icon looks under real launcher masks (use https://maskable.app/ or DevTools → Application → Manifest).
