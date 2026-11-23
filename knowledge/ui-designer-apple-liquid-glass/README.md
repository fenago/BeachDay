# Sable (ui-designer-apple-liquid-glass): knowledge index
Date: 2026-11-23

Reference notes from official sources (Apple HIG, Apple developer docs, MDN, W3C WCAG 2.2) plus worked, run examples. Every docs file lists its sources, marks unconfirmed facts **[UNVERIFIED]**, and ends with "Beach Day notes".

## docs/
| File | Covers | Read when |
|---|---|---|
| [docs/01-liquid-glass-materials.md](docs/01-liquid-glass-materials.md) | HIG Materials (Liquid Glass vs standard materials, regular vs clear, 35% dimming), Adopting Liquid Glass, Apple's announcement, what the web can't reproduce | Deciding where glass goes, or reviewing any glass component |
| [docs/02-color-contrast-dark-mode.md](docs/02-color-contrast-dark-mode.md) | HIG Color (incl. Liquid Glass color), Dark Mode, Apple's contrast table; WCAG 1.4.3 and 1.4.11 rules, formulas and no-rounding; how to composite glass for a check | Choosing or changing any color token, verdict colors, or dark mode |
| [docs/03-typography-and-layout.md](docs/03-typography-and-layout.md) | HIG text sizes (17/11 pt), the iOS "Large (default)" and AX1 tables, Dynamic Type behavior, layout and safe areas, 44 pt targets and spacing | Setting the type scale, spacing, or a screen layout |
| [docs/04-icons-and-app-icon.md](docs/04-icons-and-app-icon.md) | HIG Icons and App icons (layers, unmasked square, appearances, 1024 px) and the PWA icon caveats | Drawing icons, the sprite, or the app icon |
| [docs/05-motion-and-accessibility-settings.md](docs/05-motion-and-accessibility-settings.md) | HIG Motion and Reduce Motion list; `prefers-reduced-motion`, `prefers-reduced-transparency` (**not in Safari/iOS**), `prefers-contrast`; how to emulate them in Chromium | Adding any animation or fallback, or testing settings |
| [docs/06-css-glass-toolkit.md](docs/06-css-glass-toolkit.md) | MDN `backdrop-filter` (Baseline 2024, Safari 18 unprefixed / 9 prefixed, backdrop-root trap), `color-mix()` alpha rules, `@supports` | Writing or reviewing the glass CSS |

## examples/
| Folder | Shows | Status |
|---|---|---|
| [examples/01-glass-tokens-demo/](examples/01-glass-tokens-demo/) | `tokens.css` + `glass.css` with all fallbacks, a demo Today screen, and `shoot.mjs` producing light, dark and reduced-transparency screenshots with assertions | Ran: PASS (3 PNGs) |
| [examples/02-contrast-check/](examples/02-contrast-check/) | Node script computing WCAG ratios for verdict chips and text/controls on glass over the worst backgrounds | Ran: 30/34 first → tokens fixed → 34/34 PASS |
| [examples/03-icon-sprite/](examples/03-icon-sprite/) | Original sun, sun-cloud, cloud and storm sprite, XML-validated and rendered | Ran: well-formed, 0 problems |

## Key takeaways
1. Glass goes on the control/navigation layer only, with ≤ 3 blur surfaces and no glass on glass.
2. iOS Safari can't see Reduce Transparency (`prefers-reduced-transparency` is unsupported), so the *default* glass must pass 4.5:1 over the worst background. examples/02 proves the current tokens do.
3. `@supports` fallbacks must test `-webkit-backdrop-filter` too, or Safari 9–17 loses blur for no reason.
4. Thresholds aren't rounded: 4.498:1 fails.
