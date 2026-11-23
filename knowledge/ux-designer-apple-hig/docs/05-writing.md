# UX writing (HIG Writing, plus copy rules from alerts and buttons)
Source:
- https://developer.apple.com/design/human-interface-guidelines/writing
- https://developer.apple.com/design/human-interface-guidelines/alerts (Content, Buttons)
- https://developer.apple.com/design/human-interface-guidelines/buttons (Content)
- https://developer.apple.com/design/human-interface-guidelines/progress-indicators

Retrieved: 2026-11-23 (Writing page change log: "December 16, 2025 Clarified guidance on language patterns, and added guidance for possessive pronouns")

## Getting started
- **"Determine your app's voice."** Keep a list of common terms and reuse it.
- **"Match your tone to the context."** What are people doing physically and in the app? Be serious for errors, light for wins.
- **"Be clear."** "If you can use fewer words, do so. When in doubt, read your writing out loud."
- **"Write for everyone."** Use plain language, avoid jargon and gendered terms, and keep localization in mind.

## Best practices (Apple's headings, with the concrete rule)
| Heading | Rule |
|---|---|
| Consider each screen's purpose | The most important information comes first; split multiple ideas across screens. |
| Be action oriented | Use active voice and verb button labels. "Send" beats "Let's do it!". No "Click here"; descriptive links like "Learn more about UX Writing" help screen-reader users. |
| Build language patterns | Consistency builds familiarity. |
| Capitalization | Pick title case or sentence case per element type and apply it consistently. |
| Multi-step processes | Start with "Get Started", continue with a consistent "Continue" or "Next", and end with "Done". |
| Use possessive pronouns sparingly | "Favorites" not "Your Favorites". **Avoid "we"**: "Unable to load content" is clearer than "We're having trouble loading this content." |
| Write for how people use each device | Say "tap", not "click", on touch devices. Small screens need brevity. |
| Provide clear next steps on any blank screens | Empty states guide people to an action, ideally with a button. Don't put crucial info in an empty state, because it disappears. |
| Write clear error messages | Place the error near the problem, avoid blame, and say how to fix it ("Choose a password with at least 8 characters"). No "oops!" or "uh-oh". |
| Choose the right delivery method | Match urgency to the channel: notification, alert or action sheet. |
| Keep settings labels clear and simple | Describe what a setting does when on. Link directly to settings. |
| Show hints in text fields | Put the format example in the hint, show the error next to the field, and give instructions ("Use only letters for your name"), not "Invalid name". |

## Alert and button copy
- Alert titles say what happened and why. Never just "Error" or a code. Two lines max.
- A full-sentence title uses sentence case and punctuation.
- Button titles are one or two words, verb-based, title case, no ending punctuation. Avoid "OK" unless the alert is purely informational. Always "Cancel" for cancel. ([Alerts](https://developer.apple.com/design/human-interface-guidelines/alerts))
- Buttons: start with a verb, title case ("Add to Cart"). ([Buttons](https://developer.apple.com/design/human-interface-guidelines/buttons))
- Progress text: avoid vague words like "loading" or "authenticating". ([Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators))

## Readability measures (not Apple; for our own copy checks)
- Apple doesn't give a numeric reading-level target. **[UNVERIFIED]** any official HIG reading-grade requirement; none was found on the Writing page.
- We use the Flesch Reading Ease formula as a rough proxy:
  `206.835 − 1.015 × (words / sentences) − 84.6 × (syllables / words)`.
  Higher is easier; 60+ ≈ plain English. Syllable counts are heuristic, so treat scores on very short strings as indicative only. This is the standard published formula (Flesch, 1948), not from an Apple page.

## Beach Day notes
- **Voice:** a friendly local who checks the beach for you. Plain, short, specific, calm about safety.
- **Lead with the answer, then the reason:** "Good — storms likely after 2 pm."
- **Terms list:** beach day, best hours, offshore waves, feels like, rip-current risk, beach flags, forecast, Approve, Reject, proposal, deploy, Sign In, Sign Out, Create Account, Confirm it's you, approvals used, next slot. Don't mix in synonyms ("surf" vs "waves", "accept" vs "approve", "log in" vs "sign in", "register" vs "create account").
- **Case:** buttons and tab labels in Title Case; everything else (verdicts, reasons, errors, status) in sentence case.
- **No "we", "oops" or blame.** Errors say what happened, what still works, and what to do next: "Couldn't load waves. Showing weather only."
- **Units:** "84 °F", "12 mph", "3 ft". Screen readers get the words: "84 degrees Fahrenheit".
- **The safety line is fixed text, never shortened:** "Beach Day is not a safety service — check NWS rip-current risk and posted beach flags." The link text is "NWS rip-current risk" (descriptive, not "click here").
- **Account copy never reveals whether an email has an account:** sign-in failures say "Email or password didn't match", reset says "If an account uses {email}, a reset link is on its way." Never say which of the two was wrong.
- **Name the method** on auth buttons (HIG Managing accounts). "Sign In" in the UI; "log in" is an engineering word and doesn't appear on screen.
- **No-access copy** says the account can't use the Console and who to ask ("the project lead"), not a person's name and not a role name.
- Copy changes to verdicts or reasons need open-meteo-integrator review (agent rules). `examples/02-copy-deck` holds the deck and a length and readability checker.
