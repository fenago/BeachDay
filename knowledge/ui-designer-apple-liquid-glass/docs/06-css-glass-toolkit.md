# CSS toolkit for glass: backdrop-filter, color-mix, @supports
Source:
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/backdrop-filter
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Values/color_value/color-mix
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@supports
- https://github.com/mdn/browser-compat-data (css/properties/backdrop-filter.json, css/types/color.json)
- https://drafts.csswg.org/filter-effects-2/#BackdropFilterProperty

Retrieved: 2026-11-23 (MDN backdrop-filter page last modified Nov 10, 2026)

## `backdrop-filter`
- Applies filter effects "to the area behind an element". The element or its background must be at least partly transparent for the effect to show.
- **Baseline 2024, "Newly available" since September 2024.**
- Syntax: `none` | `<filter-value-list>`. Functions: `blur()`, `brightness()`, `contrast()`, `drop-shadow()`, `grayscale()`, `hue-rotate()`, `invert()`, `opacity()`, `saturate()`, `sepia()`, or `url()` to an SVG filter. Chain them with spaces: `blur(20px) saturate(1.6)`.
- Formal: initial `none`, not inherited, animation type "a filter function list". Animating it is *possible*, but we don't (see Beach Day notes).
- Spec: Filter Effects Module Level 2.

### Browser support (BCD `css.properties.backdrop-filter`)
| Browser | Unprefixed | Prefixed |
|---|---|---|
| Chrome / Chrome Android / WebView | 76 | — |
| Edge | 79 | — |
| Firefox | 103 (before 123, not on systems with unknown GPU vendor) | — |
| Safari / iOS Safari | **18** | `-webkit-backdrop-filter` since **9** |
| Samsung Internet | 12 | — |

**Gotcha:** Safari 9–17 supports only the `-webkit-` form. A fallback written as `@supports not (backdrop-filter: blur(1px))` fires on Safari 17 even though blur works there. Test both:
```css
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .glass { background: var(--surface-solid); }
}
```
Always declare `-webkit-backdrop-filter` first, then `backdrop-filter`.

### Backdrop root (why blur sometimes "does nothing")
The filter only samples pixels up to the nearest **backdrop root** ancestor. Backdrop roots are:
- the root element
- any element with `filter` ≠ none, or `opacity` < 1
- `mask`, `mask-image`, `mask-border` or `clip-path` ≠ none
- `backdrop-filter` ≠ none
- `mix-blend-mode` ≠ normal
- `will-change` naming any of the above

Example from MDN: a parent with `opacity: 0.9` limits the child's blur to content inside that parent. So:
- Never fade a glass element's **parent** with `opacity` during a transition; fade the glass element itself.
- Don't nest glass inside glass. The inner one blurs only the outer one's pixels.

## `color-mix()`
- `color-mix(<color-interpolation-method>?, [<color> && <percentage [0,100]>?]#)`. The default space is **oklab** (`color-mix(red, blue)` ≡ `color-mix(in oklab, red, blue)`).
- Percentage normalization: if `p1 + p2 ≠ 100%`, they are scaled to sum to 100%. **If `p1 + p2 < 100%`, an alpha multiplier of `p1 + p2` is applied.** That is why `color-mix(in oklab, white 55%, transparent)` gives white at 55% opacity.
- Mixing with `transparent` adds transparency. It "can't be used to make a semi-transparent color fully opaque" (use relative color syntax for that).
- Color-space advice: oklab for perceptually even mixes; oklch to avoid graying; sRGB "only… to match the behavior of a specific device".
- Support (BCD `css.types.color.color-mix`): Chrome 111, Firefox 113, Safari 16.2 (iOS mirrors).

## `@supports`
- A feature query; it must sit at the top level or inside another conditional group rule. `not`, `and` and `or` combine conditions. Parenthesize each one.

## Performance notes
- MDN does not give performance numbers. **[UNVERIFIED]** cost figures. Treat blur as expensive on low-end Android, as the Beach Day performance-budgets skill does, and measure on a mid-range phone.

## Beach Day notes
- **Contrast-checked tokens use plain `rgb(r g b / a)`.** The checker script parses those, and they work everywhere. Use `color-mix(in oklab, …)` only for derived, non-text states such as a pressed tint (`color-mix(in oklab, var(--accent) 85%, black)`). Any color-mix value used for text or a control boundary must also be checked, by computing it in the browser (`getComputedStyle`) rather than in the Node script.
- Glass recipe: highlight gradient + tint as `background`, then `-webkit-backdrop-filter` and `backdrop-filter` with `blur(var(--glass-blur)) saturate(var(--glass-saturate))`. Three fallbacks:
  - `@supports not (…or -webkit-…)`
  - `prefers-reduced-transparency`
  - `prefers-contrast: more`
- At most 3 visible elements with `backdrop-filter` ≠ none. `examples/01-glass-tokens-demo/shoot.mjs` counts them.
- Never put `opacity`, `filter` or `will-change: opacity` on an ancestor of a glass surface (backdrop-root trap).
