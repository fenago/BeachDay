# Example 01: flow spec, pick a beach → today's verdict → day detail

## What it demonstrates
[`flow-spec.md`](flow-spec.md) is a complete UX spec in the format Wren writes for `docs/design/ux-*.md`. It contains:
- user steps with the app's response
- text wireframes for picker, loading, Today and day detail
- a **state matrix** covering loading, success, partial (marine down), error, offline with and without cache, stale (3 h), too-old (24 h), empty, outlook and after-hours, each with exact status copy and its ARIA role
- an accessibility checklist
- friction points found by walking the flow on phone-sized profiles

Why it's "what good looks like":
- Every state is designed and worded; none is left for the developer to invent.
- It follows the HIG: answer first, no launch alert, permission asked in context, a button for every gesture, one prominent action.
- It agrees with the ADRs: Open-Meteo is fetched in the browser, rip currents are a link-out with the safety line in every data state, and the attribution is always visible.
- Verdict wording comes from the beach-day-scoring skill.

## How to run
Not code. Read it, or render the Markdown. The copy it uses is checked in `../02-copy-deck`.

## Verified
Not run: this is a design spec, not executable. I checked by hand that:
- every status string in the state matrix appears in `../02-copy-deck/copy-deck.json`
- the safety line text is identical to the one in CLAUDE.md
- the verdict labels match the beach-day-scoring skill table ("Great beach day", "Good", "Fair — pick your hours", "Skip it")

The walkthrough in §5 is a desk check against the iPhone/Pixel viewport widths, not a run on devices.
