# Liquid Glass and materials (Apple HIG)
Source:
- https://developer.apple.com/design/human-interface-guidelines/materials
- https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass
- https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/

Retrieved: 2026-11-23 (HIG pages read from Apple's DocC JSON, e.g. `https://developer.apple.com/tutorials/data/design/human-interface-guidelines/materials.json`)

## What Liquid Glass is
- Announced 9 June 2025 for iOS 26, iPadOS 26, macOS Tahoe 26, watchOS 26 and tvOS 26. Apple describes it as a translucent material that "reflects and refracts its surroundings" and whose color "is informed by surrounding content and intelligently adapts between light and dark environments", using real-time rendering with specular highlights that react to movement. ([Newsroom](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/))
- The HIG Materials page splits materials into two kinds ([Materials](https://developer.apple.com/design/human-interface-guidelines/materials)):
  - **Liquid Glass**: a distinct *functional layer* for controls and navigation (tab bars, sidebars, toolbars) that floats above content and lets content scroll and "peek through".
  - **Standard materials** (blur, vibrancy, blending): for visual differentiation *inside the content layer*. iOS keeps four: ultra-thin, thin, regular (default), thick.
- Materials page change log: "June 9, 2025 Added guidance for Liquid Glass", "September 9, 2025 Updated guidance for Liquid Glass".

## Rules from the Materials page
| Rule (Apple's bold heading) | What it means |
|---|---|
| "Don't use Liquid Glass in the content layer." | Glass is for controls/navigation. Content-layer backgrounds use standard materials. Exception: transient controls in content (slider, toggle knob) take on glass *while being activated*. |
| "Use Liquid Glass effects sparingly." | Limit custom glass to "the most important functional elements"; overuse distracts from content. |
| "Only use clear Liquid Glass for components that appear over visually rich backgrounds." | Two variants: **regular** and **clear**. |

### Regular vs clear
- **Regular** "blurs and adjusts the luminosity of background content to maintain legibility". Use it when the background might hurt legibility or the component holds a lot of text (alerts, sidebars, popovers). Most system components use it.
- **Clear** is "highly translucent", for components floating over media (photos, video).
- Dimming for clear glass: if the content underneath is bright, "consider adding a dark dimming layer of 35% opacity"; if it is already dark, no dimming layer is needed.
- Both variants change when people pick a preferred Liquid Glass look in Settings, or turn on Reduce Transparency or Increase Contrast.

### Standard materials
- "Choose materials and effects based on semantic meaning and recommended usage", not on the color they happen to produce, because system settings change their appearance.
- Thicker (more opaque) materials give better contrast for text and fine detail; thinner ones keep more context visible.
- Vibrancy levels for labels on iOS: `label` (default, highest contrast), `secondaryLabel`, `tertiaryLabel`, `quaternaryLabel`. Apple: avoid quaternary on thin and ultraThin materials, "because the contrast is too low".

## Adopting Liquid Glass (developer guidance, relevant design points)
From [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass):
- **"Reduce your use of custom backgrounds in controls and navigation elements."** Custom backgrounds can interfere with glass and with the *scroll edge effect* (which blurs and fades content scrolling under bars).
- **"Test your interface with a variety of display and accessibility settings."** People can reduce transparency or motion; those settings "can remove or modify certain effects".
- **"Avoid overusing Liquid Glass effects."** Same advice as the HIG.
- **Controls:** "Check for crowding or overlapping of controls" and avoid "layering Liquid Glass elements on top of each other".
- **"Optimize for legibility when content scrolls beneath controls."** Native apps get a scroll edge effect; custom bars must provide one.
- **Concentric shapes:** controls use rounded shapes concentric with their containers (hardware corners → window → sheet → control).
- **Color in controls:** use system colors, or custom colors with light and dark variants plus an increased-contrast option for each.
- **Navigation:** glass applies to the topmost (navigation) layer; keep a clear navigation hierarchy distinct from content.
- Native APIs (for reference only; we are a web app): SwiftUI `glassEffect(_:in:)`, UIKit `UIGlassEffect`, AppKit `NSGlassEffectView`; button styles `glass` / `glassProminent`.

## Layout page notes on glass
From [Layout](https://developer.apple.com/design/human-interface-guidelines/layout): "Differentiate controls from content." Apple prefers a scroll edge effect over "a solid or semi-opaque background color beneath controls", and full-screen background content should extend underneath tab bars and toolbars.

## What we cannot reproduce on the web
- Real refraction, lensing and motion-reactive specular highlights are rendered by Apple's system compositor. CSS has `backdrop-filter` (blur, saturate, brightness…) but no refraction. **[UNVERIFIED]** whether any SVG-filter refraction approach is fast enough on mid-range Android; we do not use one.
- The system's automatic light/dark adaptation of small glass elements based on the content beneath ("becoming darker when the underlying content is light") has no CSS equivalent. We pick one tint per color scheme and prove contrast against the worst background instead (see docs/02 and examples/02).

## Beach Day notes
- **Glass only on the navigation/control layer:** top bar, bottom bar (if any), sheets, and the single floating verdict card over the sky. Day lists, hourly strips and Console diffs are content: solid `--surface-solid` cards, not glass. That follows "Don't use Liquid Glass in the content layer", and it also keeps us within the **max 3 visible blur surfaces** budget.
- We implement **regular** glass only (strong tint plus blur). We do not ship a "clear" variant, since we have no photo or video backgrounds (condition gradients only).
- No glass-on-glass. A sheet over the top bar is fine; a glass chip inside a glass card is not.
- Bars get a custom "scroll edge": when content scrolls under the sticky top bar, the bar's tint is strong enough that the worst case (white card or black content) still passes 4.5:1. That is computed in `examples/02-contrast-check`.
- We take inspiration only. No Apple assets or screenshots, no SF Symbols, and we don't claim to be "Liquid Glass".
