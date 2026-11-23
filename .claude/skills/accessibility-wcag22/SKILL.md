---
name: accessibility-wcag22
description: WCAG 2.2 AA requirements applied to Beach Day — color-independent verdicts, contrast on glass, 44px targets, focus, reflow, status messages, accessible auth, ARIA for streaming chat, and automated plus manual checks. Use when designing, building or testing any UI.
---
# Accessibility — WCAG 2.2 AA (details: docs/06 §5)

## Must-haves
| WCAG criterion | Beach Day rule |
|---|---|
| 1.4.1 Use of Color (A) | Verdicts always pair text + icon with color. Diffs mark lines with `+` / `−` as well as color. |
| 1.4.3 Contrast (AA) | Text ≥ 4.5:1, large text ≥ 3:1, **measured on the worst background behind the glass**. |
| 1.4.11 Non-text Contrast (AA) | Controls, focus rings, rating dots and chart lines ≥ 3:1. |
| 1.4.10 Reflow (AA) | Works at 320 CSS px with no horizontal page scroll. |
| 1.4.4 / 1.4.12 Resize & Text Spacing (AA) | `rem` units. Layout survives 200% zoom and increased spacing. |
| 2.4.7 Focus Visible / 2.4.11 Focus Not Obscured (AA) | Clear focus ring. Sticky bars and the chat composer never cover the focused element (`scroll-padding`). |
| 2.5.8 Target Size (AA) | Minimum 24 px. **We use 44 × 44 px** for every control. |
| 2.2.2 Pause, Stop, Hide (A) | No auto-moving content. Forecast refreshes don't shift focus. |
| 3.3.8 Accessible Authentication (AA) | Console password field allows paste and password managers. No puzzles. |
| 4.1.3 Status Messages (AA) | "Updated", "Offline", "Proposal ready", "Committed", "Live" use `role="status"`. |
| 2.4.2 / 1.3.1 Structure (A) | Page titles, one `h1`, ordered headings, landmarks (`header`, `nav`, `main`), real buttons and links, labelled inputs. |
| Language | `<html lang="en">`. Units are readable: "84 degrees Fahrenheit" via visually hidden text where symbols are ambiguous. |

## Agent Console chat
- The message list is `role="log"`, which is polite by default.
- A streaming message gets `aria-busy="true"` until it is done, then `false`, so screen readers announce it once.
- Use `role="alert"` only for errors.
- After the user sends a message, focus stays in the composer.
- Each proposal card has a heading, a file list and Approve/Reject buttons with explicit names ("Approve proposal: Update UV wording").

## Motion & transparency
Honor `prefers-reduced-motion` and `prefers-reduced-transparency`. In reduced-transparency mode, glass becomes solid.

## Checks
- **Automated:** `@axe-core/playwright` with tags `wcag2a`, `wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa`. Zero violations on key screens, in light, dark and reduced-transparency modes.
- **Manual** for each release:
  - VoiceOver on iPhone and TalkBack on Android
  - keyboard only
  - 200% zoom
  - color-blindness simulation on verdicts
- Automated tools catch only some issues, so the manual pass is required for every changed screen.
