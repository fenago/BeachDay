# Beach Day visual system (Sable) - class inventory

Owner: Sable. Status: W1 build, 2026-11-23. Files: `public/css/{tokens,base,glass,components}.css`, `public/img/sprite.svg`.
W2 added page CSS: `beach.css` (index.html), `pages.css` (How it works, Resources, Guide, offline), `console.css` (/console). Markup owners use **only** the classes below and in section 8.

## 0. Rules that apply to every page
1. Load order in `<head>` (no `@import`, no inline style, CSP is `style-src 'self'`):
   `/css/tokens.css`, `/css/base.css`, `/css/glass.css`, `/css/components.css`, then ONE page file: `beach.css` on `/`, `pages.css` on content pages (optional there), `console.css` on `/console`.
2. **No text directly on the sky gradient.** Put titles, status lines and prose in `.panel` (solid) or on glass. Only gaps and glass show the sky.
3. **At most 3 visible blur surfaces:** `.site-header`, `.verdict-card`, an open `.sheet`. `.glass` is a utility for a 4th kind of surface: don't use it on a page that already shows those. No glass inside glass. The chat composer is solid on purpose.
4. Verdict = chip colour + icon + text. The icon is `aria-hidden="true"`; the text is the accessible name.
5. Every interactive control is at least 44 x 44 CSS px (checked at 320 and 390 px). Inline links inside a sentence (`.attribution`, `.footer-safety`, prose) are exempt under WCAG 2.5.8.
6. Dynamic colour or size cannot use `style=""`. Use classes, `data-condition`, or CSSOM (`el.style.setProperty('--agent-color', v)`).
7. Condition tint: `data-condition="sunny|overcast|stormy|night"` on `<html>` or `<body>`. Default is sunny.
8. Dark mode follows `prefers-color-scheme`; there is no in-app toggle (HIG).
9. Icons: `<svg class="icon" aria-hidden="true"><use href="/img/sprite.svg#NAME"/></svg>`. Sizes: `.icon--sm`, default (1.25em), `.icon--lg`, `.icon--xl`. A lone icon button needs `aria-label`.

## 1. Icon sprite ids (`/img/sprite.svg`)
Verdicts: `sun` (Great), `sun-cloud` (Good), `cloud` (Fair), `storm` (Skip it). Weather: `rain`, `moon`, `wind`, `wave`, `uv`, `thermometer`, `flag`.
Status: `info`, `alert`, `check-circle`, `x-circle`, `check`. Actions: `chevron-right`, `chevron-left`, `chevron-down`, `refresh`, `location`, `star`, `close`, `external-link`, `lock`, `send`, `file`, `book`, `clock`, `share`, `plus-square`. Brand: `brand` (header mark; the app icon itself is Pip's).
Validated with the example 03 validator (extended id list): well-formed, 32 symbols, 24x24 viewBox, `<title>`, `currentColor`, 0 problems.

## 2. Components (class, markup)

### Skip link, layout
```html
<a class="skip-link" href="#main">Skip to content</a>
<main id="main" class="container page-main">...</main>   <!-- .container--wide for prose and Console -->
```
Helpers: `.stack`, `.stack--lg`, `.cluster`, `.panel`, `.panel--inset`, `.section-title`, `.visually-hidden`, `.muted`, `.numeric`, text styles `.t-large-title .t-title-1 .t-title-2 .t-title-3 .t-headline .t-callout .t-subhead .t-footnote .t-caption`.
Page title pattern (solid, not on the sky):
```html
<div class="panel"><h1 tabindex="-1">Hollywood Beach</h1><p class="status-line" role="status">Updated 8:15 am</p></div>
```

### Header and nav (glass, sticky from 48em)
```html
<header class="site-header"><div class="site-header__inner">
  <a class="brand" href="/"><svg class="icon" aria-hidden="true"><use href="/img/sprite.svg#brand"/></svg>Beach Day</a>
  <nav class="site-nav" aria-label="Main"><ul>
    <li><a href="/how-it-works/">How it works</a></li><li><a href="/resources/">Resources</a></li>
    <li><a href="/console" aria-current="page">Agents</a></li></ul></nav>
</div></header>
```
Current page = `aria-current="page"` (bold + underline, not colour alone). Wraps to two rows at 320 px.

### Footer (solid)
```html
<footer class="site-footer"><div class="container site-footer__inner">
  <ul class="footer-links"><li><a href="/guide/">Step-by-step guide</a></li><li><a href="https://github.com/fenago/BeachDay">GitHub</a></li></ul>
  <p class="attribution">Weather data by <a href="https://open-meteo.com/">Open-Meteo.com</a> (CC BY 4.0)</p>
  <p class="footer-safety">Not a safety service. Check <a href="...">NWS rip-current risk</a> and posted flags.</p>
</div></footer>
```

### Buttons
`.btn` plus one of `.btn--primary` (accent fill; at most one per view), `.btn--secondary` (outlined; use for Continue with Google), `.btn--text`, `.btn--danger` (Reject), `.btn--icon` (44 px square, needs `aria-label`). Modifiers `.btn--block`, `.btn--sm`. Disabled: `aria-disabled="true"` (preferred, keeps focus) or `disabled`; busy: `aria-busy="true"`. Groups: `.button-row`, `.button-row--end`.

### Chips, tags, badges
`<button class="chip" aria-pressed="true">` (44 px filter; selected = fill + weight, and add a check icon). `.tag` / `.tag.tag--outlook` (dashed) and `.model-badge` are static labels.

### Verdict chip
```html
<span class="verdict verdict--great"><svg class="icon" aria-hidden="true"><use href="/img/sprite.svg#sun"/></svg>Great beach day</span>
```
`--great` (sun) `--good` (sun-cloud) `--fair` (cloud, dark text) `--skip` (storm) `--none` (dashed, no verdict yet), size `--lg` for the hero. Wraps on long labels ("Fair, pick your hours").

### Beach list (picker; also fits the sheet)
```html
<ul class="beach-list"><li class="beach-group"><h2 class="beach-group__title">Broward</h2>
  <ul class="beach-group__items"><li><button class="beach-row" type="button">
    <span>Hollywood Beach<span class="beach-row__meta">Broward</span></span>
    <svg class="icon" aria-hidden="true"><use href="/img/sprite.svg#chevron-right"/></svg></button></li></ul></li></ul>
```
Rows may be `<a>` or `<button>`; `aria-current="true"` marks the saved beach.
`.beach-group__title` is a solid chip (`--surface-solid`, 1 px `--border`, `--radius-s`, `--text`, `justify-self: start`), so no group title sits on the sky gradient. `--text` on `--surface-solid` is checked in light and dark by `tests/helpers/contrast-beachday.mjs`. In forced-colors it uses Canvas, CanvasText and a CanvasText border. The chip edge is decorative; the label carries the meaning.

### Verdict card (glass, the hero)
```html
<section class="verdict-card" aria-labelledby="v">
  <p class="verdict-card__date">Today · Sun 23 Nov</p>
  <h2 id="v" class="verdict-card__title"><span class="verdict verdict--great verdict--lg">...</span></h2>
  <p class="verdict-card__best">Best hours 10 am – 1 pm</p>
  <ul class="reason-list"><li class="reason-list__item"><svg class="icon" aria-hidden="true">...</svg>Light wind, 8 mph</li></ul>
  <p class="verdict-card__advice">UV very high...</p>
  <button class="btn btn--primary">See Hourly</button>
</section>
```
Reason item variants: `--positive`, `--negative` (icon tint only; text carries meaning). Cached or "as of" state: say it in text (`.status-line`, banner); never reduce contrast.

### Safety line and banners
```html
<div class="safety-line"><svg class="icon" aria-hidden="true"><use href="/img/sprite.svg#flag"/></svg><p>Not a safety service. Check <a href="...">NWS rip-current risk</a> and posted beach flags.</p></div>
<div class="banner banner--error" role="alert"><svg class="icon" aria-hidden="true"><use href="/img/sprite.svg#x-circle"/></svg>
  <div class="banner__body"><p class="banner__title">Couldn't get the forecast</p><p>Check your connection and try again.</p></div></div>
```
Variants `banner--info|warn|ok|error`. Each has a tinted fill, a coloured border and an icon, and the text is `--text`. `.status-line` is the persistent `role="status"` element (hidden when empty, but keep it in the DOM). `.toast` is fixed, solid, fades in (use `role="status"`; don't auto-dismiss if it is the only route to the information).

### Day strip, outlook, hourly, key numbers
```html
<ul class="day-strip"><li><a class="day-row" href="#/day/2026-11-24">
  <span class="day-row__name">Mon<span class="day-row__date">24 Nov</span></span>
  <span class="day-row__verdict"><span class="verdict verdict--good">...Good</span></span>
  <svg class="icon icon--chevron" aria-hidden="true">...</svg></a></li></ul>
```
Outlook day: `a.day-row.day-row--outlook` plus `<span class="tag tag--outlook">Outlook</span>` (dashed, tinted, outlined chip; the word is always shown). Below 22em the verdict drops to its own row.
Hourly: `ul.hourly-list > li > div.hourly-row` with `.hourly-row__time`, an icon, `.hourly-row__detail`, `.hourly-row__label` (text label, never a lone dot).
Key numbers: `dl.key-numbers > div.key-number > dd (value) + dt (label)` (value renders first).

### Skeleton (static, no shimmer, `aria-hidden="true"`)
`.skeleton > .skeleton__line.skeleton__line--title | .skeleton__line | .skeleton__line--short | .skeleton__chip`.

### Forms
```html
<div class="field"><label class="field__label" for="e">Email</label>
  <input id="e" class="input" type="email" aria-invalid="true" aria-describedby="e-err">
  <p id="e-err" class="field__error"><svg class="icon" aria-hidden="true">...alert</svg>Enter an email like name@example.com.</p></div>
<div class="password-row"><input class="input" type="password"><button type="button" class="btn btn--text" aria-pressed="false">Show Password</button></div>
```
Also `.field__hint`, `.fieldset` + `legend`, `.or-divider`, `.check`, `.form-actions`, `.form-error` (form-level, `role="alert"`, icon + bold text). `aria-invalid="true"` thickens the border to 2.5 px and recolours it; the message text with an icon is what carries the error.

### Sheet / dialog
```html
<dialog class="sheet" aria-labelledby="t"><div class="sheet__grabber"></div>
  <h2 class="sheet__title" id="t">Approve and deploy this change?</h2>
  <div class="sheet__body">...</div>
  <div class="sheet__footer"><button class="btn btn--secondary">Cancel</button><button class="btn btn--primary">Approve and Deploy</button></div></dialog>
```
Open with `showModal()`. Bottom sheet below 40em, centred dialog above. Optional `.sheet__header` for a leading Cancel. Rises with transform + opacity; reduced motion uses a fade.

### Agent card
```html
<ul class="agent-grid"><li class="agent-card">
  <div class="agent-card__head"><h3 class="agent-card__name">Sable</h3><span class="agent-card__persona">UI designer</span><span class="model-badge">Opus</span></div>
  <p class="agent-card__personality">Calm, visual and exacting.</p>
  <details class="disclosure"><summary><svg class="icon" aria-hidden="true">...chevron-down</svg>Knowledge: 6 docs, 3 examples</summary>
    <div class="disclosure__body"><ul class="knowledge-list"><li>...</li></ul></div></details>
  <div class="agent-card__actions"><button class="btn btn--secondary btn--sm">Chat</button></div></li></ul>
```
The left stripe uses `--agent-color` (decorative). The model is always text in `.model-badge`.

### Chat log and bubbles
```html
<div class="chat"><div class="chat-log" role="log" aria-label="Conversation">
  <div class="msg msg--user"><span class="msg__author">You</span><p class="msg__body">...</p></div>
  <div class="msg msg--agent" aria-busy="true"><span class="msg__author">Sable</span><p class="msg__body">...</p></div></div>
  <form class="composer"><label class="visually-hidden" for="m">Message</label><textarea id="m" class="input" rows="1"></textarea>
    <button class="btn btn--primary" type="submit">Send</button></form></div>
```
The log is a `div`, not an `ol`/`li` (axe listitem). `.chat` is a solid panel (surface, border, padding), so chat text never sits on the sky. Variants `msg--system`, `msg--error`. The body is `white-space: pre-wrap`; set it with `textContent`. While `aria-busy="true"` a static ellipsis follows the text; remove the attribute when done. The composer is sticky and solid; `scroll-padding` keeps focus clear of it.

### Proposal card and diff
```html
<article class="proposal-card" aria-labelledby="p1"><h2 id="p1" class="proposal-card__title">Proposal: Update UV wording</h2>
  <p class="proposal-card__meta">base 9f3c2e1 · sha256:5d1a…c07e</p><p class="proposal-card__summary">...</p>
  <ul class="file-list"><li class="file-list__item"><span class="file-list__path">public/js/copy.js</span>
    <span class="file-status file-status--ok"><svg class="icon" aria-hidden="true">...check-circle</svg>Allowed path</span></li></ul>
  <pre class="diff" tabindex="0" role="region" aria-label="Diff for public/js/copy.js">
    <span class="diff__line diff__line--del"><span class="diff__marker">−</span>old</span>
    <span class="diff__line diff__line--add"><span class="diff__marker">+</span>new</span></pre>
  <div class="button-row"><button class="btn btn--primary">Review and Approve</button><button class="btn btn--secondary">Reject</button></div></article>
```
Denied file: `file-status--denied` with an `x-circle` icon and the words "Not allowed". Line kinds: `--add`, `--del`, `--hunk`; the `+` / `−` marker is real text on every changed line (WCAG 1.4.1). Build lines in JS with `textContent`; the pre is a scrollable region and must be focusable.

### Favourites row, empty state, page bar, TOTP setup (W1F additions)
```html
<ul class="beach-group__items"><li class="beach-item">
  <button class="beach-row" type="button">Hollywood Beach</button>
  <button class="btn btn--icon" type="button" aria-pressed="true" aria-label="Favorite: Hollywood Beach"><svg class="icon" aria-hidden="true"><use href="/img/sprite.svg#star"/></svg></button></li></ul>
```
`.beach-item` = row (flex 1) + 44 px star toggle as siblings. `.btn--icon[aria-pressed="true"]` is a filled button **and** a filled glyph (shape change, not colour alone).
```html
<div class="empty-state"><p class="empty-state__title">No favorite beaches yet</p><button class="btn btn--primary">Choose Beach</button></div>
<div class="page-bar"><h1 tabindex="-1">Hollywood Beach</h1><button class="btn btn--icon" aria-label="Refresh">...</button></div>   <!-- inside .panel -->
<div class="safety-line"><svg class="icon" aria-hidden="true">...flag</svg><div class="safety-line__body"><p class="safety-line__title">Not a safety service</p><p>Check <a href="...">NWS rip-current risk</a> and posted beach flags.</p></div></div>
<div class="qr-tile"><img src="..." alt="QR code for your authenticator app" width="192" height="192"></div>
<div class="copy-row"><code class="key-line">JBSW Y3DP EHPK 3PXP</code><button class="btn btn--secondary" type="button">Copy Key</button></div>
<input class="input input--code" inputmode="numeric" autocomplete="one-time-code" aria-label="Authenticator code">
```
`.qr-tile` is always white with a 3:1 edge, so it scans in dark mode. `.key-line` is monospace with `overflow-wrap: anywhere` and `user-select: all`. `.brand[aria-current="page"]` is underlined (header brand as a sibling link). Agent card: `.agent-card__role` (alias `__persona`) is the role line. Sprite adds `share` and `plus-square` (iOS install hint; original drawings).

### Content pages (How it works, Resources, Guide)
- `.prose` (inside `.panel`): h2/h3, p, lists, `code`, `pre`, `blockquote`, `table` (wrap in `.table-scroll` with `tabindex="0" role="region" aria-label`), `.callout`.
- Resources: `.link-group` (h2 + `ul.link-list > li.link-list__item > a.link-list__link + .link-list__why`). External links add `<svg class="icon icon--sm" aria-hidden="true"><use href="/img/sprite.svg#external-link"/></svg>` and, for `target="_blank"`, `<span class="visually-hidden"> (opens in a new tab)</span>`. "Not re-checked" is a `.tag`.
- Guide: `ol.steps > li > div.steps__body.panel` (number badge is generated; keep a real `<ol>`).

## 3. Fallbacks (all tested in Chromium, see section 5)
| Setting | Effect |
|---|---|
| `@supports not (backdrop-filter / -webkit-backdrop-filter)` | glass becomes `--surface-solid` (both prefixes tested, Safari 9 to 17 keep blur) |
| `prefers-reduced-transparency: reduce` | solid, no blur. Chromium only; **Safari/iOS cannot see it**, so the default tint already passes 4.5:1 |
| `prefers-contrast: more` | solid, firm borders, `.muted` = full text colour |
| `forced-colors: active` | Canvas / CanvasText, real borders, Highlight focus ring and selected chips, verdict chips outlined |
| `prefers-reduced-motion: reduce` | entrance animation becomes a fade, press feedback is opacity, no transitions of consequence. No looping animation exists anywhere |
| dark mode | `prefers-color-scheme: dark` token block (one block, nothing else after it in `tokens.css`) |

## 4. Contrast results (not rounded; WCAG 2.2 formulas; worst background behind glass)
Script: the knowledge example `contrast.mjs` (34/34 on `public/css/tokens.css`) plus Sable's extended script `tests/helpers/contrast-beachday.mjs` (relative tokens path; exits 1 on a failure; Tess wraps it as a test). Result: **120/120 pass**. It also prints sky-stop rows (informational, not counted): `--text` and `--text-2` fail on most sky stops (for example 1.79:1 on sunny bottom), which is why no text may sit on the sky.

| Pair | Light | Dark | Min |
|---|---|---|---|
| `--text` on glass, worst (white/black scroll-under, night) | 9.24 | 6.76 | 4.5 |
| `--text-2` on glass, worst | 5.54 | 4.64 (tightest; do not lighten dark glass) | 4.5 |
| `--link` on glass, worst | 5.17 | 5.01 | 4.5 |
| `--error-text` on glass, worst | 4.90 | 4.96 | 4.5 |
| `--text` / `--text-2` / `--link` on `--surface-solid` and `--surface-2` | all pass | all pass | 4.5 |
| Verdict chips great / good / fair / skip | 5.03 / 6.16 / 9.08 / 6.54 | same | 4.5 |
| `--on-accent` on `--accent` (primary button, chat user bubble, selected chip) | 11.70 | 8.89 | 4.5 |
| `--on-danger` on `--danger` | 6.54 | 6.54 | 4.5 |
| `--text` on banner info / warn / error / ok bg | all pass | all pass | 4.5 |
| Banner icons on their bg | 8.41 / 6.86 / 6.43 / 6.05 | 9.06 / 10.15 / 8.77 / 9.13 | 3 |
| `--text` on diff add / del bg | 14.81 / pass | 12.44 / pass | 4.5 |
| `--control-border` vs glass worst | 3.58 | 3.48 | 3 |
| `--control-border`, `--accent` vs `--surface-solid` / `--surface-2` | pass | pass (8.61 / 7.31 accent) | 3 |
| `--focus` vs glass worst | 6.15 | 5.09 | 3 |
| `--on-brand` on `--brand` `#0b3b5c` | 11.70 | 11.70 | 4.5 |

Notes: the focus ring is a 3 px outline with 2 px offset, so it is measured against the surrounding surface, not the button fill. Hover tints use `color-mix` toward black (derived, hover-capable pointers only) and stay well above 4.5:1 for the label; they are not in the script.

## 5. Render checks run
A scratch page (not in the repo) with every component, served from `public/`, in Chromium at 320 and 390 px: light, dark, reduced-motion, contrast-more, forced-colors, reduced-transparency (CDP). Results: blur surfaces = 3 with the sheet open (2 without), 0 in reduced transparency, contrast-more and forced-colors; 0 controls under 44 x 44; 0 horizontal scroll; 0 console errors. Not tested: the `@supports not` branch (Chromium supports blur), real iOS Safari, `prefers-contrast` on iOS, 60 fps on a mid-range Android, or 200% text zoom with a screen reader.

## 6. Size
`public/css/*.css` is 44 KB raw, about 10 KB gzipped (budget: 100 KB total transfer). `sprite.svg` is 9 KB raw; load it as an external same-origin `<use>`.

## 7. Contrast
No new colour tokens in W2. Every new rule pairs existing tokens (`--text`/`--text-2`/`--link` on `--surface-solid`/`--surface-2`, banner bg/icon pairs, `--accent`/`--on-accent`) that `tests/unit/contrast.test.mjs` already covers. `.hourly-row--best` uses a 6 px accent rule plus the text label "Best"; the outcome steps use text plus icon.

## 8. W2 classes
**beach.css:** `.view`, `.view-section`, `.today-bar`, `.page-bar__actions`, `.back-link`, `.verdict-card__tags|__confidence|__actions`, `.safety-block`, `.safety-line__flags`, `.state-stack` (banners), `.day-summary`, `.hourly-row--best|--stop|--night`, `.hourly-legend`, `.outlook-note`, `.picker`, `.picker__favorites`, `.picker-sheet`, `.install-steps` (ol, number badge generated, inline `share` icon), `.install-action`, `.install-note`, `.toast--update` + `.toast__text`.
**pages.css:** `.content-page`, `.page-title`, `.lead`, `.page-meta`, `.toc` (44 px link rows), `.toc-panel`, `.pipeline` (+ `--row`), `.verdict-legend`, `.callout--warn|--ok|--error`, `.callout__title`, `.resources-nav` (pill links), `.link-list__meta`, `.step-status`, `.state-screen`, `.offline-page`.
**console.css:** `.console`, `.console-bar` (+ `__actions`), `.console-sub`, `.account-menu` (+ `__who`), `.auth-card` (+ `__head|__title|__sub|__email`), `.auth-links`, `.auth-switch`, `.provider-btn`, `.otp-row`, `.cooldown-note`, `.password-rules`, `.state-card` (+ `--denied|--error`, `__body|__actions`; use for 401/403/503/empty/checking), `.agent-card__model|__skills`, `.knowledge-heading`, `.chat-head`, `.chat-status`, `.msg--tool`, `.chat-actions`, `.composer__hint`, `.proposal-list`, `.proposal-card__state`, `.warning-list`, `.diff-block` (+ `__path`), `.diff__line--ctx`, `.approve-sheet`, `.sheet__note`, `.sheet__section`, `.stepup`, `.usage-line`, `.cap-note`, `.deploy-note`, `.outcome` (li `data-state="done|pending|failed"`, `.outcome__sha`), `.live-status`, `.security-list`. Empty chat: `<div class="chat-log" data-empty="...">`.
**components.css aliases:** `.site-nav__list`, `.site-footer__list|__safety|__credit` and a header without `__inner` (Wren's spec 1.1 spelling) work as well as the inventory spelling.

## 9. Render checks (W2)
Harness on port 4183, Chromium, Pixel 7, iPhone 15 (chromium, labelled), 320 px; light and dark; How it works, Resources, Guide: 0 horizontal scroll, 0 controls under 44 px (inline links in prose excluded), 1 blur surface, 0 console errors. index.html and console.html did not exist when I rendered, so beach.css and console.css are verified only by the class gap-finder, not by pixels.

## 10. Ask the team (console.css)
Classes (Remy-B codes against these; copy ids are Wren's):
```html
<section class="team-card team-card--selected" aria-labelledby="tt">
  <div class="team-card__head"><h2 class="team-card__title" id="tt">Ask the team</h2><span class="team-card__badge">Default</span></div>
  <p class="team-card__sub">...</p></section>
<h2 class="expert-list__heading" id="experts-heading">Or ask one expert</h2>
<ul class="expert-list" aria-labelledby="experts-heading"><li><article class="agent-card">...</article></li></ul>
<div class="msg msg--progress" data-state="asking|done|failed" aria-busy="true"><span class="msg__author">Progress</span><p class="msg__body"><svg class="icon" aria-hidden="true">...</svg>Asking Dewey</p></div>
<div class="msg msg--agent"><span class="msg__author">Kai</span><div class="msg__body">...<p class="msg__asked">Asked: Dewey, Wren</p></div></div>
```
- Selected is a 3 px accent frame plus the badge word ("Default"); never colour alone. Unselected uses the 1.5 px `--control-border` frame. All surfaces are solid, so no new blur surface; no new colour tokens.
- `.msg--progress`: compact dotted line, the state is the words ("Asking", "answered", "couldn't answer"); `failed` adds a banner-error fill and border. The `.msg__author` is visually hidden but read. The "…" comes only from the copy; `aria-busy` adds no ellipsis here (`::after { content: none }`). Announce start and end only (Wren's cadence).
- `.msg__asked` is a footnote under the answer; `.msg__proposal-by` is the "Drafted by" line above a proposal card.
- `.expert-list__heading` is a standalone `h2` above the list, styled as a solid `fit-content` pill so no text sits on the sky. `.expert-list` holds only cards, two columns from 40em.
- Compact account row: `.account-menu` puts the signed-in line on its own row, then Security, then `[data-signout]` as one flex row (Sign Out + Sign Out Everywhere) with the hint beneath (`display: contents` on its inner div). Team card top was y=353 at 390/412 px (was 440) and 441 at 320 px (was 528).
- Fallbacks: `prefers-contrast: more` (solid dotted lines, full-strength text), `forced-colors` (Highlight frame, outlined badge), nothing animates so reduced-motion needs no rule.

Contrast, not rounded (light / dark; script `tests/helpers/contrast-beachday.mjs` still 122/122; the pairs below were computed with the same formulas):
| Pair | Light | Dark | Min |
|---|---|---|---|
| `--text` / `--text-2` on `--surface-solid` (title, sub, Asked, Drafted by) | 16.20 / 9.72 | 15.87 / 10.89 | 4.5 |
| `--text` on `--surface-2` (progress inside a bubble) | 14.74 | 13.46 | 4.5 |
| `--text-2` on `--surface-2` (Asked footer in the Kai bubble) | 8.84 | 9.24 | 4.5 |
| `--on-accent` on `--accent` (Default badge) | 11.70 | 8.89 | 4.5 |
| `--accent` frame vs `--surface-solid` | 10.88 | 8.61 | 3 |
| `--control-border` (team frame, dotted progress) vs `--surface-solid` | 6.28 | 8.16 | 3 |
| progress icons: `--text-2` / `--banner-ok-icon` vs `--surface-solid` | 9.72 / 6.51 | 10.89 / 10.70 | 3 |
| failed: `--text` on `--banner-error-bg`; icon and border on it | 14.81; 6.43 | 14.92; 8.77 | 4.5; 3 |

Render check (scratch page on port 4212, Chromium): 320, 390 and 800 px light, 390 dark, forced-colors, contrast-more: 0 horizontal scroll, 0 blur surfaces. Not tested: real iOS Safari, the harness with Remy-B's real markup (it did not exist yet), 200% text zoom. The sprite icons were not loaded in the scratch page, so icon glyphs are unchecked visually.
