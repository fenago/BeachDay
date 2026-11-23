# UX spec: Agent Console approval (proposal card → approve with re-auth → outcome)
Owner: Wren · Status: example spec · Date: 2026-11-23
Follows:
- ADR-0003 (Approve = one atomic commit to `main`, Netlify auto-deploys)
- ADR-0004 (Free plan: 15 credits per production deploy, 300 a month)
- ADR-0005 (fine-grained PAT, server-side allow-list)
- ADR-0006 (Supabase Auth: Bearer token + `super_admin` on every call) and ADR-0008 (approve cap)
- docs/04-agent-console.md §2 (`POST /api/proposals/:id/approve`, Bearer + role + step-up) and §4 (step-up; mechanism and window are security-engineer's)
- `../04-console-auth/flow-spec.md` for sign-in, no-access and session screens
- HIG Sheets, Alerts, Buttons, Feedback, Progress indicators; WCAG 3.3.8, 4.1.3, 2.5.8

## 1. Why this flow is heavier than the rest of the app
Approve ships code to production. It is rare, deliberate and **not undoable in place**: it can only be reverted. The HIG says to warn when an action can cause unexpected, irreversible effects, and to ask for confirmation twice for actions "difficult to recover from". So the flow is review → confirm with consequences + "Confirm it's you" → outcome. Reject is cheap: one tap, no confirmation.

## 2. Proposal card (in the chat log, `role="log"`)
```
┌──────────────────────────────────────────────┐
│ Proposal: Update UV wording                   │  h2; accessible name of the card
│ From Wren · 1 file · 2 lines changed          │
│ base 9f3c2e1 · hash sha256:5d1a…c07e          │  what the server will re-check
│ Makes the very-high UV advice shorter…        │  agent's one-line summary
│ public/js/copy.js              ✓ Allowed path │  per-file allow-list result (text, not color)
│ ▸ Show diff for public/js/copy.js             │  <details>; diff lines start with − / +
│ [ Review and Approve ]  ( Reject )            │  one prominent button; 44px
│ (status line, role="status")                  │
└──────────────────────────────────────────────┘
```
- A disallowed path shows "✕ Not allowed: netlify.toml", and **Review and Approve is not offered**. The status reads "This proposal edits a file agents can't change. Nothing was committed." The server enforces this anyway (ADR-0005). The UI just doesn't invite a doomed action.
- The diff `<pre>` scrolls horizontally, so it is `tabindex="0"` with `role="region"` and a label. axe flagged this (`scrollable-region-focusable`) in the first run.
- The diff uses `+`/`−` markers as well as green and red backgrounds (WCAG 1.4.1).

## 3. Confirm sheet (modal `<dialog>`, large detent)
```
┌──────────────────────────────────────────────┐
│ (Cancel)                                      │  leading edge, HIG Sheets
│ Approve and deploy this change?               │  title names the task
│ This commits to main and deploys to           │
│ production. It uses 15 of 300 monthly credits.│  consequence, from copy deck
│ • One commit to main: "Update UV wording…"    │
│ • Netlify deploys it in a few minutes.        │
│ • To undo, make a revert commit or roll back. │
│ 9 of 14 approvals used in the last 31 days.   │  only if the server supplies the count
│ ┌ Confirm it's you ───────────────────────┐   │  fieldset + legend
│ │ Password [••••••••••]                   │   │  only if the account has a password
│ │ Type your password to approve.          │   │
│ │ ─────────────── Or ───────────────      │   │
│ │ [ Confirm with Google ]                 │   │  only if the account has Google
│ └─────────────────────────────────────────┘   │
│ (inline error slot, role="alert")             │
│                       [ Approve and Deploy ]  │  trailing, prominent, verb title, not "OK"
└──────────────────────────────────────────────┘
```
- **Opening:** focus goes to the password field (or to the Google button if the account has no password). Those are the only inputs the task needs. **Cancel**, **Esc** or a backdrop tap closes it with no side effects, and focus returns to "Review and Approve".
- **Step-up ("Confirm it's you"):** two paths, and either one counts. The mechanism and the window (`{minutes}`) are security-engineer's decision (docs/04 §4); this spec only fixes what the person sees. Decision (docs/04 §4.2): a password or Google sign-in no more than 10 minutes old, so `{minutes}` = 10.
  - **Password path:** typing it and pressing Approve and Deploy re-signs in, then approves, in one tap. Never prefilled (HIG Entering data). Paste and password managers work (WCAG 3.3.8): `autocomplete="current-password"`, no paste blocking, no CAPTCHA. The label says "password", never "passcode" (HIG Managing accounts).
  - **Google path:** under the button: "After Google, you'll return here. Choose Approve and Deploy again." It leaves the page (redirect) and returns to the same proposal with the sheet reopened and "Confirmed. Nothing is approved yet. Choose Approve and Deploy within 10 minutes." Focus lands on Approve and Deploy. A second tap approves. Nothing approves automatically, and no URL parameter approves.
  - A Google-only account sees only the Google button; a password-only account sees only the password field. No "Or" is shown when there is one path.
  - Timed out: "Time ran out. Confirm it's you again." (status).
  - Server says `401 step_up_required`: the sheet reopens unconfirmed with "Confirm it's you to approve. Your last sign-in was over 10 minutes ago." (status); the proposal stays pending.
- **Wrong password:** "That password didn't match. Try again." appears under the field (`role="alert"`) with `aria-invalid="true"`. Focus stays in the field with the text selected. After too many wrong tries the error is "Too many tries. Wait a minute, then try again." The real limit comes from Supabase and the Approve function. **[UNVERIFIED]** the count; the copy states none.
- **Approve and Deploy** is prominent but not auto-focused, and Enter only submits from inside the field after the user has typed. No default-button accident.
- **Double submit:** the button becomes "Committing…" with `aria-disabled="true"` and ignores further clicks. The server also refuses with a CAS status lock.

## 4. Outcomes (on the card, after the sheet closes)
| Outcome | Server result | Visible + announced | Region | Next action |
|---|---|---|---|---|
| In progress | request sent | "Committing to main…" | status | none (can't cancel: the commit may already exist) |
| Committed | 200 + commit SHA | "Committed abc1234. Deploying…" (SHA links to GitHub) | status | — |
| **Committed, no deploy needed** | 200 + SHA, and the paths are all ones Netlify's ignore rule skips | "Committed abc1234. No deploy needed." + "Only docs or agent files changed, so the site stays as it is." The sheet said so before Approve: "This commits to main. The live site doesn't change, so no deploy runs." | status | — |
| Live | Console polls `/version.json` until the new build shows | "Live. The change is on the site." + "View commit abc1234" | status | — |
| **Cap reached** | 429 `approve_cap` (ADR-0008) | "14 of 14 approvals used in the last 31 days. Next slot frees Dec 4." (or "5 of 5 approvals used today. More open up at midnight Eastern.") + "The proposal is still waiting." | alert | Reject; Review and Approve hidden until `retryAt` |
| **Confirm needed** | 401 `step_up_required` | Sheet reopens: "Confirm it's you to approve. Your last sign-in was over 10 minutes ago." | status | Password field or Google button |
| **Usage limit** | 429 `budget_exhausted` (chat/jobs) | "The Console has hit its usage limit for now. Chat and jobs resume {date}." | alert | Composer (draft kept) |
| **Approve off** | pre-launch tests not passed | "Approve is off until the launch checks pass. You can still read and reject." under a dimmed, `aria-disabled` Review and Approve | text (describedby) | Reject |
| Stale base | 409 (main moved) | "Main changed since this proposal. Ask the agent to redo it." | alert | Ask agent (chat) |
| Path not allowed | 422/403 from the allow-list re-check | "This proposal edits a file agents can't change. Nothing was committed." | alert | — |
| Commit failed | 5xx / GitHub error | "The commit failed. Nothing was deployed. Try again in a minute." | alert | **Try Again** (focused) |
| Session ended | 401 | Back to sign in with "Your session ended. Sign in to pick up where you left off." The proposal stays pending and the person returns to it. | status (alert inside the Approve flow) | Sign In |
| No access | 403 (not `super_admin`) | The no-access screen, see `../04-console-auth/flow-spec.md` S6 | h1 | Sign Out |
| Rejected | reject endpoint | "Rejected. Nothing was changed." | status | — |

- One persistent `role="status"` region per card, present before any text is written (ARIA22). A separate `role="alert"` region is used only for failures (ARIA19).
- Progress shows real steps, not a fake percentage (HIG Progress indicators: be accurate; avoid vague "Loading").
- Success is confirmed because the action is significant (HIG Feedback). Every failure says what did *not* happen ("Nothing was deployed").

## 5. Security-relevant UX (for security-engineer review)
- The confirm sheet shows the **base SHA and content hash** the server will re-validate, so what the human saw is what gets committed.
- No preview deploy exists in this flow (ADR-0003), so the consequence line says "production" plainly.
- Re-auth happens in the sheet and not in a new window or page, so there is nothing to phish in a separate context.
- The password is never echoed, logged or kept in JS state after submit.
- The cap check happens after auth, role and step-up (ADR-0008), so someone who isn't confirmed never learns the usage numbers.

## 6. Prototype and checks
`prototype.html` implements sections 2–4 with a mocked server (`?outcome=ok|stale|fail`; demo password `demo-password`). It makes no network calls. `axe-check.mjs` drives it through every state in light and dark and runs axe with WCAG 2.0/2.1/2.2 A and AA tags. It also asserts:
- focus moves to the field on open (or the Google button for `?account=google`) and returns on Cancel or Esc
- `aria-invalid` is set on a wrong password
- paste isn't blocked and autocomplete is `current-password`
- all controls are ≥ 44 px
- the status and alert text is right
- Try Again is focused after a failure
