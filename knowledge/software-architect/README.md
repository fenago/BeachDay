# Software-architect knowledge base

Date: 2026-11-23 · Owner: software-architect · Scope: ADRs, C4 diagrams, module boundaries, interface contracts, the static-site + Functions boundary

Read this index first, then the files the task needs.

## docs/ (reference notes from official documentation)

| File | What it covers | Read when |
|---|---|---|
| [docs/01-adr-practice.md](docs/01-adr-practice.md) | Nygard's ADR format (Context / Decision / Status / Consequences), numbering and superseding, adr.github.io definitions (AD, ASR, decision log), and how our template adds Deciders + Revisit when | Drafting or reviewing any ADR, or when a change might contradict one |
| [docs/02-c4-model.md](docs/02-c4-model.md) | C4 abstractions; "container" = application or data store (a serverless function and a blob store each count); context vs container diagrams; the Beach Day element mapping | Drawing or reviewing architecture diagrams in `docs/design/` |
| [docs/03-es-modules.md](docs/03-es-modules.md) | Browser ES modules: `type="module"`, strict scope, MIME type, `.js` vs `.mjs`, live read-only imports, `import()` (rejects in service workers), top-level await, `import.meta.url`; our `public/js` boundaries | Designing the front-end module layout or reviewing imports |
| [docs/04-sse-and-streams.md](docs/04-sse-and-streams.md) | `text/event-stream` format (`event`/`data`/`id`/`retry`, comments, blank-line framing); EventSource can't POST, so we use `fetch` + ReadableStream; the 6-connection limit; the `/api/chat` event rules | Specifying or reviewing the Console's streaming contract |
| [docs/05-netlify-functions-boundary.md](docs/05-netlify-functions-boundary.md) | Functions v2 shape (`Request`/`Context` → `Response`, `config.path`), the `netlify/functions/` layout, event handlers, immutability, the 60 s / 15 min limits, our route table and what must never be server-side | Any new endpoint, store or external call, or anything that might stretch ADR-0001 |

## examples/ (worked, verified)

| Folder | What it shows | Read when |
|---|---|---|
| [examples/01-c4-diagrams/](examples/01-c4-diagrams/) | C4 context and container diagrams for Beach Day in Mermaid (updated for ADR-0006/0007/0008: Supabase Auth, Google, no login function), rendered with mermaid 11.17.2 in headless Chromium; the SVGs are valid XML | Drawing system or container views |
| [examples/02-interface-contracts/](examples/02-interface-contracts/) | JSON Schemas for ForecastHour, DayVerdict, the SSE event union and the Proposal record, matching docs/04 §2.1 and the canonical §6 list. Ajv strict: 39 samples, a **real Open-Meteo response** normalized into 24 valid hours, and an SSE wire round trip. All pass | Writing contracts so builders can work in parallel |
| [examples/03-proposed-adr/](examples/03-proposed-adr/) | Proposed ADR 0009 (hash-route SPA, no framework; renumbered from 0006) and `check-adr.mjs`. Re-ran: 0009 ok; ADRs 0001–0008 pass the template (0006–0008 with 0 warnings) | Writing an ADR |
| [examples/04-vendored-auth-client/](examples/04-vendored-auth-client/) | Why and how the Console vendors one pre-bundled `@supabase/auth-js` file. `check-bundle.mjs` proves no bare imports, no eval, the 11 auth methods present, and a fake-fetch sign-in that calls only `/auth/v1/token`. 104,198 B, about 25 KB gzipped | Any browser dependency, or the CSP `script-src` |

## Decisions this folder now depends on

- **ADR-0006:** Supabase Auth for the Console. It supersedes 0001 and restates the boundary.
- **ADR-0007:** the read tools read from GitHub `main`.
- **ADR-0008:** the Approve cap is 14 per rolling 31 days and 5 per day, site-wide.
- **docs/04 §2.1** is the contract source for IDs, statuses and SSE. **docs/04 §6** is the canonical allow/deny list.

## Findings to pass on (not fixed here)

- ADR-0005 has an extra `## Open check` section that isn't in the `docs/adr/README.md` template. Either add an optional "Open questions" section to the template, or move the note into Consequences in a future superseding ADR.
- The scoring skill names `confidence: "outlook"` but gives no value for days 1–3. The contract example uses `"forecast"`; confirm it with open-meteo-integrator.
- supabase.com was unreachable from the sandbox on 2026-11-23. Supabase Free limits and inactivity pausing are **[UNVERIFIED]** in ADR-0006.
- The `sw.js` import convention (`public/sw/**` only) is an architect proposal. pwa-mobile-engineer must adopt it, or the deny rule can't be static.
