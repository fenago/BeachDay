# Typography and layout
Source:
- https://developer.apple.com/design/human-interface-guidelines/typography
- https://developer.apple.com/design/human-interface-guidelines/layout
- https://developer.apple.com/design/human-interface-guidelines/accessibility

Retrieved: 2026-11-23

## Sizes and weights
- Default and minimum text sizes ([Typography](https://developer.apple.com/design/human-interface-guidelines/typography)):

| Platform | Default size | Minimum size |
|---|---|---|
| iOS, iPadOS | 17 pt | 11 pt |
| macOS | 13 pt | 10 pt |
| visionOS | 17 pt | 12 pt |
| watchOS | 16 pt | 12 pt |

- "In general, avoid light font weights." Prefer Regular, Medium, Semibold or Bold. Avoid Ultralight, Thin and Light, especially at small sizes.
- "Minimize the number of typefaces you use."
- With three or more lines of text, "avoid tight leading".

## iOS Dynamic Type: "Large (default)" text styles
From the Typography Specifications section. Points map 1:1 to CSS px on iPhone.

| Style | Weight | Size (pt) | Leading (pt) | Emphasized weight |
|---|---|---|---|---|
| Large Title | Regular | 34 | 41 | Bold |
| Title 1 | Regular | 28 | 34 | Bold |
| Title 2 | Regular | 22 | 28 | Bold |
| Title 3 | Regular | 20 | 25 | Semibold |
| Headline | Semibold | 17 | 22 | Semibold |
| Body | Regular | 17 | 22 | Semibold |
| Callout | Regular | 16 | 21 | Semibold |
| Subhead | Regular | 15 | 20 | Semibold |
| Footnote | Regular | 13 | 18 | Semibold |
| Caption 1 | Regular | 12 | 16 | Semibold |
| Caption 2 | Regular | 11 | 13 | Semibold |

At the accessibility size **AX1**, Body grows to 28/34 and Large Title to 44/52. Layouts must survive this. (The "Emphasized weight" column was added on December 16, 2025.)

## Dynamic Type behavior to copy on the web
- "Make sure your app's layout adapts to all font sizes."
- "Increase the size of meaningful interface icons as font size increases."
- "Keep text truncation to a minimum as font size increases."
- "Consider adjusting your layout at large font sizes." Stack inline items (glyphs, timestamps) above or below the text, and use fewer columns.
- "Maintain a consistent information hierarchy regardless of the current font size." Primary elements stay at the top.
- The Accessibility page recommends letting people enlarge text by at least **200 percent**.

## System fonts
- SF Pro is the iOS system font; New York is the serif. Apple: "don't embed system fonts in your app". The font licence restricts use, and the HIG points to downloads for design mockups only. **[UNVERIFIED]** exact licence wording; we never bundle SF fonts.
- On the web, `-apple-system, BlinkMacSystemFont, system-ui` renders SF on Apple devices without bundling it.

## Layout
From [Layout](https://developer.apple.com/design/human-interface-guidelines/layout):
- "Order content by relative importance": most important near the top and leading side.
- "Group related items", and "Use progressive disclosure".
- "Differentiate controls from content". Extend full-screen backgrounds under the bars.
- **Safe areas:** "Respecting the safe area is essential to make sure system UI and hardware features like the Dynamic Island don't obstruct content and controls."
- "Be prepared for text-size changes": side-by-side views may need to stack, and rows must grow.
- Page change log: "September 9, 2026 Updated guidance to reflect current best practices."

## Spacing and targets
From [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility):
- iOS default control size is **44×44 pt** and the minimum is **28×28 pt**.
- "Add about 12 points of padding around elements that include a bezel", and about **24 points** around elements without a bezel.

## Beach Day notes
- **Type tokens** are in `rem`, mapped from the table above with 16 px = 1rem: `--fs-body: 1.0625rem` (17), `--fs-large-title: 2.125rem` (34), and so on. Browser text-size settings and 200% zoom then scale them (WCAG 1.4.4). iOS Safari does not apply Dynamic Type to `rem` automatically. **[UNVERIFIED]** whether `font: -apple-system-body` should be used to pick up Dynamic Type in standalone PWAs; test on a device before relying on it.
- Body text is never below 17 px weight 400. Captions are 12 px minimum (HIG minimum is 11 pt) and are never used for verdict information.
- **Verdict hero** = Large Title 34 px bold. The chip label = Headline 17 px semibold, which counts as **normal** text for WCAG, so it needs 4.5:1.
- Single column, `max-width: 560px`, 16 px side margins, `padding: env(safe-area-inset-*)` with `viewport-fit=cover`.
- Every control is at least 44×44 CSS px (`--target-min`). Leave about 12 px between bezelled controls.
- At large text sizes the day strip goes from 2 columns to 1, and icon + label stack vertically. No truncation of verdict text.
