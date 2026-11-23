# Example 03: Agent Console approval flow, with spec, prototype and axe check

## What it demonstrates
- [`approval-spec.md`](approval-spec.md) covers:
  - the proposal card: allow-list result per file, a diff with −/+ markers, one prominent action
  - the **confirm sheet**: consequences ("commits to main and deploys to production, 15 of 300 monthly credits") and **password re-auth** that works with paste and password managers (WCAG 3.3.8)
  - the full outcome table: committing, committed, live, stale base (409), path not allowed, commit failed, session expired, rejected, each with its live-region role
- [`prototype.html`](prototype.html): an accessible, dependency-free prototype of that flow. It uses `<dialog>` with `showModal()`, a persistent `role="status"` region and a separate `role="alert"` region for failures. **The server is mocked in the page:** no network calls, no real Console password and no GitHub API. Use `?outcome=ok|stale|fail`; the demo password is `demo-password`.
- [`axe-check.mjs`](axe-check.mjs) drives the prototype with Playwright through 8 states × light/dark and runs `@axe-core/playwright` with tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`. It also asserts what axe can't see:
  - focus goes to the password field on open and returns to the trigger on Cancel or Esc
  - `aria-invalid` is set on a wrong password, and focus stays in the field
  - paste isn't blocked and `autocomplete="current-password"`
  - every control is ≥ 44 px
  - status and alert text is right
  - Try Again is focused after a failure
  - Approve is hidden after commit (no double approve)

Why it's "what good looks like": it matches ADR-0003 (direct atomic commit to `main`, no preview gate, so the copy says "production") and the docs/04 endpoint design (re-auth on approve). It uses HIG conventions: Cancel leading, a verb-titled confirm button, no "OK", consequences stated, and success confirmed for a significant action. Accessibility is tested per state, not just on the initial page.

## How to run
Playwright and Chromium are preinstalled. Install axe **outside the repo** and point `NODE_PATH` at it:
```bash
SCRATCH=/tmp/claude-0/-home-user-BeachDay/95356c24-e7dd-5f3a-9554-34c262890d57/scratchpad/wren
(cd $SCRATCH && npm init -y && npm i --legacy-peer-deps @axe-core/playwright@4.14.0)
NODE_PATH=$SCRATCH/node_modules:$NODE_PATH node axe-check.mjs
```
`--legacy-peer-deps` stops npm from pulling a second `playwright-core`; the preinstalled Playwright is used. `package.json` lists the one dependency for anyone running it in a normal project.

## Verified
Versions: @axe-core/playwright 4.14.0, axe-core 4.14.1, Playwright 1.63.0, Chromium 157.

**First run** (2026-11-23) found a real issue in 6 state/scheme combinations:
```
light/card (diff open)             violations: 1  passes: 24
...
FAIL (6)
- light/card (diff open): scrollable-region-focusable (serious) pre
- light/committing: scrollable-region-focusable (serious) pre
- light/live: scrollable-region-focusable (serious) pre
- dark/card (diff open): scrollable-region-focusable (serious) pre
...
```
**Fix:** the horizontally scrolling diff `<pre>` got `tabindex="0" role="region"` (it already had an `aria-label`), so keyboard users can scroll it.

**Final run:**
```
$ NODE_PATH=$SCRATCH/node_modules:$NODE_PATH node axe-check.mjs
light/card (diff open)             violations: 0  passes: 25
light/confirm sheet                violations: 0  passes: 21
light/confirm sheet + error        violations: 0  passes: 21
light/committing                   violations: 0  passes: 24
light/live                         violations: 0  passes: 25
  status now: "Live. The change is on the site. View commit abc1234"
light/stale base (alert)           violations: 0  passes: 23
light/commit failed                violations: 0  passes: 24
  alert now: "The commit failed. Nothing was deployed. Try again in a minute."
light/rejected                     violations: 0  passes: 23
dark/...                           (same 8 states, 0 violations each)

PASS: 0 axe violations in all states; behavior assertions hold
```
Exit code 0.

## Limits
- axe covers only part of WCAG. Announcement quality (is it too chatty, is "Committing…" read once) needs the manual VoiceOver and TalkBack pass from the accessibility skill.
- The paste test dispatches a synthetic `paste` event and checks no handler cancels it. It doesn't test a real clipboard or password-manager autofill.
- Throttle wording for repeated wrong passwords is a proposal; see **[UNVERIFIED]** in the spec.
