# Accessibility for flows: HIG Accessibility, WCAG 2.5.8 and 4.1.3
Source:
- https://developer.apple.com/design/human-interface-guidelines/accessibility
- https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html
- https://www.w3.org/WAI/WCAG22/Techniques/aria/ARIA22 , ARIA19 , ARIA23 ; https://www.w3.org/WAI/WCAG22/Techniques/general/G199
- https://www.w3.org/TR/WCAG22/#dfn-status-messages

Retrieved: 2026-11-23 (HIG Accessibility change log: "March 7, 2025 Expanded and refined all guidance", "June 9, 2025 Added guidance … Assistive Access")

## HIG Accessibility: the parts that drive flows
An accessible interface is **intuitive, perceivable and adaptable** ([Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)).

**Vision**
- Support enlarging text by at least 200%.
- Default and minimum text sizes on iOS are 17 / 11 pt.
- Contrast: up to 17 pt → 4.5:1; 18 pt → 3:1; bold → 3:1 (Apple's table; WCAG is stricter for bold, see Sable's docs/02).
- "Convey information with more than color alone": shapes, icons, labels.

**Mobility**
| Platform | Default control size | Minimum control size |
|---|---|---|
| iOS, iPadOS | 44x44 pt | 28x28 pt |

- Spacing: about 12 pt of padding around bezelled elements and about 24 pt around non-bezelled ones.
- "Support simple gestures for common interactions."
- **"Offer alternatives to gestures."** If swipe dismisses a view, also offer a button.
- Label elements for Voice Control.

**Speech / keyboard**
- "Let people use the keyboard alone to navigate and interact with your app" (Full Keyboard Access). Don't override system shortcuts.

**Cognitive**
- "Keep actions simple and intuitive." Prefer familiar system gestures.
- **"Minimize use of time-boxed interface elements"** that auto-dismiss on a timer; "Prefer dismissing views with an explicit action."
- Let people control audio and video, and be careful with fast-moving or blinking animation.
- Assistive Access: "Break up multistep workflows so people can focus on a single interaction per screen" and "Always ask for confirmation twice whenever people perform an action that's difficult to recover from".

## WCAG 2.5.8 Target Size (Minimum), AA
- The minimum is **24×24 CSS px**. The exceptions are Spacing, Equivalent, Inline, User agent control and Essential. Full text is in docs/03.
- Understanding:
  - the 24×24 square must fit inside the target
  - zoom doesn't help meet the criterion
  - a target hidden by a dialog is exempt only while hidden
  - "using larger target sizes will help many people"

## WCAG 4.1.3 Status Messages, AA
- Normative: "In content implemented using markup languages, status messages can be programmatically determined through role or properties such that they can be presented to the user by assistive technologies without receiving focus."
- **Status message** (definition): a "change in content that is not a change of context, and that provides information to the user on the success or results of an action, on the waiting state of an application, on the progress of a process, or on the existence of errors".

From Understanding 4.1.3:
- **In scope:** "Searching...", "18 results returned", "5 items" in a cart, "Invalid entry" next to a field, a busy icon announced as "application busy", progress-bar updates, "Your form was successfully submitted."
- **Out of scope:**
  - an error shown **in a dialog that takes focus** (that's a change of context, already announced)
  - expanding or collapsing widgets (covered by 4.1.2)
  - new form fields appearing
- **Removal** of a "busy" message can itself be information. Announce the end of waiting, for example "Loaded".
- **Don't over-announce:** "there is a risk of making an application too 'chatty' for a screen reader user."
- **Sufficient techniques** listed on the page: ARIA22, G199, ARIA19, G83, G84, G85, G177, G194, ARIA23, ARIA25, G193, ARIA27. The key ones:
  - **ARIA22** "Using role=status to present status messages" (polite)
  - **ARIA19** "Using ARIA role=alert or Live Regions to Identify Errors" (assertive)
  - **ARIA23** "Using role=log to identify sequential information updates" (chat)
  - **G199** "Providing success feedback when data is submitted successfully"
- Live-region practice: the region element must exist in the DOM *before* its text changes, or many screen readers miss the update. **[UNVERIFIED]** in the pages read here; it's the common ARIA authoring practice, and our Playwright checks only assert that the role exists.

## Beach Day notes
- **Targets:** 44×44 CSS px everywhere (HIG default size), 8–12 px apart. That exceeds 2.5.8.
- **Gesture alternatives:** sheets have a Close button; pull-to-refresh has a Refresh button in the top bar; any swipe on the day strip also has tap targets and arrows.
- **Status messages (`role="status"`, polite)**, mapped to WCAG examples:
  - Today: "Updated 8:15 am" / "Offline — showing 8:15 am forecast" / "Forecast is 3 hours old"
  - Picker: "Hollywood Beach selected"
  - Console: "New change ready. Check the diff below.", "Committing to main…", "Committed abc1234. Deploying…" or "Committed abc1234. No deploy needed.", "Live"
- **Errors:** `role="alert"` only for errors that block the task ("That password didn't match", "The commit failed", the approve-cap message). The Today "couldn't load waves" message is a polite status, because cached data still answers the question.
- **Chat:** the message list is `role="log"` (ARIA23) with `aria-busy="true"` while a reply streams, then `false`.
- **No auto-dismissing toasts that carry unique information.** Toasts duplicate the persistent status line.
- **Approve is "difficult to recover from"** (production deploy), so it gets a two-step confirmation (review → "Confirm it's you" and approve), matching the HIG Assistive Access advice.
- Run axe (`@axe-core/playwright`, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`) on each screen state. axe can't judge copy, focus order or announcement noise, so do the manual VoiceOver/TalkBack pass too.
