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
| 3.3.8 Accessible Authentication (AA) | No step needs a cognitive function test unless it has an alternative or a mechanism. See "Accessible authentication" below. |
| 3.3.7 Redundant Entry (A) | No "confirm password" field; use one field and a Show Password button. Don't ask again for the email on the same flow. |
| 4.1.3 Status Messages (AA) | "Updated", "Offline", "New change ready", "Committed", "No deploy needed", "Live", "Sent again", "Confirmed" use `role="status"`. |
| 2.4.2 / 1.3.1 Structure (A) | Page titles, one `h1`, ordered headings, landmarks (`header`, `nav`, `main`), real buttons and links, labelled inputs. |
| Language | `<html lang="en">`. Units are readable: "84 degrees Fahrenheit" via visually hidden text where symbols are ambiguous. |

## Accessible authentication (WCAG 3.3.8; Console sign in, sign up, reset and the Approve step-up)
- **Password fields allow paste and password managers.** `type="password"` with `autocomplete="current-password"` (sign in, step-up) or `"new-password"` (sign up, reset). Sign-in email: `autocomplete="username"`, `type="email"`, `autocapitalize="none"`, `spellcheck="false"`. Never `autocomplete="off"`, never block `paste`, never prefill a password.
- **No cognitive tests:** no CAPTCHA, no puzzle, no security question, no "type the 3rd character". If a CAPTCHA is ever switched on in Supabase, it needs a non-cognitive alternative first; raise it with supabase-auth-engineer.
- **A second method exists:** "Continue with Google" (and "Confirm with Google" for step-up) is a real `<button>`, redirect-based (no popup), keyboard-operable, with visible text.
- **Show Password** is a button with `aria-pressed` (no hover-only reveal).
- **Errors:** next to the field, linked by `aria-describedby`, `aria-invalid="true"` only on a field that is itself wrong. A failed sign-in doesn't say which field was wrong, so it sets neither field invalid. Form-level failure is `role="alert"`; waiting and success ("Check your email", "Sent again to …") is `role="status"`.
- **Focus:** after each route change focus goes to the new `h1`. After a wrong password, focus returns to the password field with the text selected. After the Google round trip (a redirect that approves nothing), focus lands on the Approve and Deploy button.
- **Timeouts:** the step-up confirmation has a time window ({minutes} = 10); when it ends, say so in a status message ("Time ran out. Confirm it's you again.") and keep the sheet open. Don't auto-dismiss it.
- **Resend cooldowns** announce at the start and end only, not each second.
- Redundant entry (3.3.7): the resend and "Use Another Email" paths keep the typed email.
- Spec and checks: `knowledge/ux-designer-apple-hig/examples/04-console-auth/` and the axe run in `examples/03-console-approval/`.

## Agent Console chat
- The message list is `role="log"`, which is polite by default.
- A streaming message gets `aria-busy="true"` until it is done, then `false`, so screen readers announce it once.
- Use `role="alert"` only for errors.
- After the user sends a message, focus stays in the composer.
- Each proposal card has a heading, a file list and Approve/Reject buttons with explicit names ("Approve proposal: Update UV wording").
- The approve-cap message ("14 of 14 approvals used in the last 31 days. Next slot frees Dec 4.") is a blocking failure, so `role="alert"`; the "no access" (Agents only) and "session ended" states are screens (focus the `h1`). A `401 step_up_required` reopens the Confirm sheet, not "session ended".

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
