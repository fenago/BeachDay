# JavaScript modules in the browser (no framework, no bundler)
Source: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules
Retrieved: 2026-11-23

## Core rules

From [MDN: JavaScript modules](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Modules):

- **Loading:** `<script type="module" src="main.js"></script>`, or an inline `<script type="module">` that uses `import`.
- **Parsing:** modules "are automatically in strict mode" and can use `import`/`export`.
- **Scope:** "modules are executed in their own scope, not in the global scope". Declarations aren't visible outside unless exported, or attached to `window` on purpose (don't).
- **MIME type:** "The file extension doesn't matter on the web—JavaScript is identified by the Content-Type header, and modules are identified by the `type="module"` attribute". The server must send a JavaScript MIME type such as `text/javascript`. Otherwise: a strict MIME type checking error ("The server responded with a non-JavaScript MIME type") and the script doesn't run.
- **`.js` vs `.mjs`:** for browsers the difference is "purely cosmetic". MDN keeps `.js` because it is more widely understood, and "Most servers automatically set the correct type for .js files, but some don't for .mjs".
- **Imports are read-only live views** of the exporter's values. Names must match, unless you use `as` renaming or a default export.
- **Default export:** one per module, "no names associated with them". The importer picks its own local name.
- **Namespace import:** `import * as Square from "./modules/square.js"` groups exports under one object.
- **Barrel modules:** `export { Square } from "./shapes/square.js"` or `export * from ...` re-export. `export *` excludes the default export and "may accidentally expose things".
- **Hoisting:** "Import declarations are hoisted". The imported module's side effects run before the rest of the module.
- **Dynamic import:** `import("./modules/square.js").then((Module) => ...)` returns a promise of the module namespace object. "Dynamic import is permitted in the browser main thread, and in shared and dedicated workers. However `import()` will reject if called in a service worker or worklet."
- **Top-level await:** available in modules. Dependents wait, but sibling modules that don't depend on it keep evaluating. "Top-level await is not free". It makes part of the module graph asynchronous.
- **`import.meta.url`:** the module's URL. Use `new URL("../data/colors.json", import.meta.url)` to locate files relative to the module.
- **Host vs language:** the language defines the syntax, graph linking and namespace objects. The host (browser) defines specifier resolution, `import.meta` and loading.

Not quoted in this retrieval (standard behaviour, **[UNVERIFIED]** here): module scripts are deferred by default; each module evaluates only once however many times it is imported; bare specifiers such as `"lodash"` need an import map; modules loaded from `file://` fail with CORS errors.

## Beach Day notes

Our front end is framework-free ES modules (docs/03 §2, `web-platform-vanilla`):

```
public/
  index.html          <script type="module" src="/js/app.js">
  console.html        <script type="module" src="/js/console/app.js">
  sw.js               classic service worker; no import() inside it (MDN: import() rejects in a service worker)
  js/api/openmeteo.js fetch + normalize (pure exports, no DOM)
  js/score.js         scoreHour / scoreDay / scoreWeek (pure, no DOM, no fetch)
  js/score-config.js  thresholds as a default-exported frozen object
  js/ui/*.js          render functions that take data and return DOM (no fetch)
  js/router.js        hash router (see examples/03-proposed-adr)
```

Boundary rules this implies:

- **Pure modules** (`score.js`, `api/openmeteo.js` normalizers) have no top-level side effects. Vitest can import them in Node without a DOM, and they are evaluated once and shared.
- **Relative specifiers with `.js` extensions** everywhere (`./score.js`). There is no bundler and no import map, so bare specifiers would fail.
- **No top-level await in shared modules.** It would make every importer wait on network I/O. Do the fetches in `app.js`.
- **`sw.js` stays a classic script.** `import()` rejects in service workers. Whether static `import` in a module service worker (`register(url, {type: "module"})`) is safe on our iOS Safari baseline is **[UNVERIFIED]**; pwa-mobile-engineer owns that decision.
- **Netlify serves `.js` as JavaScript** by default; that is the reason to keep `.js` rather than `.mjs` under `public/`. The Netlify MIME mapping is **[UNVERIFIED]** in this retrieval, so check it with `curl -I` on a Deploy Preview. Node-side scripts and examples use `.mjs`.
- Lazy-load the Console UI (`import("./console/app.js")`) only if it ever shares `index.html`. Today it has its own `console.html`, which keeps the main bundle smaller (`performance-budgets`).
