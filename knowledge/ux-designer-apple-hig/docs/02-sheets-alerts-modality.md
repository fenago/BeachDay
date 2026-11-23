# Sheets, alerts, action sheets and modality
Source:
- https://developer.apple.com/design/human-interface-guidelines/sheets
- https://developer.apple.com/design/human-interface-guidelines/alerts
- https://developer.apple.com/design/human-interface-guidelines/modality
- https://developer.apple.com/design/human-interface-guidelines/action-sheets

Retrieved: 2026-11-23

## Sheets
From [Sheets](https://developer.apple.com/design/human-interface-guidelines/sheets) (change log: "March 24, 2026 Updated guidance for button placement"):
- A sheet "helps people perform a scoped task that's closely related to their current context."
- On iOS a sheet can be **modal** or **nonmodal**.
- Buttons:
  - **Cancel** (or Close) dismisses without saving.
  - **Done** dismisses after completing or saving.
  - **Back** steps back in a multi-step flow and "isn't intended to dismiss a sheet".
- iOS placement: "Cancel button belongs on the leading edge of the top toolbar. When present, the Done button belongs on the trailing edge."
- "Provide an alternative to the Done button." Always pair Done with Cancel or Back. "Avoid showing all three buttons — Cancel, Done, and Back — together."
- "Display only one sheet at a time from the main interface."
- "For complex or prolonged user flows, consider alternatives to sheets", such as a full-screen modal.
- **Detents:**
  - *large* = fully expanded; *medium* = "about half of the fully expanded height".
  - "In an iPhone app, consider supporting the medium detent to allow progressive disclosure."
  - "Include a grabber in a resizable sheet." It works with VoiceOver.
- "Support swiping to dismiss a sheet." If there are unsaved changes, confirm with an action sheet.

## Alerts
From [Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts):
- "Use alerts sparingly." "Avoid using an alert merely to provide information."
- "Avoid displaying alerts for common, undoable actions, even when they're destructive." Do show one for an uncommon destructive action that can't be undone.
- **"Avoid showing an alert when your app starts."** For startup problems like no network, "show cached or placeholder data and a nonintrusive label that describes the problem."
- Content: a title, optional informative text, up to **three** buttons, and an optional text field "only if you need people's input", for example "a secure text field to receive a password".
- Title: describe what happened and why. Not "Error" or "Error 329347 occurred". Avoid titles that wrap past two lines.
- "In all alert copy, be direct, and use a neutral, approachable tone." Don't mask the severity.
- Buttons:
  - One- or two-word titles that describe the result ("View All", "Erase"). Title case, no ending punctuation.
  - **"Avoid using OK as the default button title unless the alert is purely informational."**
  - "Always use 'Cancel' to title a button that cancels the alert's action."
  - Placement: the likeliest button on the trailing side of a row (top of a stack). Cancel goes leading or bottom.
  - Destructive style: use it for a destructive action people *didn't deliberately choose*. If there's a destructive action, include Cancel. Don't make Cancel the default.
- iOS: "Use an action sheet — not an alert — to offer choices related to an intentional action." Avoid alerts that scroll.

## Modality
From [Modality](https://developer.apple.com/design/human-interface-guidelines/modality):
- "Present content modally only when there's a clear benefit."
- "Aim to keep modal tasks simple, short, and streamlined." Avoid "an app within your app".
- "Always give people an obvious way to dismiss a modal view."
- "When necessary, help people avoid data loss by getting confirmation before closing a modal view."
- "Make it easy to identify a modal view's task." Give it a title that names the task.
- "Let people dismiss a modal view before presenting another one."

## Accessibility page: confirmations
From [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility), Assistive Access guidance: "Always ask for confirmation twice whenever people perform an action that's difficult to recover from."

## Beach Day notes
- **Sheets we use:**
  - **Beach picker** (medium detent + grabber; Cancel leading, no Done because choosing a row completes it)
  - **iOS Add to Home Screen hint** (medium; a Close button)
  - **Proposal detail** in the Console (large; Cancel leading, plus the Approve and Reject actions)
  - Only one at a time.
- Every sheet has a visible close button as well as swipe-to-dismiss. That is the HIG "alternatives to gestures" rule, and it matters for keyboard and switch users.
- **No alert at launch.** Offline and errors on Today are inline labels over cached data ("Offline — showing 8:15 am forecast").
- **Approve in the Console:**
  - Approve deploys to production. It is deliberate, rare and can't be undone (it can only be reverted), so it gets an explicit confirmation step with consequences spelled out, plus password re-auth (doc 04 §4). The confirm button is titled with the result, "Approve and Deploy", never "OK".
  - Cancel is always present and is not the default.
  - The re-auth password field is in the confirmation sheet itself: Apple's "include a text field only if you need people's input", with a secure field.
- **Reject** is low-risk and undoable in effect (the proposal can be regenerated), so no alert. Use an inline "Rejected" status instead.
- Web implementation: `<dialog>` with `showModal()` for modal sheets and alerts. Focus goes to the dialog heading or first field and returns to the invoking button on close. `Esc` closes (Apple lists Escape as an alternative way to cancel).
