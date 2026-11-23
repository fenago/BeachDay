# Example 01: C4 context and container diagrams for Beach Day (Mermaid)

## What it demonstrates

- `c4-context.mmd` is C4 level 1. Beach Day sits in the centre, with its two people (beach-goer, Dr. Lee) and the external systems it touches: Open-Meteo, Claude API, GitHub, Netlify, **Supabase Auth and Google sign-in (ADR-0006)**, and NWS as a link-out only.
- `c4-container.mmd` is C4 level 2, inside the system boundary:
  - static hosting (CDN);
  - the PWA;
  - the Agent Console UI;
  - the Netlify Functions, one container per route, drawn grouped (agents, chat, jobs + jobs-run, proposals/approve; no login function since ADR-0006);
  - Netlify Blobs.
  Every relationship is labelled with its purpose and protocol.
- `validate-mermaid.mjs` parses **and renders** each file with the real `mermaid` library in headless Chromium (Playwright), and writes the `.svg` next to the source.
- `c4-context.svg` and `c4-container.svg` are the rendered output from the verified run.

## Why this is "what good looks like"

- **The diagrams encode the ADRs**, so a wrong arrow would be visible in review:
  - PWA → Open-Meteo is direct, with no function in between (ADR-0001);
  - NWS is a dotted link-out with no data flow (ADR-0002);
  - only Functions talk to Claude and GitHub, and only `approve` commits to `main` (ADR-0003, ADR-0005); `chat` only reads `main` (ADR-0007);
  - the Console UI talks to Supabase Auth directly, and every Function verifies the token and role with Supabase on every request (ADR-0006);
  - there are no other servers or databases; Supabase holds identity only.
- **Follows C4's definitions** (`docs/02-c4-model.md`):
  - each serverless function is a container ("A single serverless function");
  - Blobs is a container because we own the data in it;
  - SPA and functions are separate containers ("two separate process spaces");
  - the context diagram has people and systems, not technologies.
- **Every element has a type in brackets** (`[Person]`, `[Container: …]`, `[External System]`) and C4's usual colours, so no separate key is needed. Every diagram has a title and date.
- **Plain `flowchart` syntax.** This avoids depending on Mermaid's C4 diagram types; the docs for those weren't verified in this retrieval.
- **Validated by rendering, not eyeballing.** `htmlLabels` is off so the output SVG is valid standalone XML (checked with `xmllint`). The first attempt with HTML labels produced `<br>` tags that broke the standalone SVG, which is why labels are plain text.

## How to run

```bash
# install mermaid OUTSIDE the repo; Playwright + Chromium are preinstalled
cd /tmp/some-scratch && npm i mermaid@11
cd <repo>/knowledge/software-architect/examples/01-c4-diagrams
MERMAID_JS=/tmp/some-scratch/node_modules/mermaid/dist/mermaid.min.js \
PLAYWRIGHT_MODULE=/opt/node-tools/node_modules/playwright \
node validate-mermaid.mjs c4-context.mmd c4-container.mmd
xmllint --noout c4-context.svg c4-container.svg
```

`@mermaid-js/mermaid-cli` (`mmdc`) would also work, but it downloads its own Chromium through Puppeteer. Loading `mermaid.min.js` into the preinstalled Playwright Chromium avoids that download and validates with the same library.

## Verified

**Re-run 2026-11-23 after ADR-0006** (Supabase Auth, Google, the `agents` and `jobs-run` functions, ADR-0007 reads, and the ADR-0008 cap added; login/logout removed):

```
$ node validate-mermaid.mjs c4-context.mmd c4-container.mmd
mermaid 11.17.2 in Chromium 157.0.8103.78 (htmlLabels off, so the SVG is valid XML)
ok    c4-context.mmd (type=flowchart-v2, svg 52053 bytes)
ok    c4-container.mmd (type=flowchart-v2, svg 69291 bytes)
exit=0
$ xmllint --noout c4-context.svg c4-container.svg && echo xml-ok
xml-ok
```

The re-rendered SVGs were checked as valid XML only. They were not visually inspected in this run.

**Original run** (before ADR-0006):

Run on 2026-11-23, Node v22.23.5, mermaid 11.17.2, Chromium 157.0.8103.78:

```
$ node validate-mermaid.mjs c4-context.mmd c4-container.mmd
mermaid 11.17.2 in Chromium 157.0.8103.78 (htmlLabels off, so the SVG is valid XML)
ok    c4-context.mmd (type=flowchart-v2, svg 40561 bytes)
ok    c4-container.mmd (type=flowchart-v2, svg 60301 bytes)
exit=0
$ xmllint --noout c4-context.svg c4-container.svg && echo xml-ok
xml-ok
```

Negative check: a deliberately broken file (`b[[unclosed`) was rejected:

```
ERROR broken.mmd: Parse error on line 5: | ...-->   b[[unclosed | --------------------^
exit=1
```

The rendered PNGs were also inspected visually; all boxes, labels and arrows were present.
