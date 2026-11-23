# Buttons, entering data and authentication
Source:
- https://developer.apple.com/design/human-interface-guidelines/buttons
- https://developer.apple.com/design/human-interface-guidelines/entering-data
- https://developer.apple.com/design/human-interface-guidelines/managing-accounts
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html (SC 2.5.8)
- https://www.w3.org/TR/WCAG22/#accessible-authentication-minimum (SC 3.3.8)

Retrieved: 2026-11-23

## Buttons (HIG)
From [Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons):
- A button combines **style**, **content** (icon and/or label) and **role**.
- "As a general rule, a button needs a hit region of at least **44x44 pt**" (60×60 pt in visionOS).
- "Always include a press state for a custom button."
- "Use a button that has a prominent visual style for the most likely action in a view." "Keep the number of prominent buttons to one or two per view."
- "Use style — not size — to visually distinguish the preferred choice among multiple options."
- Content: "Consider using text when a short label communicates more clearly than an icon." Start with a verb, in title case ("Add to Cart").
- **Roles:** Normal, Primary, Cancel, Destructive.
  - "Assign the primary role to the button people are most likely to choose."
  - **"Don't assign the primary role to a button that performs a destructive action, even if that action is the most likely choice."**
- iOS: "Configure a button to display an activity indicator when you need to provide feedback about an action that doesn't instantly complete." The label can change, for example "Checkout" → "Checking out…".

## Entering data (HIG)
From [Entering data](https://developer.apple.com/design/human-interface-guidelines/entering-data):
- "Get information from the system whenever possible" (with permission, such as location).
- "Be clear about the data you need": a label plus a hint or placeholder.
- "Use a secure text-entry field when appropriate." **"Never prepopulate a password field."**
- "When possible, offer choices instead of requiring text entry."
- "Let people provide data by dragging and dropping it or by pasting it."
- "Dynamically validate field values." Give feedback as soon as a problem is detected.
- Make required data clear; enable Next/Continue only after the required data is entered.

## Managing accounts (HIG)
From [Managing accounts](https://developer.apple.com/design/human-interface-guidelines/managing-accounts):
- "Delay sign-in for as long as possible."
- Prefer passkeys over passwords where possible.
- "Always identify the authentication method you offer", for example "Sign In with Face ID", not "Sign In".
- "Avoid using the term *passcode* to refer to account authentication." People associate it with their device passcode.

## WCAG 2.2 SC 2.5.8 Target Size (Minimum), AA
Normative: "The size of the target for pointer inputs is at least **24 by 24 CSS pixels**, except when":
- **Spacing:** an undersized target's 24 px circle, centered on its bounding box, doesn't intersect another target or another target's circle.
- **Equivalent:** another control on the page does the same thing and meets the size.
- **Inline:** the target is in a sentence or limited by the line-height of non-target text.
- **User agent control:** the size is set by the browser and not modified by the author.
- **Essential:** a particular presentation is essential or legally required.

From [Understanding 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html):
- "at least 24 by 24" means a solid 24×24 square must fit **inside** the target. Rounded corners can make a 24 px pill undersized.
- Zoom doesn't count: CSS-pixel size doesn't change with zoom.
- Targets temporarily obscured by a dialog are exempt while obscured, but targets *in* the new content are not.
- WCAG notes this is a minimum. Larger targets (as in AAA 2.5.5 at 44×44) help many more people.

## WCAG 2.2 SC 3.3.8 Accessible Authentication (Minimum), AA
Normative: "A cognitive function test (such as remembering a password or solving a puzzle) is not required for any step in an authentication process unless that step provides at least one of":
- an **Alternative** method
- a **Mechanism** to assist
- **Object Recognition**
- **Personal Content**

The SC's own examples of mechanisms: "support for password entry by password managers" and "copy and paste to reduce the cognitive burden of re-typing". So a password field passes only if paste and autofill work.

## Beach Day notes
- **Targets:** every Beach Day control is ≥ **44×44 CSS px** (HIG). That's well above the WCAG 24 px minimum. The exception is inline links inside sentences such as the safety line, which 2.5.8's Inline exception covers. Keep pill buttons tall enough that a 24 px square fits inside the rounded ends.
- **One prominent button per view:**
  - Today: "See hourly".
  - Proposal card: "Review and Approve…". The final "Approve and Deploy" in the confirm step is prominent but deliberately **not** auto-focused and not triggered by Enter from elsewhere. It isn't destructive in the data-loss sense, but it does ship to production, so we confirm it.
- **Labels:** verb-first, title case for buttons ("Approve and Deploy", "Reject", "Try Again", "Choose Beach"). Sentence case for body copy and errors.
- **Busy buttons:** "Approve and Deploy" → "Committing…" with a spinner and `aria-disabled="true"`; double submits are blocked server-side too (CAS in Blobs).
- **Console auth:**
  - The password field is `type="password"` with `autocomplete="current-password"`, never prefilled, and paste allowed (3.3.8). No CAPTCHA.
  - The label says "Console password", not "passcode".
  - Re-auth for Approve uses the same field type in the confirmation sheet (docs/04 §4: within the last 10 min). The button is titled with the method, "Confirm with Password".
- **Beach search:** offer a list of beaches plus "Nearest" (geolocation), rather than free-text entry.
