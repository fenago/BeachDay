---
name: web-platform-vanilla
description: Beach Day front-end conventions — framework-free HTML, CSS and ES modules, component pattern, fetch with timeouts, local state, safe DOM rendering. Use when writing or reviewing anything under public/.
---
# Vanilla web platform conventions

## Stack
- **No framework, no bundler** for the app itself. Use plain HTML, CSS and native ES modules (`<script type="module">`).
- **Target browsers:** current iOS Safari, Chrome Android and evergreen desktop browsers.
- `npm` is used only for dev tooling: Vitest, Playwright, eslint.

## Layout
```
public/index.html          app shell (one page; views switch via hash routes #/, #/beach/:id, #/day/:date)
public/console.html        Agent Console
public/js/main.js          boot, router, SW registration
public/js/api/openmeteo.js fetch + normalize
public/js/score.js         pure scoring (+ score-config.js thresholds)
public/js/ui/*.js          view components
public/js/console/*.js     Console UI
public/css/tokens.css      design tokens (Sable) ; base.css ; components.css
```

## Component pattern
```js
// ui/day-card.js
export function DayCard({ day }) {
  const el = document.createElement("article");
  el.className = "day-card";
  el.append(h("h3", {}, day.label), h("p", { class: "verdict" }, day.verdict.text));
  return el;
}
```
- Write small pure functions that return elements, with a tiny `h(tag, attrs, ...children)` helper.
- Re-render a view by replacing it. There is no virtual DOM.
- **Never put untrusted strings in `innerHTML`.** That covers API data, model output and user text. Use `textContent`, or a sanitizer for Markdown in the Console.
- Pass state in explicitly. Keep app state in one module (`state.js`) with `get`, `set` and `subscribe`.

## Data & storage
- **`fetch`:** always use an `AbortController` timeout (3–5 s for weather). Check `res.ok`, then validate the JSON shape.
- **`localStorage`** holds favorites, the last beach and units. Wrap every read and write in try/catch, and treat stored values as disposable: iOS may evict storage for sites that aren't installed.
- **No third-party scripts, fonts or CDNs.** CSP is `script-src 'self'`.

## CSS
- Mobile-first. Use logical properties, `rem` units and `clamp()` for type.
- Handle `env(safe-area-inset-*)` for the notch and home indicator.
- Support `prefers-color-scheme`, `prefers-reduced-motion` and `prefers-reduced-transparency`.

## Quality
- Use semantic HTML first: `button`, `nav`, `main`, headings in order, `label`s.
- Every interactive element must be reachable by keyboard and have a visible focus style.
- Budgets are in the `performance-budgets` skill.
