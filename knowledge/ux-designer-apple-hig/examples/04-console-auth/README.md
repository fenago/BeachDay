# Example 04: Console account flows (sign up, sign in, reset, Google, no access, step-up, approve cap)

## What it demonstrates
[`flow-spec.md`](flow-spec.md) is the UX spec for the Supabase Auth Console (ADR-0006):
- sign up, "check your email" (confirmation pending), sign in, sign out, forgot and reset password
- "Continue with Google" by redirect, and what happens when it fails
- the non-`super_admin` **no access** screen (driven by a 403 from `/api/agents`), kept separate from a 503 "couldn't check" and a 401 "session ended"
- the step-up sheet "Confirm it's you" with a password path and a Google path (mechanism left to security-engineer)
- the approve-cap message (ADR-0008) and the outcome copy for "Committed, no deploy needed" and "Live"
- two-step sign in (TOTP): the code step in the Approve sheet and an enrolment screen (QR, text key, first verify); a one-button Confirm Email screen for `token_hash` links; Sign Out Everywhere; 401 branching on `error.code`
- a state matrix, an accessibility checklist (WCAG 3.3.8 accessible authentication, 3.3.7, 4.1.3) and friction found in a desk walk-through

All strings are in `../02-copy-deck/copy-deck.json` (ids named in the spec). The step-up sheet and the outcomes are built in `../03-console-approval/prototype.html`.

## How to run
Not code. Read it. The copy is linted by `../02-copy-deck/check-copy.mjs`; the prototype by `../03-console-approval/axe-check.mjs`.

## Verified
- Copy deck: `node check-copy.mjs` gave `190 strings ... PASS` (wave 3b).
- Prototype: axe 0 violations in 16 states × light/dark (adds the code field, wrong code and 502). The Confirm Email, reset and enrolment screens are spec only, not prototyped.
- **Not verified:** any Supabase behavior (confirmation cooldown, throttle counts, Google re-prompt, redirect inside an installed PWA, account linking). Supabase docs were blocked in this session. Those items are marked **[UNVERIFIED]** in the spec and go to supabase-auth-engineer.
