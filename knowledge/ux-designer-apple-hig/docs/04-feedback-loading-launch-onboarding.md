# Feedback, loading, progress, launching, onboarding, notifications
Source:
- https://developer.apple.com/design/human-interface-guidelines/feedback
- https://developer.apple.com/design/human-interface-guidelines/loading
- https://developer.apple.com/design/human-interface-guidelines/progress-indicators
- https://developer.apple.com/design/human-interface-guidelines/launching
- https://developer.apple.com/design/human-interface-guidelines/onboarding
- https://developer.apple.com/design/human-interface-guidelines/notifications

Retrieved: 2026-11-23

## Feedback
From [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback):
- Feedback covers status, the success or failure of a task, warnings, and chances to correct mistakes. "Match the significance of the information to the way it's delivered": status is passive, and data-loss warnings interrupt.
- "Make sure all feedback is accessible." Use several channels: color, text, sound, haptics.
- "Consider integrating status feedback into your interface." Mail's example shows the last-update time in the toolbar.
- "Use alerts to deliver critical — and ideally actionable — information."
- "Warn people when they initiate a task that can cause data loss that's unexpected and irreversible." Don't warn when the loss is the expected result.
- "When it makes sense, confirm that a significant action or task has completed." Reserve this for important tasks.
- "Show people when a command can't be carried out and help them understand why."

## Loading
From [Loading](https://developer.apple.com/design/human-interface-guidelines/loading):
- "The best content-loading experience finishes before people become aware of it."
- "Show something as soon as possible": placeholder text or graphics, replaced as content arrives.
- "Let people do other things in your app or game while they wait."
- Use a *determinate* indicator when the duration is known and an *indeterminate* one when it isn't.

## Progress indicators
From [Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators):
- "When possible, use a determinate progress indicator", and be accurate with it.
- "Keep progress indicators moving." A stalled indicator looks frozen; if it really stalls, explain.
- "Don't switch from the circular style to the bar style."
- "Avoid vague terms like *loading* or *authenticating* because they seldom add value." Describe the actual task.
- "Display a progress indicator in a consistent location."
- "When it's feasible, let people halt processing" with Cancel, and warn when cancelling loses progress.
- iOS refresh control (pull to refresh): "Perform automatic content updates." Don't make people start every update. A title is optional; when present it should carry useful information, like the time of the last update, not refresh instructions.

## Launching
From [Launching](https://developer.apple.com/design/human-interface-guidelines/launching):
- "Launch instantly."
- A launch screen should be "nearly identical to the first screen". No text, no advertising, and match the current appearance mode.
- "Restore the previous state when your app restarts."

## Onboarding
From [Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding):
- Onboarding should be "fast, fun, and optional", and it happens *after* launch.
- "Teach through interactivity." Prefer "context-specific tips" over a single onboarding flow.
- "Postpone nonessential setup flows or customization steps." Provide reasonable defaults.
- Ask for permissions when people first use the feature that needs them, unless the app can't work without them.
- "Prefer letting people experience your app or game before prompting them for ratings or purchases."

## Notifications
From [Notifications](https://developer.apple.com/design/human-interface-guidelines/notifications):
- These need consent. Make them "concise, informative".
- "Avoid sending multiple notifications for the same thing."
- **"Use an alert — not a notification — to display an error message."**
- "Avoid including sensitive, personal, or confidential information in a notification."
- Up to four action buttons. "Avoid providing an action that merely opens your app." Prefer nondestructive actions.
- Badges show only the unread notification count. Never weather data or other numbers.

## Beach Day notes
- **Today loading:** show the beach name and the skeleton of the verdict card immediately (HIG "show something as soon as possible"; skeletons per the apple-hig skill). If cached data exists, show it at once with a stale label, then swap in fresh data without moving focus.
- **Status line** (integrated feedback, like Mail's toolbar): "Updated 8:15 am", or "Offline — showing 8:15 am forecast". Placed under the beach name and announced via `role="status"`.
- **Progress copy is specific:** "Getting the forecast…" and "Committing to main…", not "Loading…".
- **Approve progress:** a sequence of determinate *steps*, Committing → Deploying → Live, each with a timestamp. There is no fake percentage bar, because deploy duration is unknown (HIG: be accurate).
- **Success confirmation:** Approve is significant, so confirm completion ("Committed abc1234 · Deploying…", then "Live"). Chat replies are not confirmed; they appear in place.
- **Cancel:** allowed while a chat reply streams ("Stop"). Not allowed once the commit request is sent, because GitHub may already have the commit. Say so before Approve.
- **No onboarding carousel.** First launch = choose a beach (a single task), then Today. The install hint is a context tip shown after a second visit, never on first launch, and never twice after dismissal (owned by the ios-android-install-behavior skill).
- **Notifications are out of scope for v1.** If they are added later: one notification per forecast change, nothing sensitive, no badge counts for weather.
