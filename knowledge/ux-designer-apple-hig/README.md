# Wren (ux-designer-apple-hig): knowledge index
Date: 2026-11-23

Reference notes from Apple's Human Interface Guidelines (read from Apple's DocC JSON for each HIG page) and W3C WCAG 2.2 Understanding docs, plus worked examples that were run. Every docs file lists its sources, marks unconfirmed facts **[UNVERIFIED]**, and ends with "Beach Day notes".

## docs/
| File | Covers | Read when |
|---|---|---|
| [docs/01-ios-foundations-and-navigation.md](docs/01-ios-foundations-and-navigation.md) | Designing for iOS, tab bars (Liquid Glass era), lists and tables, layout and state restoration; Beach Day IA table | Designing screens, navigation, the tab bar or lists |
| [docs/02-sheets-alerts-modality.md](docs/02-sheets-alerts-modality.md) | Sheets (Cancel leading / Done trailing, detents, grabber), alerts ("avoid OK", no alert at launch), modality | Any sheet, dialog, confirmation or error interruption |
| [docs/03-buttons-input-and-auth.md](docs/03-buttons-input-and-auth.md) | Buttons (44 pt, roles, prominent style), entering data, managing accounts; WCAG 2.5.8 and 3.3.8 | Buttons, forms, the Console login and re-auth |
| [docs/04-feedback-loading-launch-onboarding.md](docs/04-feedback-loading-launch-onboarding.md) | Feedback, loading, progress indicators, launching, onboarding, notifications | Loading, offline and progress states; first launch; install hints |
| [docs/05-writing.md](docs/05-writing.md) | HIG Writing best practices (no "we", no "oops", "tap" not "click", empty states, errors), alert and button copy rules | Writing or reviewing any user-facing text |
| [docs/06-accessibility-targets-status.md](docs/06-accessibility-targets-status.md) | HIG Accessibility (sizes, gestures, time-boxing, confirm twice), WCAG 2.5.8 and 4.1.3 with techniques ARIA22/19/23 and G199 | Deciding live regions, target sizes, gesture alternatives |

## examples/
| Folder | Shows | Status |
|---|---|---|
| [examples/01-flow-beach-verdict/](examples/01-flow-beach-verdict/) | Full flow spec for pick a beach → today's verdict → day detail, with text wireframes and a state matrix (loading, partial, error, offline, stale, too old, empty, outlook, after hours) | Spec. Its status strings are machine-checked by example 02 |
| [examples/02-copy-deck/](examples/02-copy-deck/) | `copy-deck.json` (verdicts, reasons, advice, status, errors, buttons, Console, the exact safety line) + `check-copy.mjs` (lengths, banned words, case, Flesch ≥ 60, spec cross-check) | Ran: 7 failures → copy rewritten → PASS |
| [examples/03-console-approval/](examples/03-console-approval/) | Approval flow spec (card, confirm sheet with consequences + password re-auth, outcome table) + accessible HTML prototype (mocked server) + Playwright/axe check of 8 states × 2 schemes | Ran: 6 axe violations → fixed → 0 violations, PASS |

## Key takeaways
1. One question and one prominent action per screen, answer first. No alert at launch; offline and errors show inline over cached data.
2. Every state is designed and worded. Status changes use one persistent `role="status"`, and `role="alert"` is only for blocking failures.
3. Approve is the one heavy flow: consequences in plain words ("production", "15 of 300 credits"), password re-auth that allows paste and autofill, a verb-titled button, and an honest step-by-step outcome.
4. The safety line is fixed text on every verdict screen, with a descriptive link ("NWS rip-current risk").
