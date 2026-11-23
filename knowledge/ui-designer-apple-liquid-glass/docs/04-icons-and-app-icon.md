# Interface icons and the app icon
Source:
- https://developer.apple.com/design/human-interface-guidelines/icons
- https://developer.apple.com/design/human-interface-guidelines/app-icons
- https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass (App icons section)

Retrieved: 2026-11-23

## Interface icons (glyphs)
From [Icons](https://developer.apple.com/design/human-interface-guidelines/icons):
- "Create a recognizable, highly simplified design." Use familiar metaphors tied to the action or content.
- "Maintain visual consistency across all interface icons in your app": the same size, level of detail, stroke weight and perspective.
- "In general, match the weights of interface icons and adjacent text."
- "If necessary, add padding to a custom interface icon to achieve optical alignment." Asymmetric icons (sun-cloud) should be centered optically, not geometrically.
- "If you create a custom interface icon, use a vector format like PDF or SVG."
- "Provide alternative text labels for custom interface icons."
- "Include text in your design only when it's essential for conveying meaning."
- "Avoid using replicas of Apple hardware products."
- Both interface icons and symbols "use black and clear colors to define their shapes", and the system tints the black areas. The web equivalent is `currentColor`.

## App icon
From [App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons) (change log: "October 28, 2026 Added guidance for app icon format options"; "June 8, 2026 Refined guidance for Liquid Glass"):
- **Layers:** iOS, iPadOS, macOS and watchOS icons are a background layer plus one or more foreground layers. The system adds Liquid Glass effects: specular highlights, refraction and translucency.
- "Prefer clearly defined edges in foreground layers." Avoid soft or feathered edges.
- "Design a background that both stands out and emphasizes foreground content." Gradients are fine.
- "Prefer vector graphics." Convert text to outlines.
- **Shape:** provide **square, unmasked** layers. The system applies the rounded-rectangle mask on iOS and the circle on watchOS and visionOS. "Providing layers with pre-defined masking negatively impacts specular highlight effects."
- "Keep primary content centered to avoid truncation when the system adjusts corners or applies masking."
- "Embrace simplicity", using a minimal number of shapes. "Consider basing your icon design around filled, overlapping shapes."
- "Include text only when it's essential." Avoid words like "Watch" or "Play".
- "Prefer illustrations to photos and avoid replicating UI components." "Avoid extremely thin line weights and sharp corners."
- "Let the system handle blurring and other visual effects": no baked-in shadows, bevels or glows.
- **Appearances:** default, dark, clear and tinted (iOS/iPadOS/macOS). "Keep your icon's features consistent across appearances."
- **Spec:** iOS/iPadOS/macOS layout 1024×1024 px, square, masked to a rounded rectangle. Color spaces: sRGB, Gray Gamma 2.2, Display P3.
- If you supply a flat bitmap instead of an Icon Composer file, the system tries to segment it into two layers. Thin lines and text don't get glass effects.

## Web/PWA reality (not from Apple)
- A PWA's home-screen icon comes from the web app manifest `icons` (and `apple-touch-icon` on iOS). The system's Liquid Glass layering does not apply to a flat PNG supplied by a website. **[UNVERIFIED]** how iOS 26 renders web-app icons in the dark, clear and tinted Home Screen appearances. Check on a device; see the `pwa-mobile-engineer` knowledge folder and docs/02-pwa-installability.md.
- Android adaptive/maskable icons need the important content inside a safe zone. The exact figure lives in the PWA docs, not Apple's.

## Beach Day notes
- **Sprite:** one `icons.svg` with `<symbol>`s on a 24×24 viewBox: 2 px round strokes, `stroke="currentColor"`, a `<title>` in each symbol, no scripts, no external refs. See `examples/03-icon-sprite`, which validates and renders it.
- **Verdict icon map:** sun = Great, sun-cloud = Good, cloud = Fair, storm = Skip it. The icon always sits next to the text label and is `aria-hidden="true"` there, because the label already carries the meaning.
- When an icon stands alone in a button (menu, close), the button gets an `aria-label`, and its border or icon must reach 3:1 (WCAG 1.4.11).
- Icon size scales with text (use `em` sizing in chips) to follow "Increase the size of meaningful interface icons as font size increases".
- **App icon:** an original sun-over-waves mark from filled, overlapping, simple shapes. Supply a square, unmasked full-bleed background with the mark centered well inside the maskable safe zone. No text and no baked-in gloss. Never use SF Symbols or Apple artwork.
