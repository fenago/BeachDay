---
name: performance-budgets
description: Beach Day performance budgets and techniques — page weight, Core Web Vitals targets, request counts, image and icon budgets, glass/backdrop-filter costs, and how to measure on real phones. Use when adding assets, effects, code or dependencies to the front end.
---
# Performance budgets

## Budgets (mobile, slow 4G, mid-range Android)
| Metric | Budget |
|---|---|
| Initial transfer (HTML + CSS + JS, compressed) | ≤ 100 KB, of which JS ≤ 50 KB |
| Fonts | 0 KB (system fonts only) |
| Images on first view | ≤ 150 KB; SVG for icons |
| Requests on first view | ≤ 15 (excluding the 2 Open-Meteo calls) |
| LCP | ≤ 2.0 s on a repeat visit (SW cache), ≤ 2.5 s on first |
| INP | ≤ 200 ms |
| CLS | ≤ 0.05; reserve space for the forecast with skeletons |
| Lighthouse performance (Deploy Preview) | ≥ 0.9 |

## Techniques
- Native ES modules. Preload the main module with `<link rel="modulepreload">`. Load Console code only on `/console`.
- Inline critical CSS for the shell (it must come from a file because CSP has no `unsafe-inline` styles), or keep the CSS small.
- Fire both Open-Meteo calls in parallel, as soon as the beach is known. Render cached data first, then refresh it.
- Icons go in a single SVG sprite. Images use `loading="lazy"` and `decoding="async"` with explicit width and height.
- **Glass:** at most 3 blurred surfaces visible. Don't animate `backdrop-filter`. Fall back to solid if scrolling janks.
- No third-party scripts, analytics or webfonts.

## Measure
- **Lab:** Lighthouse CI on Deploy Previews, and the DevTools Performance panel with CPU 4× slowdown.
- **Real device:** iPhone through Safari Web Inspector, and a mid-range Android through `chrome://inspect`. Record numbers in the handoff.
- **Regressions:** if a change goes over budget, the handoff says so and names the trade-off for the orchestrator.
