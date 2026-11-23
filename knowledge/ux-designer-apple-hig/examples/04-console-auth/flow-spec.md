# UX spec: Agent Console accounts (sign up, sign in, sign out, reset, Google, no access, session, step-up, approve cap)
Owner: Wren · Status: example spec, ready to promote to `docs/design/ux-console-auth.md` · Date: 2026-11-23
Follows: ADR-0006 (Supabase Auth; browser talks to Supabase; every function checks Bearer token and `role = super_admin`), ADR-0008 (approve cap), ADR-0003 (Approve = commit to `main`), HIG Managing accounts / Entering data / Sheets / Alerts / Writing, WCAG 3.3.8, 3.3.7, 4.1.3, 2.5.8.
All strings live in `../02-copy-deck/copy-deck.json` (ids in brackets). Mechanism details (what proves "recent", how long it lasts) belong to security-engineer; this spec fixes only what the person sees.

## 0. Principles
- **The beach app never asks for an account.** Accounts exist only for `/console`. HIG "delay sign-in as long as possible" is met by keeping Today and Beaches public.
- **Name the method on the button.** "Sign In", "Continue with Google", "Confirm with Password". No bare "OK" or "Submit". Say "password", never "passcode" (HIG).
- **Never reveal whether an email has an account.** Sign-up, reset and sign-in failures use the same words for known and unknown emails.
- **Never reveal roles.** The no-access screen says the account can't use the Console. It does not say "you are role user".
- **Nothing is lost.** Sign-in return, session expiry and the Google redirect all bring the person back to the same route (`#/console/...`) with the chat draft and the proposal intact.
- One question and one prominent button per screen. 44 px targets. Hash routes. Headings: one `h1` per screen.

## 1. Screens and routes
| Route | Screen | Primary question | Primary action |
|---|---|---|---|
| `#/console` (signed out) | S1 Sign in | "Who are you?" | Sign In |
| `#/console/signup` | S2 Create account | "Which email and password?" | Create Account |
| `#/console/check-email` | S3 Check your email | "Did the link arrive?" | (open the email; Resend Email) |
| `#/console/forgot` | S4 Reset password | "Which email?" | Send Reset Link |
| `#/console/reset` (from email link) | S5 New password | "Which new password?" | Set New Password |
| `#/console` (signed in, 403) | S6 No access | "Why can't I get in?" | Sign Out |
| any (token expired) | S7 Session ended | — | Sign In |
| Approve sheet | S8 Confirm it's you | "Is this really you?" | Approve and Deploy |
| Approve result | S9 Cap reached | "When can I approve?" | Reject, or wait |

## 2. Wireframes (390 px)

### S1 Sign in
```
┌──────────────────────────────────────┐
│ Sign in to the Console               │  h1
│ The Console is for the Beach Day team│  subhead
│ [ Continue with Google ]             │  button, 44px, full width, secondary style
│ ─────────── Or ───────────           │  aria-hidden divider
│ Email                                │  <label for>
│ [ name@example.com            ]      │  type=email autocomplete=username inputmode=email autocapitalize=none spellcheck=false
│ Password                             │
│ [ ••••••••••          ] [Show]       │  type=password autocomplete=current-password; Show = button aria-pressed
│ (inline error, role=alert)           │
│ [ Sign In ]                          │  the one prominent button
│ Forgot Password       Create Account │  two text buttons, 44px tall, 8px+ apart
│ ← Back to Beach Day                  │
└──────────────────────────────────────┘
```
- Google is first because it is the shortest path and needs no password (WCAG 3.3.8 "Alternative"). It uses a style, not size, to stay secondary (HIG buttons).
- **Wrong credentials:** [auth.error.credentials] "Email or password didn't match. Try again." under the form, `role="alert"`; `aria-invalid` is not set on either field, because we don't know which one was wrong. Focus goes to the password field with its text selected.
- **Empty or malformed fields:** checked on submit, then on blur ("dynamically validate"): [auth.error.email.empty], [auth.error.email.format], [auth.error.password.empty]. Each sits under its field, linked by `aria-describedby`, with `aria-invalid="true"`. Focus moves to the first bad field.
- **Email not confirmed:** [auth.error.unconfirmed] and a Resend Email button appears in place of Forgot Password.
- **Too many tries:** [auth.error.throttle]. The limit itself is Supabase's. **[UNVERIFIED]** the exact count; the copy does not state one.
- **Network failure:** [auth.error.network] with Try Again. The typed values stay.
- **Busy:** Sign In becomes "Signing in…", `aria-disabled="true"`, ignores taps.
- Pressing Return in either field submits.

### "Continue with Google" (S1 and S2)
- One tap leaves the page for Google (redirect, no popup, so nothing is blocked). The browser back button returns to S1.
- On return the person lands on the route they started from (stored before the redirect).
- If they cancel at Google or the exchange fails, they land on S1 with [auth.error.google] ("Google sign in didn't finish. Try again or use your email."), `role="alert"`, focus on the Google button.
- A person who signs in with Google and has no Console access sees S6, the same as any other account.
- **Open question for Dr. Lee (not decided here):** if the same email exists as a password account and as a Google account, does Supabase link them or make two? The copy avoids promising either. **[UNVERIFIED]**; see `knowledge/supabase-auth-engineer/docs`.

### S2 Create account
```
┌──────────────────────────────────────┐
│ ‹ Sign in      Create a Console account │  back 44px, h1
│ Use your email or Google.            │  [auth.signup.sub]. Open sign-up: no warning about access
│ [ Continue with Google ]             │
│ ─────────── Or ───────────           │
│ Email   [                    ]       │  autocomplete=email
│ Password [                   ] [Show]│  autocomplete=new-password
│ Use at least {min} characters. A     │  hint (aria-describedby), shown before typing
│ password manager works.              │
│ [ Create Account ]                   │
└──────────────────────────────────────┘
```
- **One password field plus Show Password**, no "confirm password" field. Show/Hide is a real button with `aria-pressed`. This avoids redundant entry (WCAG 3.3.7) and typing errors. **[UNVERIFIED]** this session: WCAG's listed exception for re-entering a new password; we avoid needing it.
- Password rules: minimum length is configured in Supabase (Vera and Cass decide the number; `{min}`). The hint states it up front; the error says how to fix it: [auth.error.password.short]. Leaked-password rejection, if the plan supports it, uses [auth.error.password.leaked]. **[UNVERIFIED]** that leaked-password protection is on (Pro plan and above per Juno's notes).
- Paste and password-manager fill are never blocked.
- After submit, always go to S3, whether or not the email already has an account (no enumeration).

### S3 Check your email (confirmation pending)
```
┌──────────────────────────────────────┐
│ Check your email                     │  h1; focus lands here on arrival
│ A link is on its way to              │
│ name@example.com. Open it to finish. │
│ No email? Check spam, or resend it.  │
│ [ Resend Email ]                     │  disabled with reason for a cooldown
│ Use Another Email                    │  text button, back to S2 with email kept
└──────────────────────────────────────┘
```
- Resend: after tapping, status [auth.confirm.resent] ("Sent again to …", `role="status"`). The button then shows [auth.confirm.wait] "You can resend in 30 seconds." as static text that updates only at the start and the end, not every second (don't make screen readers chatty). The cooldown length is a Supabase setting. **[UNVERIFIED]**.
- **The link opens on another device or browser:** it lands on S1 with status [auth.confirm.done] "Email confirmed. Sign in to continue." This works no matter where the link is opened.
- **Expired or used link:** S3 with [auth.confirm.expired] "That link has expired. Send a new one." and Resend Email.
- The person can close the tab and come back. S3 has no timer.

### S4 Forgot password → S5 New password
```
S4                                       S5
│ ‹ Sign in   Reset your password │     │ Choose a new password          │
│ Enter your email. A link to set │     │ Password [          ] [Show]   │
│ a new password will follow.     │     │ Use at least {min} characters. │
│ Email [                  ]      │     │ [ Set New Password ]           │
│ [ Send Reset Link ]             │
```
- After S4 submit, always show [auth.forgot.sent] "If an account uses {email}, a reset link is on its way." as `role="status"` on the same screen, with Back to Sign In. Same words whether or not the account exists.
- S5 success: the person is signed in (Supabase recovery session). Status [auth.reset.done] "Password changed. You're signed in." then go to `#/console`. If they open the Agents page without access, S6 follows there.
- Expired link: [auth.reset.expired] and Send Reset Link.
- A Google-only account that asks for a reset gets the same S4 message. We don't say "this account uses Google" because that would reveal that the account exists.

### Sign out
- A "Sign Out" button in the Console top bar menu and on S6. **No confirmation dialog**: signing out is common and recoverable (HIG: no alert for common actions).
- Scope is this device only. Result: S1 with status [auth.signout.done] "Signed out of the Console.", focus on the h1.
- Unsent chat text is kept in memory only until the page closes; it is not written to storage (it could contain sensitive text). **[UNVERIFIED]** whether Remy keeps any draft; the S7 copy "Your draft and proposal are saved" is only shown if drafts are kept in memory for that session. Remy decides.

### S6 No access (a 403 from `/api/agents`)
Sign-up is open (Dr. Lee, 2026-11-23): anyone can create an account and use Beach Day. Only the Agents page, chat and Approve say no access, and only S6 says it. Sign-up, sign-in and reset never hint at it, and S6 appears only when the person opens an Agents route.
```
┌──────────────────────────────────────┐
│ This account can't use the Console   │  h1
│ Signed in as name@example.com. Ask   │
│ the project lead to turn on access.  │
│ Signed in with a different account?  │
│ Sign out and try again.              │
│ [ Sign Out ]            (prominent)  │
│ Back to Beach Day                    │
└──────────────────────────────────────┘
```
- Triggered only by `403`. A `401` is S7. A `503` (access check could not run) is **not** "no access": it shows [console.check.failed] "Couldn't check your access. Try again in a minute." with Try Again. Never tell someone they have no access when the check simply failed.
- Not an alert dialog (nothing to decide, and HIG says avoid alerts for information); it is a screen. Focus goes to the h1; the h1 text is announced on arrival.
- The page does not mention roles, the allow-list, agents or what the Console does. The browser makes no further Console calls from this screen.
- The email shown is the one the person signed in with, so they can spot a wrong account.

### S7 Session ended
- Trigger: any `401`, or a failed token refresh.
- The current page is replaced by S1 with status [console.session.expired] "Your session ended. Sign in to pick up where you left off." (`role="status"`, h1 focused). After sign-in the person returns to the route they were on.
- Mid-Approve: the approval did not happen. The proposal stays `pending`. After sign-in they return to the proposal card, not the sheet; they open the sheet again.

### S8 Confirm it's you (step-up before Approve, in the confirm sheet)
Mechanism (security-engineer, docs/04 §4.2): the server accepts a password or Google sign-in no more than **10 minutes (600 s)** old; `{minutes}` = 10. Password users re-sign in inside the sheet. Google users leave for Google and return, and **nothing approves automatically**: the person must choose Approve and Deploy again. A `401 step_up_required` reopens this sheet. **[UNVERIFIED]** whether Google forces a fresh login (Vera's pre-launch tests a-e); until they pass, Approve stays disabled (see S10).
```
┌──────────────────────────────────────┐
│ (Cancel)                             │
│ Approve and deploy this change?      │  title names the task
│ This commits to main and deploys to  │
│ production. It uses 15 of 300        │
│ monthly credits.                     │
│ • One commit to main: "…"            │
│ • Netlify deploys it in a few minutes│
│ • To undo, make a revert commit…     │
│ 9 of 14 approvals used in the last   │
│ 31 days.                             │  [console.cap.usage], only if the server supplies it
│ ┌ Confirm it's you ─────────────────┐│  fieldset + legend
│ │ Password [••••••••]               ││  only if the account has a password
│ │ Type your password to approve.    ││
│ │ ───────────── Or ──────────────   ││
│ │ [ Confirm with Google ]           ││  only if the account has Google
│ └───────────────────────────────────┘│
│                [ Approve and Deploy ]│  prominent, not auto-focused
└──────────────────────────────────────┘
```
- **Password path:** typing the password and pressing Approve and Deploy signs in again (the client calls `signInWithPassword`), then sends Approve with the new token. One sheet, one tap. While it runs the button reads "Committing…". Same field rules as sign-in: paste, password managers, no CAPTCHA, never prefilled.
- **Google path:** the line [console.stepup.google.note] "After Google, you'll return here. Choose Approve and Deploy again." sits under the button, so nobody expects the redirect to approve. The page leaves for Google (no popup) and returns to the same proposal with the sheet reopened. Status [console.stepup.done] "Confirmed. Nothing is approved yet. Choose Approve and Deploy within 10 minutes." and focus on Approve and Deploy. One more tap approves. No URL parameter ever approves. Copy never says "click" (tap and choose work on phone and desktop).
- **`401 step_up_required`** (the 10 minutes ran out, or the server disagreed): the sheet reopens or stays open, back to unconfirmed, with [console.stepup.required] "Confirm it's you to approve. Your last sign-in was over 10 minutes ago." (`role="status"`). The proposal stays pending. Focus goes to the password field, or the Google button for a Google-only account. This is not S7: the session is fine; only the fresh proof is missing.
- **Google-only account:** no password field and no "Or". Only the Google button.
- **Password-only account:** no Google button and no "Or".
- **Wrong password:** [console.error.password], inline, `role="alert"`, `aria-invalid`, focus stays in the field. Throttled: [console.error.throttle].
- **Confirmation timed out** (they waited past {minutes}): the sheet goes back to unconfirmed with [console.stepup.expired] "Time ran out. Confirm it's you again.", `role="status"`.
- Approve and Deploy never submits without a confirmation (client check; the server re-checks).

### S9 Approve cap reached (ADR-0008, `429 approve_cap`)
```
┌──────────────────────────────────────┐
│ ⚠ 14 of 14 approvals used in the last│  role="alert"
│ 31 days. Next slot frees Dec 4.      │
│ The proposal is still waiting.       │
│ ( Reject )                           │  Review and Approve is hidden until retryAt
└──────────────────────────────────────┘
```
- Month limit: [console.cap.month] "{used} of 14 approvals used in the last 31 days. Next slot frees {date}." `{date}` comes from `retryAt`, written as "Dec 4" in America/New_York (the cap's day boundary). Same-year dates omit the year.
- Day limit: [console.cap.day] "5 of 5 approvals used today. More open up at midnight Eastern."
- Then always [console.cap.waiting] "The proposal is still waiting." (it stays `pending`). Review and Approve is hidden, not disabled with a mystery, because there is nothing the person can do until the date; Reject stays. When `retryAt` passes, the button returns on the next load.
- Why the numbers: the cap protects the Netlify credit budget (ADR-0004), shared by everyone with access. The screen shows the counts and the date, but does not explain credits; the confirm sheet does.
- The usage line [console.cap.usage] on the sheet needs the server to return counts before Approve. **Needs: agent-console-engineer / software-architect** (see HANDOFF). Without it, people only learn at 429.
- A failed, stale or rejected proposal never uses a slot (ADR-0008), so the copy never says "used" for those.

### S10 Approve is off (pre-launch tests not passed)
```
┌──────────────────────────────────────┐
│ Update UV wording                    │
│ [ Review and Approve ]  aria-disabled│  stays visible, 44px, dimmed, focusable
│ Approve is off until the launch      │  [console.approve.disabled], always visible text,
│ checks pass. You can still read and  │  linked by aria-describedby
│ reject.                              │
│ [ Reject ]                           │
└──────────────────────────────────────┘
```
- It is a temporary system state with one cause, so the button is shown with the reason, not hidden (unlike the cap, where nothing can be done until a date). The reason is plain text under the button, not a tooltip.
- `aria-disabled="true"`, not the `disabled` attribute, so keyboard and screen-reader users can reach it and hear why. Activating it does nothing and opens no sheet. Reject, the diff and chat all work.
- Not color-only: dimmed plus the sentence. Needs the server to say so in the proposal payload (`approveEnabled: false`). **Needs: agent-console-engineer** (see HANDOFF).

### S11 Console usage limit (`429 budget_exhausted`)
- The site-wide compute budget is spent (180 function-minutes per rolling 31 days at the time of writing; Vera says the number may change, so no number appears on screen). It is shared by everyone, like the Approve cap.
- Chat: the composer's alert [console.error.budget] "The Console has hit its usage limit for now. Chat and jobs resume {date}." (`role="alert"`). `{date}` is the day enough budget frees, in America/New_York, like the cap. If the server gives no date, use [console.error.budget.nodate] "The Console has hit its usage limit for now. Try again later."
- The unsent draft stays in the composer, focus stays there, Send is `aria-disabled` with the message as its description. Reading proposals, Reject and the beach app are unaffected.
- Different from S9: S9 is about Approve slots, S11 about chat and jobs. Never reuse one message for the other. **[UNVERIFIED]** whether Approve itself counts against compute; the copy doesn't promise either.

### Outcome copy: committed and live
| Outcome | Copy | Region |
|---|---|---|
| Committing | "Committing to main…" | status |
| Committed, deploy runs | "Committed {sha}. Deploying…" | status |
| **Committed, no deploy needed** | "Committed {sha}. No deploy needed." then, below, "Only docs or agent files changed, so the site stays as it is." | status |
| **Live** | "Live. The change is on the site." + "View commit {sha}" | status |

- "No deploy needed" appears when the commit touches only paths that Netlify's ignore rule skips (Nell's rule in docs/03). The confirm sheet says it **before** Approve: [console.consequence.nodeploy] "This commits to main. The live site doesn't change, so no deploy runs." (the "15 of 300 credits" line is dropped, because no credits are used).
- "No deploy needed" is a finished state: no "Live" step follows. An approval that skips the deploy still uses one of the 14 slots (ADR-0008, point 4). **Needs: Remy** to decide whether the UI should say so.
- If the rule can't tell in advance (path list unknown), show the deploy wording; it is the safe one.

## 3. State matrix (auth)
| State | Trigger | What shows | Announced | Focus |
|---|---|---|---|---|
| Signed out | no session | S1 | h1 on route change | h1 |
| Signing in | submit | button "Signing in…", `aria-disabled` | — | stays on button |
| Bad credentials | Supabase 400 | S1 + inline error | `role="alert"` | password field |
| Needs confirmation | unconfirmed email | S1 + [auth.error.unconfirmed] | alert | Resend Email |
| Confirmation pending | after sign-up | S3 | h1 | h1 |
| Reset sent | S4 submit | [auth.forgot.sent] | `role="status"` | stays |
| Throttled | 429 from Supabase | [auth.error.throttle] | alert | field |
| Offline | no network | [auth.error.network] + Try Again | alert | Try Again |
| Signed in, checking | first call to `/api/agents` | skeleton + "Checking your access…" | status | — |
| No access | 403 | S6 | h1 | h1 |
| Access check failed | 503 | [console.check.failed] + Try Again | alert | Try Again |
| Session ended | 401 | S1 + [console.session.expired] | status | h1 |
| Step-up needed | Approve sheet opens | S8 | — | password field, or Google button if Google-only |
| Cap reached | 429 `approve_cap` | S9 | alert | the alert text region |
| Step-up required | 401 `step_up_required` | S8 + [console.stepup.required] | status | password field, or Google button |
| Usage limit | 429 `budget_exhausted` | S11 | alert | composer |
| Approve off | pre-launch tests pending | S10 | text under button | Review and Approve (reachable) |

"Checking your access…" is written as a specific task, not "Loading" or "Authenticating" (HIG Progress indicators); it is in the copy deck as `console.checking`.

## 4. Accessibility checklist
- [ ] Every input has a visible `<label>`; hints and errors linked with `aria-describedby`; `aria-invalid` only when the field itself is wrong.
- [ ] `autocomplete`: `username` (sign-in email), `email` (sign-up), `current-password`, `new-password`. No `autocomplete="off"`, no paste blocking, no `readonly` tricks, no CAPTCHA, no puzzle, no security question (WCAG 3.3.8).
- [ ] Show Password is a button with `aria-pressed`; the field keeps its name.
- [ ] Google and Confirm-with-Google are real `<button>`s. No iframe-only widget. They are reachable by keyboard and have visible text.
- [ ] Errors: field errors by the field; form-level failures `role="alert"`; success and waiting states `role="status"` (4.1.3). Region exists before text is written.
- [ ] After every route change focus lands on the `h1` (so the new screen is announced once).
- [ ] The step-up sheet is a `<dialog>` opened with `showModal()`; Cancel on the leading edge, Esc closes, focus returns to Review and Approve.
- [ ] All controls ≥ 44 × 44 px; text buttons (Forgot Password, Create Account) have 8 px or more between them.
- [ ] 320 px wide and 200% text: buttons wrap, the Show button moves under the field.
- [ ] Verdict-free screens: nothing here depends on color alone. Errors have text, and the icon is `aria-hidden`.

## 5. Friction found (desk walk-through, iPhone 390 px and Pixel 412 px)
1. Google redirect would drop the open Approve sheet. **Fix:** return to the same proposal with the sheet reopened and "Confirmed".
2. Stating "no access" on a 503 would send a real super_admin to the wrong person. **Fix:** 403 and 503 are separate screens.
3. A sign-up that says "email already used" reveals who has an account. **Fix:** S3 for all.
4. A confirm-password field doubles typing on a phone. **Fix:** one field plus Show Password.
5. New accounts reach "no access" when they open Agents. Dr. Lee keeps sign-up open, so S2 says nothing about it and the message lives only on the Agents page (S6), where it says what to do.
6. The cap message at the moment of failure gives a person no action. **Fix:** hide Review and Approve, keep Reject, show the date, show the usage count earlier in the sheet.
7. On iPhone, the email confirmation link may open in Safari while the PWA is installed. The person lands on S1 in the other context. **Fix:** S1's status "Email confirmed. Sign in to continue." works anywhere. **[UNVERIFIED]** how Supabase redirect URLs behave in a standalone PWA; Pip and Cass to confirm.
