# 0009 — Hash-route single-page app with plain ES modules, no framework
- Status: Proposed
- Date: 2026-11-23
- Deciders: Dr. Lee (+ software-architect, pwa-mobile-engineer, ux-designer-apple-hig consulted)

## Context
The main app needs a few views: beach picker, Today, the 7-day list, and day detail. The Agent Console is already a separate page (`/console`, docs/03 §2). We have to choose how views change and whether to adopt a UI framework.

The forces are:

- **Offline and install.** The service worker must serve every view while offline (docs/02). With path routes (`/beach/miami/week`), every deep link is a different URL. The service worker would need a navigation fallback to `index.html`, and Netlify would need a SPA rewrite (`/* /index.html 200`). Both have to stay in step with the precache list. Hash routes (`/#/beach/miami/week`) always request `/` from the server, so one cached `index.html` serves every view.
- **Static hosting only (ADR-0001, now restated in ADR-0006).** There is no server-side rendering and no server that could resolve routes, so all routing is client-side either way.
- **Budget (ADR-0004, performance-budgets).** Every dependency adds bytes and an upgrade path. A framework also adds a build step and the risk of a dependency-update deploy. Each deploy costs 15 of 300 monthly credits.
- **Size of the UI.** About 5 views, no shared mutable state beyond "selected beach + cached forecast", and no forms beyond the beach search. MDN's module guide covers what we need: `type="module"`, relative imports, dynamic `import()` for rarely used views (docs `03-es-modules.md`).
- **Sharing and SEO.** Hash fragments are not sent to the server and are not indexed as separate pages. Beach Day is a personal utility, so no SEO need was identified.
- **Agent proposals.** The Console can change `public/**` only. A framework would also need `package.json` changes, which are denied in the Console (docs/04 §6), so agents could not upgrade it without a human.

## Decision
We will build the main app as one `index.html` with plain ES modules and no UI framework:

1. **Routing:** `public/js/router.js` maps `location.hash` patterns to view modules. It listens to `hashchange` and runs once on load. Routes: `#/` (picker or last beach), `#/beach/:id` (Today), `#/beach/:id/week` (7-day list), `#/beach/:id/day/:date` (day detail). An unknown hash goes to `#/`.
2. **Views** are modules that export `render(container, data)`, build DOM with `textContent`/`createElement` (never `innerHTML` with data), and return a cleanup function.
3. **State** is the beach ID in the hash plus cached forecasts (service worker cache / `localStorage`, per `web-platform-vanilla`). There is no global store library.
4. **No new runtime dependency** and no bundler for `public/`. Rarely used views may load with `import()`.
5. **The Console stays a separate page** (`console.html`) with its own module graph.

## Consequences
- **Good:** one cached `index.html` serves every view offline; no SPA rewrite rule and no navigation fallback in the service worker; zero framework bytes; no `package.json` change, so agents can propose UI work through the Console (allow-listed `public/**`).
- **Good:** views stay plain functions that Vitest can unit-test in a DOM environment.
- **Bad:** `#/` URLs look less clean when shared. Moving to path routes later means a redirect shim from old hash links.
- **Bad:** we hand-write what a framework gives for free: focus management on view change, and a live-region announcement of the new view title (accessibility-wcag22). QA must test these explicitly.
- **Neutral:** the iOS "Add to Home Screen" start URL stays `/`, and the hash is restored by our own "last beach" logic, not by the start URL.
- **Follow-up:**
  - pwa-mobile-engineer confirms the precache list (only `/`, not per-route URLs);
  - Wren specifies focus and announcement behaviour per view;
  - QA adds a hash-deep-link + offline Playwright spec.

## Revisit when
- Views grow past about 10, or shared state needs more than the hash plus cache (for example accounts or favourites sync).
- Shareable clean URLs or search indexing become a product goal (Dr. Lee).
- Bugs in the hand-written router or focus handling recur (two or more in a quarter).
