---
name: apple-hig
description: Apple Human Interface Guidelines principles translated for a mobile web PWA — clarity, deference, depth, layout and safe areas, navigation, touch targets, typography, feedback, platform conventions, and what not to imitate. Use when designing or reviewing Beach Day flows, layouts and interactions.
---
# Apple HIG for the Beach Day PWA

Reference: https://developer.apple.com/design/human-interface-guidelines/ . Beach Day is a web app, so follow HIG **principles and conventions**, not native APIs. Don't copy Apple app UIs or trademarked assets.

## Principles
| Principle | What it means for Beach Day |
|---|---|
| **Clarity** | The verdict is the hero. One glance answers "go or not". Use plain words: "Great beach day", not "Score 84". |
| **Deference** | Content comes first and chrome stays minimal. Glass and motion support the content and never compete with it. |
| **Depth** | Layering shows hierarchy: a sheet over the list, detail over the summary. Transitions keep the user oriented. |
| **Consistency** | Use the same patterns everywhere. Tapping a day always opens the same detail layout. |

## Layout
- **Single column.** Respect `env(safe-area-inset-*)` and the home indicator. Use 16 px side margins (20 px on wider phones).
- **Navigation pattern:** large title at the top that collapses on scroll. A tab bar only if there are 3–5 top-level sections. v1 needs **Today · Beaches · Console**, and Console can stay hidden behind a link.
- **Sheets** (bottom, swipe or tap to dismiss) for the beach picker, the iOS install hint and the proposal detail.
- **Progressive disclosure:** summary → day detail → hourly detail.

## Touch & input
- **Targets** are at least **44 × 44 pt (CSS px)**, with spacing between them.
- **Feedback** on every tap: pressed state, or a loading indicator after 300 ms.
- No hover-only affordances.
- Standard gestures only: scroll, swipe to dismiss a sheet, pull to refresh. Every gesture has a visible button alternative.

## Typography
- **Font:** the system stack `-apple-system, BlinkMacSystemFont, system-ui, "Segoe UI", Roboto, sans-serif`. That gives SF on Apple devices without bundling SF Pro, whose licence is restricted.
- **Type scale:** Large Title 34 · Title 28/22/20 · Headline 17 semibold · Body 17 · Callout 16 · Subhead 15 · Footnote 13 · Caption 12. Use `rem` so it respects user text size.
- Use numerals with units ("84°F", "12 mph"). Avoid all-caps body text.

## Feedback & states
Design every state:
- loading (skeletons, not spinners, for the forecast)
- empty (no favorites)
- error ("Couldn't load waves — showing weather only")
- offline ("Offline — showing 8:15 am data")
- stale data

Use toasts briefly and announce them (`role="status"`).

## Writing (voice)
- Friendly, short and specific. Lead with the answer, then the reason: "Good — storms likely after 2 pm."
- Safety copy is calm and direct: "Check NWS rip-current risk and posted flags."

## Platform conventions on the web
- Back navigation works with the browser and the OS back gesture, using hash routes.
- Respect `prefers-color-scheme`, `prefers-reduced-motion` and `prefers-reduced-transparency`.
- Standalone mode has no browser chrome, so provide in-app back controls and a refresh affordance.
