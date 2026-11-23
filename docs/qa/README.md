# QA log (Tess)

Run log for the Beach Day v1 build. Numbers here are copied from runs; anything not run says "not run". The release gate is `docs/06-testing-accessibility.md` §7.

## How to run (from the repo root)

| What | Command |
|---|---|
| All Vitest (unit, contracts, static, functions incl. matrix, db, helpers, harness) | `npm test` |
| Date-sensitive files under other zones | `TZ=UTC npx vitest run tests/static tests/unit/forecast.test.mjs tests/unit/beach-window.test.mjs tests/unit/cache-age.test.mjs tests/unit/score.test.mjs tests/unit/limits.test.mjs`, and the same with `TZ=Pacific/Auckland` |
| Matrix only | `npx vitest run tests/functions/matrix.test.mjs tests/functions/matrix-selftest.test.mjs` (add `MATRIX_STRICT=1` to fail on a missing handler file) |
| Phone e2e + axe + screenshots | `npx playwright test --project=pixel --project=iphone-chromium --trace off` |
| Offline / service worker | `npx playwright test --project=offline-sw --trace off` |
| One spec | `npx playwright test tests/e2e/approve.spec.mjs --project=pixel --trace off` |
| Harness by hand | `PORT=4190 node tests/harness/server.mjs` (port 4173 belongs to `npx playwright test`) |

`iphone-chromium` is Chromium with the iPhone 15 viewport and user agent. It is not Safari. WebKit is not installed here: "iphone (webkit): not run".

## Spec inventory

| Spec | Covers |
|---|---|
| `tests/e2e/beach.spec.mjs` | Picker to Today to Next days to day detail; every verdict state from the derived fixtures; 429, 400, marine-down, offline; 320/390/412 px reflow; 44 px targets; no Supabase or `/api` call from the beach app; CSP clean; dark, reduced motion, forced colours, more contrast |
| `tests/e2e/pages.spec.mjs` | One h1, landmarks, header and footer links on every page; Resources has the repo, mcp-api.netlify.app and /guide/; reflow and targets on the content pages |
| `tests/e2e/offline.spec.mjs` | Real `sw.js` stamped twice by the harness: install, never-cached list, offline start_url, console fails offline, 4 s network-first timeout, update flow (waiting, toast Refresh, one controllerchange, old cache deleted, no mixed window), manifest, 14-day install-hint snooze |
| `tests/e2e/auth.spec.mjs` | Sign in field rules, wrong password, sign up to confirm via token_hash tap, same words for existing and unknown addresses, reset, Google (no popup, code stripped), sign out, localStorage-only session |
| `tests/e2e/gate.spec.mjs` | Signed out, role user, no profile row, super_admin (12 cards), 503 is never no-access, demotion, 401 mid-session, draft kept, Origin denial is not S6 |
| `tests/e2e/chat.spec.mjs` | Scripted SSE through the real handler, aria-busy, XSS as text, refusal, 429 with and without our JSON, budget_exhausted, 401 resend, memory-only draft |
| `tests/e2e/approve.spec.mjs` | Full stack: propose, card, Approve, step-up, commit contents on the fake GitHub, Live, No deploy needed, 409, 502 never resent, cap (5 per day, 14 per 31 days), approve off, URLs never approve, Google step-up |
| `tests/e2e/a11y.spec.mjs` | axe on each screen in light, dark and contrast:more; `incomplete` items attached as annotations |
| `tests/e2e/screens.spec.mjs` | Screenshots into `docs/qa/screenshots/` at deviceScaleFactor 2 |
| `tests/functions/matrix.test.mjs`, `matrix-selftest.test.mjs` | 8 routes x 40 cells against the real handlers, and against stand-ins plus 5 planted-bug guards |
| `tests/static/*.test.mjs` | Pages, no inline script or style, import graph (only approve imports github-write), token names, no secrets in `public/`, copy ids |

## W3 gate run (2026-11-23, commit b828c82 plus spec edits)

| Run | Result |
|---|---|
| `npm test` | 50 files, 1459 passed, 1 skipped, 0 failed |
| `TZ=UTC` and `TZ=Pacific/Auckland` date-sensitive files | 10 files, 338 passed, 1 skipped, in each |
| `--project=pixel --project=iphone-chromium` | 273 passed, 1 failed on the first complete run; the one failure was my spec (Android button on the iOS UA) and is now skipped on that project (6 passed, 1 skipped when re-run). A first attempt lost its harness mid-run (ECONNREFUSED after test 28), cause unknown and not reproduced in two re-runs |
| `a11y.spec` on both projects | 38 passed; 198 axe scans (33 screens x light, dark, contrast:more x 2 projects), 0 violations; 135 `incomplete` items, all `color-contrast` over glass or gradient (66 light, 66 dark, 3 contrast-more), logged in `test-results/axe-incomplete.log` for manual review |
| `--project=offline-sw` | 14 passed |
| Screenshots | 32 PNGs, 5.7 MB (over the 4 MB budget), DPR 2, in `docs/qa/screenshots/` |

Not run: WebKit, real devices, VoiceOver/TalkBack, reduced-transparency emulation, post-deploy smoke, @prod specs, Lighthouse, Supabase pre-launch tests (a)-(i), the CI workflow (D11).
