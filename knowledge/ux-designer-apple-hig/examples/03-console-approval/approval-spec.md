# UX spec: Agent Console approval (proposal card → approve with re-auth → outcome)
Owner: Wren · Status: example spec · Date: 2026-11-23
Follows:
- ADR-0003 (Approve = one atomic commit to `main`, Netlify auto-deploys)
- ADR-0004 (Free plan: 15 credits per production deploy, 300 a month)
- ADR-0005 (fine-grained PAT, server-side allow-list)
- docs/04-agent-console.md §2 (`POST /api/proposals/:id/approve`, session + CSRF + re-auth) and §4 (re-auth within 10 min)
- HIG Sheets, Alerts, Buttons, Feedback, Progress indicators; WCAG 3.3.8, 4.1.3, 2.5.8

## 1. Why this flow is heavier than the rest of the app
Approve ships code to production. It is rare, deliberate and **not undoable in place**: it can only be reverted. The HIG says to warn when an action can cause unexpected, irreversible effects, and to ask for confirmation twice for actions "difficult to recover from". So the flow is review → confirm with consequences + password → outcome. Reject is cheap: one tap, no confirmation.

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
│ Console password                              │  <label for="pw">
│ [••••••••••••          ]                      │  type=password, autocomplete=current-password
│ Type the password again to approve.           │  help text (aria-describedby)
│ (inline error slot, role="alert")             │
│                       [ Approve and Deploy ]  │  trailing, prominent, verb title, not "OK"
└──────────────────────────────────────────────┘
```
- **Opening:** focus goes to the password field, the only input the task needs. **Cancel**, **Esc** or a backdrop tap closes it with no side effects, and focus returns to "Review and Approve".
- **Re-auth:**
  - The password is never prefilled (HIG Entering data).
  - Paste and password managers work (WCAG 3.3.8): `autocomplete="current-password"` and no paste blocking.
  - No CAPTCHA.
  - The label says "password", never "passcode" (HIG Managing accounts).
- **Wrong password:** "That password didn't match. Try again." appears under the field (`role="alert"`) with `aria-invalid="true"`. Focus stays in the field with the text selected. The 5-per-15-min login throttle applies; after the limit the error is "Too many tries. Wait 15 minutes, then try again." **[UNVERIFIED]** that this exact limit is shared between login and re-auth; it's a design decision for agent-console-engineer and security-engineer.
- **Approve and Deploy** is prominent but not auto-focused, and Enter only submits from inside the field after the user has typed. No default-button accident.
- **Double submit:** the button becomes "Committing…" with `aria-disabled="true"` and ignores further clicks. The server also refuses with a CAS status lock.

## 4. Outcomes (on the card, after the sheet closes)
| Outcome | Server result | Visible + announced | Region | Next action |
|---|---|---|---|---|
| In progress | request sent | "Committing to main…" | status | none (can't cancel: the commit may already exist) |
| Committed | 200 + commit SHA | "Committed abc1234. Deploying…" (SHA links to GitHub) | status | — |
| Live | deploy-succeeded / poll | "Live. The change is on the site." + "View commit abc1234" | status | — |
| Stale base | 409 (main moved) | "Main changed since this proposal. Ask the agent to redo it." | alert | Ask agent (chat) |
| Path not allowed | 403 from the allow-list re-check | "This proposal edits a file agents can't change. Nothing was committed." | alert | — |
| Commit failed | 5xx / GitHub error | "The commit failed. Nothing was deployed. Try again in a minute." | alert | **Try Again** (focused) |
| Session expired | 401 | Back to the login screen with "Sign in again to approve." The proposal is kept. | alert | Sign In with Password |
| Rejected | reject endpoint | "Rejected. Nothing was changed." | status | — |

- One persistent `role="status"` region per card, present before any text is written (ARIA22). A separate `role="alert"` region is used only for failures (ARIA19).
- Progress shows real steps, not a fake percentage (HIG Progress indicators: be accurate; avoid vague "Loading").
- Success is confirmed because the action is significant (HIG Feedback). Every failure says what did *not* happen ("Nothing was deployed").

## 5. Security-relevant UX (for security-engineer review)
- The confirm sheet shows the **base SHA and content hash** the server will re-validate, so what the human saw is what gets committed.
- No preview deploy exists in this flow (ADR-0003), so the consequence line says "production" plainly.
- Re-auth happens in the sheet and not in a new window or page, so there is nothing to phish in a separate context.
- The password is never echoed, logged or kept in JS state after submit.

## 6. Prototype and checks
`prototype.html` implements sections 2–4 with a mocked server (`?outcome=ok|stale|fail`; demo password `demo-password`). It makes no network calls. `axe-check.mjs` drives it through every state in light and dark and runs axe with WCAG 2.0/2.1/2.2 A and AA tags. It also asserts:
- focus moves to the field on open and returns on Cancel or Esc
- `aria-invalid` is set on a wrong password
- paste isn't blocked and autocomplete is `current-password`
- all controls are ≥ 44 px
- the status and alert text is right
- Try Again is focused after a failure
