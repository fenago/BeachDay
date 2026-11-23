# Example 01: glass tokens, components and a rendered demo

## What it demonstrates
- `tokens.css`: Beach Day's color, glass, type, spacing and motion tokens, with light values and a `prefers-color-scheme: dark` override. Contrast-relevant colors are plain `#rrggbb` / `rgb(r g b / a)` so `../02-contrast-check` can parse and verify them.
- `glass.css`: the `.glass` material plus every required fallback:
  - `@supports not ((backdrop-filter…) or (-webkit-backdrop-filter…))` → solid surface. Testing both forms keeps Safari 9–17, which only has the prefix, on blur.
  - `prefers-reduced-transparency: reduce` → solid, `backdrop-filter: none`
  - `prefers-contrast: more` → solid, with a visible rim
  - `prefers-reduced-motion: reduce` → no entrance animation; press feedback by opacity, not scale
  - dark mode via tokens
- `demo.html`: a Today screen.
  - Glass top bar and floating verdict card = **2 blur surfaces**, so within the max of 3.
  - A solid content-layer card for the next days (HIG: no Liquid Glass in the content layer).
  - Verdict chips = color + icon + text.
  - 44 px targets, the safety line with the NWS link, Open-Meteo attribution.
- `shoot.mjs`: serves the examples folder over `node:http`, renders the page in Chromium at 390×844 @2x in three modes, saves PNGs, and **asserts**:
  - ≤ 3 blur surfaces
  - verdict icons render (the external sprite loads)
  - no control under 44×44 (inline sentence links are exempt per WCAG 2.5.8)
  - no horizontal scroll
  - in reduced transparency: zero blur surfaces and an opaque hero
  - in reduced motion: no entrance animation

Why it's "what good looks like": the fallbacks are tested rather than assumed, glass stays on the control layer only, and color never stands alone.

## How to run
```bash
node shoot.mjs        # uses the preinstalled Playwright + Chromium; no npm install
```
Reduced transparency is emulated through CDP (`Emulation.setEmulatedMedia`), because Playwright has no `reducedTransparency` option. This is Chromium, not iOS Safari, which doesn't support that media query at all (see docs/05).

## Verified
Command, run 2026-11-23 in this folder:
```
$ node shoot.mjs
light {"blurSurfaces":2,"heroBackdrop":"blur(20px) saturate(1.6)","heroBackground":"rgba(255, 255, 255, 0.74)","heroAnimation":"sheet-in","reducedTransparency":false,"iconOk":true,"smallTargets":0,"hScroll":false}
dark {"blurSurfaces":2,"heroBackdrop":"blur(20px) saturate(1.6)","heroBackground":"rgba(13, 27, 42, 0.8)","heroAnimation":"sheet-in","reducedTransparency":false,"iconOk":true,"smallTargets":0,"hScroll":false}
reduced-transparency {"blurSurfaces":0,"heroBackdrop":"none","heroBackground":"rgb(244, 247, 250)","heroAnimation":"none","reducedTransparency":true,"iconOk":true,"smallTargets":0,"hScroll":false}
PASS: all mode assertions hold
```
Outputs: `screenshot-light.png`, `screenshot-dark.png`, `screenshot-reduced-transparency.png`.

Not tested here: the `@supports not (...)` branch (Chromium 157 supports backdrop-filter, so it can't be triggered) and `prefers-contrast: more`. Check both on a real older Safari and with Increase Contrast on a device.
