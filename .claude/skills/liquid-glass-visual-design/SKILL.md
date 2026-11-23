---
name: liquid-glass-visual-design
description: Beach Day's web interpretation of Apple's Liquid Glass design language — translucent layered materials with backdrop-filter, tint and highlights, depth and motion, plus mandatory legibility, contrast, reduced-transparency and performance fallbacks. Use when creating or reviewing visual design, tokens or CSS components.
---
# Liquid Glass on the web (Sable's system)

Liquid Glass is Apple's 2025 design language: translucent, refractive material that floats above content, with dynamic tint, specular highlights and fluid motion. We take inspiration from it **on the web**. We do not clone Apple assets or icons. Legibility beats effect, every time.

## Material tokens (`public/css/tokens.css`)
```css
:root {
  --glass-bg: color-mix(in oklab, white 55%, transparent);
  --glass-bg-strong: color-mix(in oklab, white 78%, transparent);
  --glass-border: color-mix(in oklab, white 70%, transparent);
  --glass-highlight: linear-gradient(180deg, rgb(255 255 255 / .55), rgb(255 255 255 / 0) 40%);
  --glass-blur: 20px; --glass-saturate: 1.6;
  --glass-shadow: 0 8px 32px rgb(0 30 60 / .18);
  --radius-l: 28px; --radius-m: 20px; --radius-s: 14px;
  --text: #0b1b2b; --text-2: #3a4b5c;
  --verdict-great: #1f8a4c; --verdict-good: #11788a; --verdict-fair: #f2a93b; /* use with dark text #1f1400 (9.08:1) */ --verdict-skip: #b3261e;
}
@media (prefers-color-scheme: dark) {
  :root { --glass-bg: color-mix(in oklab, #0d1b2a 55%, transparent); --glass-bg-strong: color-mix(in oklab, #0d1b2a 80%, transparent);
          --glass-border: rgb(255 255 255 / .18); --text: #f2f6fa; --text-2: #b8c6d4; }
}
.glass {
  background: var(--glass-highlight), var(--glass-bg);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  backdrop-filter: blur(var(--glass-blur)) saturate(var(--glass-saturate));
  border: 1px solid var(--glass-border); border-radius: var(--radius-l); box-shadow: var(--glass-shadow);
}
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) { .glass { background: var(--glass-bg-strong); } }
@media (prefers-reduced-transparency: reduce) { .glass { background: var(--glass-bg-strong); backdrop-filter: none; -webkit-backdrop-filter: none; } }
```

## Layering rules
- **Content layer:** sky and sea gradients, or a photo. It can be tinted by the conditions: sunny, overcast, stormy.
- **`prefers-reduced-transparency` is not supported in Safari or iOS Safari** (MDN compat data), so the *default* glass must already pass 4.5:1 over the worst background. The media query is a bonus, not the safety net.
- **Glass belongs to the control and navigation layer:** top bar, tab bar, sheets, floating cards. **Never** put glass on glass more than 2 levels deep.
- **Text on glass:**
  - Meet **4.5:1 against the worst-case background** under the blur. Use a stronger tint or a scrim if needed.
  - Body text is never thinner than regular weight.
  - Verdict text sits on a solid verdict-colored chip, or uses colored text on strong glass. Both must reach 4.5:1.
- **Edges:** borders and highlights that mark a control boundary need **3:1** non-text contrast.

## Motion
- Spring-like, short animations (200–350 ms). Use transform and opacity only.
- Sheets rise and cards expand from their source to keep the user oriented.
- `prefers-reduced-motion: reduce` turns these into fades or nothing at all. There are no auto-playing loops.

## Verdict styling
Every verdict combines color, an icon (sun, sun-cloud, cloud, storm) and a text label. The amber "Fair" state uses dark text. Check all four verdicts in light, dark and reduced-transparency modes.

## Performance
- `backdrop-filter` is expensive on low-end Android. Limit it to at most 3 visible glass surfaces.
- Don't animate the blur radius.
- Test scrolling at 60 fps on a mid-range phone. If it janks, fall back to `--glass-bg-strong`.

## Icons & imagery
- Simple line or filled SVG icons drawn for Beach Day. Do not copy SF Symbols.
- App icon: an original mark, sun over waves, kept inside the maskable safe zone.
