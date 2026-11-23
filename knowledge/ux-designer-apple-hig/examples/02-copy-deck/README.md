# Example 02: verdict and reason copy deck, with a checker

## What it demonstrates
[`copy-deck.json`](copy-deck.json) is the single source for user-facing strings. It covers:
- the safety line, verbatim
- verdict labels (from the beach-day-scoring skill bands) and their icons
- reasons for each scoring factor and the advice lines
- status messages, errors and the empty state
- buttons
- Agent Console strings: consequences, re-auth, the commit lifecycle and failures

[`check-copy.mjs`](check-copy.mjs), with no dependencies, enforces:
- **Length limits** per element: verdict 24, reason 36, advice 60, status 60, error 90, button 22. These keep the chip and row on one line at 320 px.
- **Banned words**, from the HIG Writing page: "we", "our", "oops", "uh-oh", "click", plus "sorry", "invalid", "error" and "loading". Apple calls "loading" vague in Progress indicators and "Invalid name" robotic in Writing.
- **Capitalization:** buttons in Title Case with no end punctuation and ≤ 4 words (HIG Alerts and Buttons); everything else in sentence case, allowing for proper nouns and acronyms.
- **Exact safety line** (CLAUDE.md / ADR-0002), with the link text inside it.
- **Flesch Reading Ease ≥ 60** for strings with 5 or more words. Shorter fragments are reported but not gated, since the formula is meaningless for "Thunderstorms".
- **Cross-check:** every quoted string in the "Status text" column of `../01-flow-beach-verdict/flow-spec.md` must match a deck template. This keeps the spec and the deck in sync.

Why it's "what good looks like": the copy rules are executable, not just a style guide. The checker caught real problems: two advice lines too long, five strings too hard to read, and a spec that had drifted from the deck.

## How to run
```bash
node check-copy.mjs     # exit 1 on any problem
```

## Verified
**First run** (after fixing two parser bugs in the cross-check), 2026-11-23. Saved output, trimmed:
```
FAIL (7)
- advice.uv.veryhigh: length 62 > 60
- advice.lightning: length 71 > 60
- status.stale: Flesch 52 < 60
- status.after.hours: Flesch 58 < 60
- error.offline.nocache: Flesch 58 < 60
- console.reauth: Flesch 43 < 60
- console.status.ready: Flesch 49 < 60
```
**Second run:** the rewrites passed the deck but the cross-check failed. `flow-spec.md` still used the old stale, offline and after-hours wording, so I updated the spec. One string (`console.reauth`, Flesch 55) needed another pass.

**Final run:**
```
$ node check-copy.mjs
...
console  console.reauth               35/90    74      ok    Type the password again to approve.
console  console.status.ready         39/90    95      ok    New change ready. Check the diff below.
65 strings, 10 flow-spec status strings cross-checked
Flesch (strings with words): min -48, mean 72
PASS
```
Exit code 0.

## Limits and follow-ups
- The syllable counter is a heuristic, and Flesch was designed for prose. Use it as a nudge, not a judge. Apple's HIG gives no numeric reading level.
- Placeholders like `{time}` are dropped before scoring and expanded to `.+` for the spec cross-check.
- Verdict and reason wording changes need open-meteo-integrator review before they go into `public/js/score-config.js`.
- The apple-hig and accessibility skills still say "Proposal ready". If this deck is adopted, the skills should be updated through agent-builder.
