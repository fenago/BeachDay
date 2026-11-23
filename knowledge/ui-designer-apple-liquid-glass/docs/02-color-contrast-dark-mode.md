# Color, contrast and Dark Mode
Source:
- https://developer.apple.com/design/human-interface-guidelines/color
- https://developer.apple.com/design/human-interface-guidelines/dark-mode
- https://developer.apple.com/design/human-interface-guidelines/accessibility
- https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html
- https://www.w3.org/TR/WCAG22/#dfn-relative-luminance and #dfn-contrast-ratio

Retrieved: 2026-11-23

## Apple HIG: Color
- "Avoid using the same color to mean different things." Use color consistently for status and interactivity. ([Color](https://developer.apple.com/design/human-interface-guidelines/color))
- "Make sure all your app's colors work well in light, dark, and increased contrast contexts." For a custom color, supply light and dark variants, plus an increased-contrast option for each.
- "Test your app's color scheme under a variety of lighting conditions." Outdoors in bright light, colors look darker and more muted. That is our users on a beach.
- "Avoid relying solely on color to differentiate between objects, indicate interactivity, or communicate essential information." Use text labels or glyph shapes too.
- **Liquid Glass color** (same page):
  - By default glass "has no inherent color" and takes color from the content behind it.
  - "Apply color sparingly to the Liquid Glass material, and to symbols or text on the material." Reserve color for status indicators or primary actions. To emphasize a primary action, color the **background** of the button, not its label. "Refrain from adding color to the background of multiple controls."
  - "Avoid using similar colors in control labels if your app has a colorful background." Over colorful content, prefer monochrome bars.
  - "Be aware of the placement of color in the content layer." The resting state (top of the scroll view) must stay clearly legible.
- Page change log: "December 16, 2025 Updated guidance for Liquid Glass."
- Don't hard-code Apple's system color values; they "may fluctuate from release to release". On the web we define our own palette anyway. (The swatch values are images on the page and were not captured: **[UNVERIFIED]** hex values, not needed.)

## Apple HIG: Dark Mode
- "Avoid offering an app-specific appearance setting." Follow the system setting. ([Dark Mode](https://developer.apple.com/design/human-interface-guidelines/dark-mode))
- People may use **Auto**, so the appearance can switch while the app is open.
- Test with **Increase Contrast** and **Reduce Transparency** on, separately and together, in Dark Mode.
- Contrast: "make sure the contrast ratio between colors is no lower than 4.5:1. For custom foreground and background colors, strive for a contrast ratio of 7:1, especially in small text."
- Dark palettes are "not necessarily inversions" of light ones. iOS uses *base* (dimmer) and *elevated* (brighter) backgrounds so that foreground layers advance.
- "Soften the color of white backgrounds" in images shown in Dark Mode.

## Apple HIG: Accessibility contrast table
From [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility). Accessibility Inspector uses these WCAG AA values:

| Text size | Text weight | Minimum contrast ratio |
|---|---|---|
| Up to 17 pts | All | 4.5:1 |
| 18 pts | All | 3:1 |
| All | Bold | 3:1 |

Note that Apple's "bold → 3:1 at any size" is looser than WCAG, which needs **14 pt (≈18.5 CSS px) bold** for the 3:1 large-text rate. We follow WCAG.

## WCAG 2.2: the normative rules
- **1.4.3 Contrast (Minimum), AA:** text and images of text ≥ **4.5:1**. Large-scale text ≥ **3:1**. Exempt: inactive UI components, pure decoration, invisible text, text inside a picture with significant other content, and logotypes.
- **Large scale** = at least 18 pt, or 14 pt bold. Understanding 1.4.3: "1pt = 1.333px, therefore 14pt and 18pt are equivalent to approximately 18.5px and 24px."
- **Thresholds are not rounded:** "4.499:1 would not meet the 4.5:1 threshold". Likewise "2.999:1 would not meet the 3:1 threshold" for 1.4.11. Our checker hit exactly this: the first link color scored 4.498:1 (printed "4.50 FAIL").
- **1.4.11 Non-text Contrast, AA:** ≥ **3:1** against adjacent colors for "Visual information required to identify user interface components and states" and for "Parts of graphics required to understand the content".
  - A control that has visible text or an icon does **not** need a 3:1 boundary. A boundary is required only when nothing else shows the control is there. (Understanding 1.4.11, "Boundaries".)
  - Focus indicators still need sufficient contrast against the adjacent background.
- **Formulas** (sRGB):
  - Relative luminance `L = 0.2126 R + 0.7152 G + 0.0722 B`, where each channel `c = C/255` is linearized as `c <= 0.04045 ? c/12.92 : ((c+0.055)/1.055)^2.4`. The threshold was 0.03928 before May 2021; WCAG says the change has "no practical effect".
  - Contrast ratio `(L1 + 0.05) / (L2 + 0.05)`, where L1 is the lighter of the two. The range is 1 to 21.
- Understanding 1.4.3 also covers transparency and gradients: contrast is measured against "the specified background over which the text is rendered in normal usage". For translucent surfaces we therefore composite the surface over **every background it can sit on** and check the worst one.

## Compositing translucent glass for a contrast check
- Browsers paint `rgb(r g b / a)` over an opaque backdrop with source-over compositing: `out = top*a + under*(1-a)` per sRGB channel.
- `backdrop-filter: blur()` averages the backdrop. Over a uniform region the result equals that region's color, so the **extreme solid colors** behind the glass (darkest for dark text, lightest for light text) are the true worst case. Blur can only move the result toward the average.
- `saturate(1.6)` changes chroma, not lightness, of an already-gray mix. **[UNVERIFIED]** whether saturate can lower luminance contrast on strongly colored backdrops; we keep a margin above 4.5:1 for primary text and include solid white and black "scroll-under" backgrounds as the extremes.
- Include the highlight gradient as a separate layer. In dark mode a white highlight *reduces* contrast for light text.

## Beach Day notes
- Tokens live in `public/css/tokens.css` as `#rrggbb` or `rgb(r g b / a)`, so a script can check them (see `examples/02-contrast-check`). Every token change re-runs that script, and QA reviews the result.
- Verdicts:
  - Solid chip in the verdict color + icon + label, with an `--on-verdict-*` color ≥ 4.5:1 on the chip, the same in both schemes.
  - The amber "Fair" chip uses dark text (`#1f1400` on `#f2a93b`, 9.08:1). The orange from the skill draft (`#b26a00`) with dark text would fail, so we lightened the amber and kept the text dark.
- Primary action = colored **background** (accent fill) with a white or dark label, per the HIG's Liquid Glass color guidance. At most one prominent button per view.
- No in-app light/dark toggle (HIG: avoid an app-specific appearance setting). Use `prefers-color-scheme`.
- Beach users read in direct sun, so aim above the minimum for primary text: 9:1 light and 6.7:1 dark in the current worst cases.
