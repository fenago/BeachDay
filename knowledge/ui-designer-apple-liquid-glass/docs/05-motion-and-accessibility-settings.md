# Motion, Reduce Motion and Reduce Transparency
Source:
- https://developer.apple.com/design/human-interface-guidelines/motion
- https://developer.apple.com/design/human-interface-guidelines/accessibility
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency
- https://github.com/mdn/browser-compat-data (css/at-rules/media.json, read 2026-11-23)

Retrieved: 2026-11-23

## Apple HIG: Motion
From [Motion](https://developer.apple.com/design/human-interface-guidelines/motion) (change log: "September 9, 2025 Added guidance for Liquid Glass"):
- "Add motion purposefully, supporting the experience without overshadowing it."
- "Make motion optional." Never use motion as the only way to communicate important information.
- "Strive for realistic feedback motion that follows people's gestures and expectations." A view revealed by sliding down should not be dismissed by sliding sideways.
- "Aim for brevity and precision in feedback animations."
- "In apps, generally avoid adding motion to UI interactions that occur frequently."
- "Let people cancel motion." Don't make people wait for an animation to finish.
- Liquid Glass motion "responds to direct touch interaction with greater emphasis", and is more subdued with a trackpad.

## Apple HIG: Accessibility, Reduce Motion
"Be cautious with fast-moving and blinking animations." When Reduce Motion is on, reduce "automatic and repetitive animations, including zooming, scaling, and peripheral motion". Apple's list ([Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)):
- Tightening animation springs to reduce bounce effects
- Tracking animations directly with people's gestures
- Avoiding animating depth changes in z-axis layers
- Replacing transitions in x-, y-, and z-axes with fades to avoid motion
- **Avoiding animating into and out of blurs**

Also from the same page: "Minimize use of time-boxed interface elements" (prefer an explicit dismiss), and let people control audio and video playback.

## Reduce Transparency and Increase Contrast (Apple)
- Materials page: glass variants change when people "turn on accessibility settings that reduce transparency or increase contrast".
- Dark Mode page: test with Increase Contrast and Reduce Transparency on, both separately and together.
- Accessibility page: if default contrast is below the minimum, at least provide a higher-contrast scheme when Increase Contrast is on.

## CSS: `prefers-reduced-motion`
From [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-motion):
- Values `no-preference` | `reduce`. `@media (prefers-reduced-motion)` is the same as `@media (prefers-reduced-motion: reduce)`.
- The iOS setting is under Settings > Accessibility > Motion; Android 9+ is Settings > Accessibility > Remove animations.
- Support (BCD): Chrome 74, Firefox 63, Safari 10.1, with iOS Safari mirroring Safari.

## CSS: `prefers-reduced-transparency`
From [MDN](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@media/prefers-reduced-transparency):
- Status: **experimental**. Values `no-preference` | `reduce`.
- OS settings: Windows (Personalization > Colors > Transparency effects), macOS (Accessibility > Display > Reduce transparency), iOS (Settings > Accessibility > Display & Text Size > Reduce Transparency).
- **Browser support from MDN's browser-compat-data (`css.at-rules.media.prefers-reduced-transparency`):**
  - Chrome / Edge / Chrome Android: **118**
  - Firefox: 113, **behind the pref** `layout.css.prefers-reduced-transparency.enabled`
  - **Safari and iOS Safari: `version_added: false`** (not supported; WebKit bug 175497)
- **Consequence:** on iPhone, the user's Reduce Transparency setting is *not visible to our CSS*. Our default glass must therefore be legible on its own: tinted strongly enough to pass 4.5:1 over the worst background. The media query is a bonus, not the main control.

## CSS: `prefers-contrast` and `prefers-color-scheme`
- `prefers-contrast`: Chrome 96, Firefox 101, Safari 14.1 (BCD). Use `more` to switch glass to the solid surface and show control borders. That is the closest web match to iOS Increase Contrast. **[UNVERIFIED]** whether iOS Safari maps Increase Contrast to `prefers-contrast: more`; test on a device.
- `prefers-color-scheme`: Chrome 76, Firefox 67, Safari 12.1, iOS Safari 13.

## Testing these in Chromium
- Playwright 1.63 `browser.newContext({ colorScheme, reducedMotion, contrast })` covers scheme, motion and contrast. It has no `reducedTransparency` option (checked in `playwright-core/types/types.d.ts`).
- Chromium DevTools Protocol does emulate it:
  `cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-transparency', value: 'reduce' }] })`.
  Verified in `examples/01-glass-tokens-demo/shoot.mjs`, where `matchMedia(...)` returned `true`.

## Beach Day notes
- **Motion tokens:** `--dur-fast 200ms`, `--dur-base 280ms`, `--dur-slow 350ms`. Animate `transform` and `opacity` only. Sheets rise from the bottom and cards expand from their source.
- **Never animate `backdrop-filter`/blur.** That is Apple's "avoiding animating into and out of blurs", and it's also a performance rule.
- **`prefers-reduced-motion: reduce`:** remove entrance animations. A pressed state becomes an opacity change, not a scale. No looping animation anywhere (also WCAG 2.2.2).
- **`prefers-reduced-transparency: reduce`** (Chromium): glass becomes `--surface-solid` with `backdrop-filter: none`.
- **`prefers-contrast: more`:** solid surface plus a visible `--control-border` rim.
- Because iOS Safari can't see Reduce Transparency, contrast is proven against the worst backgrounds for the *transparent* state (examples/02). That is what makes it safe to skip the fallback there.
- Toasts don't auto-dismiss while they are the only route to information, per the HIG's "minimize time-boxed elements". Status text also persists in the UI.
