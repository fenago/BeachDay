# Example 03: original SVG icon sprite (sun, sun-cloud, cloud, storm)

## What it demonstrates
`icons.svg` is a single sprite of `<symbol>`s drawn for Beach Day. These are not SF Symbols and are not traced from Apple artwork. They follow the HIG Icons guidance:
- one consistent 24×24 grid, 2 px round strokes, the same level of detail
- `stroke="currentColor"` so an icon takes the chip's `--on-verdict-*` color, the web version of "black and clear" template images
- a `<title>` in every symbol, for when an icon is used on its own
- vector only

The verdict map is sun = Great, sun-cloud = Good, cloud = Fair, storm = Skip it. In chips the `<svg>` is `aria-hidden="true"`, because the visible label carries the meaning.

`validate.mjs`:
1. Parses the file with Chromium's XML parser (`DOMParser`, `image/svg+xml`). Any `parsererror` means it is not well-formed.
2. Checks that the four required ids exist and that each has `viewBox="0 0 24 24"`, a `<title>` and a `currentColor` stroke. It also checks there is no `<script>`/`<foreignObject>`, no `on*` handlers and no external `href`s.
3. Renders `icons-preview.png` at 24 and 48 px on the light and dark surfaces.

Usage in a page (same-origin file):
```html
<span class="verdict verdict--fair"><svg aria-hidden="true"><use href="/icons.svg#cloud"/></svg>Fair</span>
```
External `<use>` references must be same-origin, so serve the sprite from the site. `file://` pages won't load it, which is why `../01-glass-tokens-demo/shoot.mjs` runs a tiny local server.

## How to run
```bash
node validate.mjs     # preinstalled Playwright/Chromium; no npm install
```

## Verified
Run 2026-11-23 (output trimmed):
```
$ node validate.mjs
{
  "wellFormed": true,
  "symbols": [
    { "id": "sun", "viewBox": "0 0 24 24", "title": "Sunny", "stroke": "currentColor" },
    { "id": "sun-cloud", "viewBox": "0 0 24 24", "title": "Mostly sunny", "stroke": "currentColor" },
    { "id": "cloud", "viewBox": "0 0 24 24", "title": "Cloudy", "stroke": "currentColor" },
    { "id": "storm", "viewBox": "0 0 24 24", "title": "Storms", "stroke": "currentColor" }
  ],
  "problems": []
}
wrote icons-preview.png
```
Exit code 0. I also inspected the preview by eye: all four icons are distinct at 24 px in both schemes.
