# Example 03: A Proposed ADR (0006: hash-route SPA, no framework) plus an ADR checker

## What it demonstrates

- `0006-hash-route-spa-no-framework.md` is a complete ADR in the exact template from `docs/adr/README.md`: title line, Status, Date, Deciders, then Context / Decision / Consequences / Revisit when. Status is **Proposed**, because only Dr. Lee accepts.
- `check-adr.mjs` is a dependency-free checker for the template.
  - **ERROR** (breaks the template):
    - filename `NNNN-short-title.md` matches the number in the title;
    - em-dash title line;
    - Status, Date and Deciders lines;
    - the four required sections in order;
    - with `--index`, the next free number in `docs/adr/README.md`;
    - with `--draft`, Status must be Proposed.
  - **WARN** (Nygard style advice):
    - Decision in active voice ("We will …");
    - Consequences that include the bad;
    - sections not in the template.

## Why this is "what good looks like"

- **One decision, real forces.** Context weighs offline/service-worker behaviour (hash routes need no SPA rewrite or navigation fallback), ADR-0001 static hosting, the ADR-0004 deploy/credit budget, UI size, SEO, and the Console allow-list (a framework would need `package.json` changes that the Console denies). These forces are value-neutral, as Nygard asks.
- **A testable decision.** It names the router file, the four routes, the view signature `render(container, data)`, the "no `innerHTML` with data" rule, and that the Console stays a separate page.
- **Honest consequences.** It lists the costs as well as the benefits: uglier URLs, a future redirect shim, and hand-written focus management and live-region announcements. Each has a follow-up owner (pwa-mobile-engineer, Wren, QA).
- **Concrete revisit triggers:** more than 10 views, clean URLs or SEO becoming a goal, or two or more router bugs in a quarter.
- **It doesn't contradict an accepted ADR.** It builds on ADR-0001 and ADR-0004. Per the ADR skill, a new dependency or a cost change is exactly what needs an ADR; this one records the choice *not* to add one.

## How to run

```bash
cd <repo>
node knowledge/software-architect/examples/03-proposed-adr/check-adr.mjs \
  knowledge/software-architect/examples/03-proposed-adr/0006-hash-route-spa-no-framework.md \
  --index docs/adr/README.md --draft
for f in docs/adr/000*.md; do node knowledge/software-architect/examples/03-proposed-adr/check-adr.mjs "$f"; done
```

To adopt it, the orchestrator brings it to Dr. Lee. If accepted, the file is copied to `docs/adr/0006-hash-route-spa-no-framework.md` with `Status: Accepted`, and a row is added to `docs/adr/README.md` and the `architecture-decision-records` skill's log.

## Verified

Run on 2026-11-23, Node v22.23.5:

```
$ node check-adr.mjs 0006-hash-route-spa-no-framework.md --index docs/adr/README.md --draft
.../0006-hash-route-spa-no-framework.md: ok (status Proposed, 0 warning(s))
exit=0

$ for f in docs/adr/000*.md; do node check-adr.mjs "$f"; done
WARN  Decision should be active voice ("We will ...") per Nygard
docs/adr/0001-static-site-plus-functions.md: ok (status Accepted, 1 warning(s))
WARN  Decision should be active voice ("We will ...") per Nygard
docs/adr/0002-no-rip-current-proxy.md: ok (status Accepted, 1 warning(s))
WARN  Decision should be active voice ("We will ...") per Nygard
WARN  Consequences must include the bad, not only the good
docs/adr/0003-approve-commits-to-main.md: ok (status Accepted, 2 warning(s))
WARN  Decision should be active voice ("We will ...") per Nygard
docs/adr/0004-netlify-free-plan.md: ok (status Accepted, 1 warning(s))
WARN  extra section(s) not in the template: Open check
WARN  Decision should be active voice ("We will ...") per Nygard
docs/adr/0005-fine-grained-pat.md: ok (status Accepted, 2 warning(s))
```

All five accepted ADRs pass the template (no errors). The warnings are style findings, reported here and **not** fixed, because accepted ADRs are immutable:

- the accepted ADRs state decisions as bullets, not "We will …" sentences;
- ADR-0005 has an extra `## Open check` section that isn't in the template;
- the ADR-0003 warning is a false positive of the keyword heuristic: its Consequences do list a downside ("No preview gate before production").

The router itself was not implemented or run; this example is a decision record.
