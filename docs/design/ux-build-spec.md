# UX build spec: Beach Day v1
Owner: Wren (ux-designer-apple-hig) · Build wave W1 · Date: 2026-11-23 · Status: ready for W2 builders
Follows: ADR-0002 (rip currents are link-outs), ADR-0006 (Supabase Auth, browser calls Open-Meteo directly), ADR-0008 (approve cap), HIG, WCAG 2.2 AA.
All strings are in `public/js/copy/copy-deck.js` (ids in brackets). Never type a user-facing string into markup or JS by hand. Fill `{placeholders}` with `t(id, vars)`. Use `textContent`, never `innerHTML`.

This spec adds to, and does not replace, three worked specs. Read them for wireframes and the full state matrices:
- Beach flow: `knowledge/ux-designer-apple-hig/examples/01-flow-beach-verdict/flow-spec.md` (S1 to S4, state matrix).
- Approve: `knowledge/ux-designer-apple-hig/examples/03-console-approval/approval-spec.md`.
- Accounts: `knowledge/ux-designer-apple-hig/examples/04-console-auth/flow-spec.md` (S1 to S12).

## 0. Decisions applied (Dr. Lee, 2026-11-23, and the build plan)
| Decision | Effect on copy and flows |
|---|---|
| Sign-up is open | S2 says nothing about access. "No access" appears only on Agents, chat and Approve. |
| The wording is "Sign in" | Screen text and links say "Sign in". Buttons keep Title Case: "Sign In". Never "log in". |
| The page is named "Agents" | Header link, `h1` and page title say "Agents". The URL stays `/console`. Strings that said "Console" now say "Agents" (see §9). |
| 403 heading (D4, pending) | "This account can't use Agents" [console.noaccess.title]. One id to change if Dr. Lee rules otherwise. |
| Positive reasons (D3, off) | Strings exist [reason.pos.*]. Dewey's flag `SCORE_CONFIG.reasons.positiveOnGoodDays` decides if they show. |

## 1. Site map and shell
| URL | Page | `h1` | Notes |
|---|---|---|---|
| `/` | Beach app (hash routes `#/`, `#/beaches`, `#/day/YYYY-MM-DD`) | the beach name (Today), or "Choose a beach" | No account, ever |
| `/how-it-works/` | How it works | How it works | Static |
| `/resources/` | Resources | Resources | Static |
| `/guide/` | Step-by-step guide | Step-by-step guide | Static |
| `/console` | Agents (hash routes `#/console/...`) | per screen | Needs an account; sign-in is delayed until here |
| `/offline.html` | Offline fallback | "You're offline" | Minimal |

### 1.1 Header, nav and footer: exact markup
Class names are semantic and TBD until Sable's inventory lands; swap them for hers in W2 and keep the structure, the order, the landmarks and the text. Mark the current page with `aria-current="page"`. On `/console` the Agents link is current. On the beach app, Beach Day is current.

```html
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <nav class="site-nav" aria-label="Main">
    <a class="brand" href="/" aria-current="page">Beach Day</a>
    <ul class="site-nav__list">
      <li><a href="/how-it-works/">How it works</a></li>
      <li><a href="/resources/">Resources</a></li>
      <li><a href="/console">Agents</a></li>
    </ul>
  </nav>
</header>

<main id="main" tabindex="-1">
  <h1>…</h1>
</main>

<footer class="site-footer">
  <nav aria-label="Site">
    <ul class="site-footer__list">
      <li><a href="/guide/">Step-by-step guide</a></li>
      <li><a href="https://github.com/fenago/BeachDay" target="_blank" rel="noopener noreferrer">GitHub<span class="visually-hidden"> (Opens in a new tab)</span></a></li>
    </ul>
  </nav>
  <p class="site-footer__safety">Not a safety service. Check
    <a href="https://www.weather.gov/beach/mfl" target="_blank" rel="noopener noreferrer">NWS rip-current risk<span class="visually-hidden"> (Opens in a new tab)</span></a>
    and posted flags.</p>
  <p class="site-footer__credit">Weather data by
    <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">Open-Meteo.com<span class="visually-hidden"> (Opens in a new tab)</span></a>
    (<a href="https://open-meteo.com/en/licence" target="_blank" rel="noopener noreferrer">CC BY 4.0<span class="visually-hidden"> (Opens in a new tab)</span></a>)</p>
</footer>
```

Copy ids: [nav.skip] [nav.label] [nav.home] [nav.how] [nav.resources] [nav.agents] [footer.label] [footer.guide] [footer.github] [footer.safety] [footer.safety.link] [footer.openmeteo] [footer.license] [offsite.hint].

Rules:
- Every page: `<html lang="en">`, one `h1`, `<title>` = "{h1} · Beach Day" (the beach app: "Beach Day"), the manifest link and the theme-color meta.
- The four header items are 44 px tall. At 320 px the brand sits on row one and the three links wrap to row two. No hamburger, no horizontal scroll.
- The footer is on every page, including `/console` and `/offline.html`. The footer line is the short safety variant. A screen that shows a verdict also shows the full, exact line [safety.line] under the verdict card (§2), so a verdict page has both. That is deliberate: the full line is the contract, the footer is the site-wide floor.
- Footer NWS link: Miami office (`/beach/mfl`) on static pages. On a beach screen the in-card link follows the beach (Key West beaches use `https://www.weather.gov/key/`).
- External links open in a new tab with `rel="noopener noreferrer"` and hidden text [offsite.hint]. The `.visually-hidden` span is Sable's utility.
- No tab bar. The v1 beach app has two places (Today and the picker), reached by a [btn.chooseBeach] ("Change Beach") text button in the Today and Day top bars, going to `#/beaches`. The hourly toggle reads [btn.showHourly] / [btn.hideHourly]. The chat log's accessible name is [agents.chat.log]. A tab bar of two items plus a four-item header would be two navigation systems on one phone (HIG: one primary navigation).

## 2. Beach app flow (deltas from example 01)
The wireframes, steps and state matrix in example 01 stand. Changes for the build:

| # | Change | Why |
|---|---|---|
| 1 | The tab bar in example 01 S3/S4 is removed (see §1.1). "Beaches" is the picker sheet or `#/beaches`. | One navigation system |
| 2 | S1 picker groups by county with [ui.county.*]: Miami-Dade (Miami Beach, Key Biscayne, Bill Baggs, Haulover), Broward (Hollywood, Fort Lauderdale, Deerfield), Palm Beach (Boca Raton, Delray, Palm Beach, Jupiter), Monroe (Key West, Bahia Honda). 13 beaches. | docs/01 §6 |
| 3 | Favorites are a star on each picker row, with a "Favorites" group on top when any exist. Empty: [empty.favorites] as text only, in the picker's favorites area (no button: the picker is already open). The star's name is [ui.favorite.add] or [ui.favorite.remove]. `aria-pressed` on the star. | HIG: blank screens give a next step |
| 4 | The Today top bar has the beach name as the `h1`, [ui.choose.change] as a text button and Refresh (icon button, name [btn.refresh]). | Standalone mode has no browser chrome |
| 5 | Key numbers are a small grid under the reasons: [ui.key.feels], [ui.key.wind], [ui.key.rain], [ui.key.waves], [ui.key.water], [ui.key.uv]. Waves and water show [status.waves.na] or [status.water.na] when missing. | docs/01 §5 |
| 6 | The "Best hours" line is [ui.bestHours] with an en dash: "Best hours 10 am – 1 pm". | Example 01 |
| 7 | The safety block has the heading [ui.safety.heading] "Before you go", the full [safety.line] with the NWS link, and [ui.safety.flags] "Check posted flags." It sits directly under the verdict card, above "Next days". | ADR-0002, prominent |

### 2.1 Verdict card text
Use `verdictFor(score)` or the verdict key from `copy-deck.js`. The label is the accessible name of the chip. The icon is `aria-hidden`. Colour is never alone.

| Verdict | Label | Icon |
|---|---|---|
| great | Great beach day | sun |
| good | Good | sun-cloud |
| fair | Fair — pick your hours | cloud |
| skip | Skip it | storm |

A short window caps the label at "Good". The card then always shows [reason.short] "Only {hours} usable beach hours". Outlook days (day 4 and later) show the tag [ui.outlook] and the line [advice.outlook].

### 2.2 Reason and advice codes to strings
Render `t(reason.copyId, reason.params)` and `t(advice.copyId, advice.params)`. `score.js` owns the variant choice (it picks the copy id from the unrounded best-window value); the UI never re-derives a band. `copy-deck.js` exports no reason or advice helper on purpose. Tess: a test must check that every emitted `copyId` is in `STRINGS`.

Rendering rules:
- The reasons list shows at most 4 items. If a Great day has no reasons, hide the empty list (no heading, no bullets).
- A verdict of `skip` with `bestWindow: null` (no eligible window, only hard-stop reasons) shows no "Best hours" line. The stop reasons carry the explanation.
- Short window: [reason.short] "Only {hours} usable beach hours", or [reason.short.one] "Only 1 usable beach hour" (score.js picks). It always sits next to a label capped at Good.
- Confidence line: show only for `medium` ([advice.confidence.medium] "Fairly sure.") and `low` ([advice.confidence.low] "Less sure. Check again later."). `high` shows nothing. `outlook` shows the tag [ui.outlook] and [advice.outlook].
- Never write "clear" for an unknown weather code.

Ids added in the deck for neutral bands: [reason.feels] "Feels like {temp} °F" and [reason.water] "Water {temp} °F, a bit cool". [reason.short.one] is new.

D3 positive reasons (off by default, `SCORE_CONFIG.reasons.positiveOnGoodDays`). Codes and ids, as ruled in build-contracts: `dry` reason.pos.dry "Low chance of rain", `sunny_sky` reason.pos.sunny "Mostly sunny", `comfortable` reason.pos.comfortable "Comfortable, feels like {temp} °F", `light_wind` reason.pos.wind "Light wind, {mph} mph", `calm_waves` reason.pos.waves "Calm, waves under 2 ft offshore", `warm_water` reason.pos.water "Warm water, {temp} °F".

Advice ids for reference: advice.uv.moderate (`{n}`), advice.uv.high, advice.uv.veryhigh, advice.uv.extreme, advice.fog, advice.marine.missing, advice.marine.partial, advice.lightning, advice.outlook.

### 2.3 Install hints (never nag)
| Platform | What shows | When | Dismiss |
|---|---|---|---|
| iOS Safari, not standalone | A sheet: title [install.ios.title], reason [install.ios.why], three steps [install.ios.step1..3] with the Share icon drawn inline, one button [btn.done] | Only after a verdict has been on screen for 30 s, or on the second visit. Never on first launch, never over the picker, never during loading or an error | Closing or Done snoozes 14 days, status [install.dismissed] |
| Android Chrome and Samsung Internet | A text-style button [install.android.label] in the Today status area, shown only after `beforeinstallprompt` fires, never a modal | Same timing rule | [btn.notNow] hides it for 14 days; `appinstalled` shows [install.android.done] once |
| Standalone, or snoozed | Nothing | | |

The How it works page carries the same steps as plain text, so install help never depends on a prompt appearing.

### 2.4 Update flow
When a new service worker waits: status [ui.update.ready] "A new version is ready." with [btn.refresh]. It does not auto-reload and does not move focus. Offline, the same toast works because the worker is already local.

## 3. Agents page (`/console`, page title "Agents")
Primary question: "Which agent do I want to talk to?" Primary action on each card: [agents.chat.with] ("Chat with Wren"). Sign-in is delayed until here; a signed-out visitor sees S1 (example 04).

### 3.1 Screens and states
| State | What shows | Copy | Region |
|---|---|---|---|
| Signed out | S1 Sign in | [auth.signin.title] "Sign in to Agents", [auth.signin.sub] | `h1` focus |
| Checking | `h1` "Agents" and skeleton cards | [console.checking] | `role="status"` |
| Agent list (200) | `h1` [agents.title], sub [agents.sub], cards | | |
| No agents returned | Message | [agents.empty] with [btn.tryAgain] | status |
| 403 | S6 | [console.noaccess.title], [console.noaccess.body], [console.noaccess.other], [btn.signOut], [btn.backToBeach] | `h1` focus |
| 503 | Message and [btn.tryAgain] | [console.check.failed] | `role="alert"` |
| 401, any code but `step_up_required` | S1 | [console.session.expired] | `h1` focus |
| Offline | Normal network failure, not the beach shell | [auth.error.network] with [btn.tryAgain] | alert |

Never show "no access" for a 503. The 403 screen makes no further Console calls.

### 3.2 Agent card content
Each card is an `<article>`. Its heading level follows the page outline (`h2` under the page `h1`). The knowledge list is a native `<details>` whose `<summary>` is the counts line [agents.knowledge.counts]; skills sit inside the body. The brand link is a sibling `.brand` of the nav list, not part of it. Fields come from `GET /api/agents` (no `systemPrompt`).

| Part | Source field | Rendered as |
|---|---|---|
| Heading | `persona` | `h2`, "Wren" |
| Role | `name` | Secondary text, "ux-designer-apple-hig" (monospace is fine) |
| One-line character | `personality` (fallback `description`) | Body text, 2 lines, wraps (no clamp that hides it from screen readers) |
| Model | `modelLabel` | Text badge [agents.model] + "Sonnet". Colour never carries the meaning |
| Colour | `color` | Decorative left rule or dot, `aria-hidden`; contrast is not required for it |
| Knowledge summary | `knowledge.docs.length`, `knowledge.examples.length` | [agents.knowledge.counts] "6 reference notes, 4 examples" |
| Knowledge list | `knowledge.title`, `docs[].title`, `examples[].title` | A native `<details>` (summary = the counts line; no custom `aria-expanded` needed). Opens two short lists under [agents.knowledge.docs] and [agents.knowledge.examples]. Closed by default |
| Skills | `skills[]` | Inside the same disclosure, under [agents.skills], one line of names |
| Action | | Button [agents.chat.with], 44 px, the one prominent button on the card |

Order: as served (sorted by name). One disclosure per card; opening one does not close another. Cards stack in a single column; at 320 px nothing scrolls sideways. A card with no `knowledge` (should not occur, the build fails first) hides the knowledge rows.

### 3.3 Chat, proposals, approve
Chat, proposal cards, the confirm sheet, the step-up and every cap and error message are specified in examples 03 and 04. New ids for the build: chat labels and states [agents.chat.*], proposal parts [agents.proposal.*], sheet text [agents.sheet.*], menu [agents.menu.security], back link [agents.back]. Plain-text chat output only (`white-space: pre-wrap`, `textContent`), no Markdown. After sending, focus stays in the composer. A streaming reply sets `aria-busy="true"` on its bubble until done; [agents.chat.thinking] is the status while it works. A stopped stream shows [agents.chat.interrupted]; a failed send keeps the draft and shows [agents.chat.failed].

## 4. Account flows
S1 to S12 are exactly as in example 04, with the three wording changes in §0 and §9. One reminder for Remy-B and Cass: after a route change focus goes to the new `h1`; after a wrong password focus returns to the password field with the text selected; `401 step_up_required` reopens the confirm sheet and is never "Session ended".

## 5. Resources page
`h1` "Resources". Intro line: "The sources behind Beach Day." Each group is an `h2` followed by a `<ul>` of links. Each item is: link text (the label), then one short sentence on why it matters. External links follow the rules in §1.1.
Status column: **ok** = opened this session (only GitHub could be reached). **not re-checked** = the network was blocked on 2026-11-23, so the link is copied from the project docs and has not been opened by Wren. W2: render the "not re-checked" status as nothing on the page; keep it in this table for the next link check.

### 5.1 Safety and conditions (link-outs, never scored)
| Label | URL | Why | Status |
|---|---|---|---|
| NWS Miami beach forecast | https://www.weather.gov/beach/mfl | Rip-current risk for Miami-area beaches | not re-checked |
| NWS Miami Surf Zone Forecast | https://forecast.weather.gov/product.php?site=mfl&product=srf&issuedby=mfl | The written surf and rip-current outlook | not re-checked |
| NWS Key West | https://www.weather.gov/key/ | Rip-current and marine info for the Keys | not re-checked |
| NWS rip current forecasts | https://www.weather.gov/safety/ripcurrent-forecasts | How the risk levels work | not re-checked |
| NWS lightning safety | https://www.weather.gov/safety/lightning-safety-overview | Why thunder ends the beach day | not re-checked |
| NWS heat index | https://www.weather.gov/safety/heat-index | Where the heat limit comes from | not re-checked |
| NWS Beaufort scale (Miami) | https://www.weather.gov/mfl/beaufort | Where the wind limits come from | not re-checked |
| Florida beach warning flags | https://floridadep.gov/rcp/fcmp/content/beach-warning-flag-program | What each flag color means | not re-checked |
| Florida Healthy Beaches (water quality) | https://www.floridahealth.gov/community-environmental-public-health/environmental-public-health/water-quality/beach-water-quality/ | Bacteria sampling by beach | not re-checked |
| FWC red tide status | https://myfwc.com/research/redtide/statewide/ | Current red tide reports | not re-checked |
| FWC red tide current status map | https://gis.myfwc.com/redtidecurrentstatus/ | Map of the latest samples | not re-checked |
| USF Sargassum Watch | https://optics.marine.usf.edu/projects/saws.html | Seaweed outlook for the coast | not re-checked |
| NOAA Tides and Currents | https://tidesandcurrents.noaa.gov/ | Tide times (Beach Day does not score tides) | not re-checked; added by Wren, not cited in docs |
| EPA UV index scale | https://www.epa.gov/sunsafety/uv-index-scale-1 | What the UV numbers mean | not re-checked |

### 5.2 Weather data
| Label | URL | Why | Status |
|---|---|---|---|
| Open-Meteo Forecast API | https://open-meteo.com/en/docs | The forecast Beach Day reads | not re-checked |
| Open-Meteo Marine API | https://open-meteo.com/en/docs/marine-weather-api | Waves and sea temperature | not re-checked |
| Open-Meteo licence (CC BY 4.0) | https://open-meteo.com/en/licence | Why the credit is on every page | not re-checked |
| Open-Meteo terms | https://open-meteo.com/en/terms | Free use rules | not re-checked |
| Open-Meteo | https://open-meteo.com/ | Weather data by Open-Meteo.com | not re-checked |
| Free API directory | https://mcp-api.netlify.app/ | Where the keyless Open-Meteo pick came from | not re-checked |
| Open-Meteo pricing | https://open-meteo.com/en/pricing | Why the free, keyless use is non-commercial | not re-checked; added by Wren from the project docs |

### 5.3 Hosting and build (Netlify)
| Label | URL | Why | Status |
|---|---|---|---|
| Netlify functions configuration | https://docs.netlify.com/build/functions/configuration/ | Timeouts and routes for the Agents functions | not re-checked |
| Netlify functions API | https://docs.netlify.com/build/functions/api/ | Handler shape and streaming | not re-checked |
| Netlify background functions | https://docs.netlify.com/build/functions/background-functions/ | Long agent jobs | not re-checked |
| Netlify environment variables | https://docs.netlify.com/build/environment-variables/get-started/ | Where keys live, never in the repo | not re-checked |
| Netlify secrets controller | https://docs.netlify.com/build/environment-variables/secrets-controller/ | Marking a value secret | not re-checked |
| Netlify Blobs | https://docs.netlify.com/build/data-and-storage/netlify-blobs/ | Counters and proposals | not re-checked |
| Netlify custom headers | https://docs.netlify.com/manage/routing/headers/ | The security headers file | not re-checked |
| Netlify ignore builds | https://docs.netlify.com/build/configure-builds/ignore-builds/ | Why docs-only commits skip a deploy | not re-checked |
| Netlify file-based configuration | https://docs.netlify.com/build/configure-builds/file-based-configuration/ | `netlify.toml` | not re-checked |
| Netlify deploy overview | https://docs.netlify.com/deploy/deploy-overview/ | Publish, lock and roll back | not re-checked |
| How Netlify credits work | https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/ | Why a deploy costs 15 credits | not re-checked |
| Netlify pricing | https://www.netlify.com/pricing/ | The Free plan limits | not re-checked |
| Netlify rate limiting | https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/ | Why Beach Day counts its own | not re-checked |
| Netlify functions: get started | https://docs.netlify.com/build/functions/get-started/ | How the two server functions are written | not re-checked; added by Wren from the project docs |
| Netlify function environment variables | https://docs.netlify.com/build/functions/environment-variables/ | What functions can read at run time | not re-checked; added by Wren from the project docs |
| Netlify CLI: env commands | https://cli.netlify.com/commands/env/ | Setting variables from the terminal | not re-checked; added by Wren from the project docs |

### 5.4 Accounts (Supabase and Google)
| Label | URL | Why | Status |
|---|---|---|---|
| Supabase password sign-in | https://supabase.com/docs/guides/auth/passwords | Email and password | not re-checked |
| Supabase password security | https://supabase.com/docs/guides/auth/password-security | Length rules and leaked passwords | not re-checked |
| Supabase PKCE flow | https://supabase.com/docs/guides/auth/sessions/pkce-flow | How the sign-in code works | not re-checked |
| Supabase sessions | https://supabase.com/docs/guides/auth/sessions | Session length and refresh | not re-checked |
| Supabase JWTs | https://supabase.com/docs/guides/auth/jwts | What the server checks | not re-checked |
| Supabase signing keys | https://supabase.com/docs/guides/auth/signing-keys | How tokens are verified | not re-checked |
| Supabase Row Level Security | https://supabase.com/docs/guides/database/postgres/row-level-security | Why only you can read your role | not re-checked |
| Supabase column-level security | https://supabase.com/docs/guides/database/postgres/column-level-security | Locking the role column | not re-checked |
| Supabase Sign in with Google | https://supabase.com/docs/guides/auth/social-login/auth-google | Turning on Google | not re-checked |
| Supabase multi-factor (MFA) | https://supabase.com/docs/guides/auth/auth-mfa | The authenticator app | not re-checked |
| Supabase redirect URLs | https://supabase.com/docs/guides/auth/redirect-urls | Where sign-in may return | not re-checked |
| Supabase email templates | https://supabase.com/docs/guides/auth/auth-email-templates | The confirm and reset links | not re-checked |
| Supabase custom SMTP | https://supabase.com/docs/guides/auth/auth-smtp | Sending email to strangers | not re-checked |
| Supabase auth rate limits | https://supabase.com/docs/guides/auth/rate-limits | Why "too many tries" happens | not re-checked |
| Supabase identity linking | https://supabase.com/docs/guides/auth/auth-identity-linking | Email and Google as one account | not re-checked |
| Supabase API keys | https://supabase.com/docs/guides/getting-started/api-keys | Publishable key versus secret key | not re-checked |
| Supabase pricing | https://supabase.com/pricing | Plan limits | not re-checked |
| Google Cloud OAuth credentials | https://console.cloud.google.com/apis/credentials | Where the Google client is created | not re-checked; added by Wren, not cited in docs |

### 5.5 AI and agents
| Label | URL | Why | Status |
|---|---|---|---|
| Anthropic Messages API | https://platform.claude.com/docs/en/api/messages/create | How chat calls Claude | not re-checked |
| Claude models overview | https://platform.claude.com/docs/en/about-claude/models/overview | The three model sizes | not re-checked |
| Tool use overview | https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview | How agents read files and propose changes | not re-checked |
| Streaming | https://platform.claude.com/docs/en/build-with-claude/streaming | Live replies | not re-checked |
| Prompt caching | https://platform.claude.com/docs/en/build-with-claude/prompt-caching | Why long prompts stay affordable | not re-checked |
| API rate limits | https://platform.claude.com/docs/en/api/rate-limits | Usage ceilings | not re-checked |
| Claude Code sub-agents | https://code.claude.com/docs/en/sub-agents | How the agent team is defined | not re-checked |
| Claude Code skills | https://code.claude.com/docs/en/skills | How shared skills are written | not re-checked |
| Anthropic API errors | https://platform.claude.com/docs/en/api/errors | What the chat does when Claude says no or is busy | not re-checked; added by Wren from the project docs |
| Refusals and fallback | https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback | What a refused reply looks like | not re-checked; added by Wren from the project docs |
| Anthropic TypeScript SDK | https://github.com/anthropics/anthropic-sdk-typescript | The client the functions use | not re-checked; added by Wren from the project docs |

### 5.6 GitHub
| Label | URL | Why | Status |
|---|---|---|---|
| Beach Day on GitHub | https://github.com/fenago/BeachDay | The code, docs and decisions | ok (reachable, HTTP 200) |
| Fine-grained personal access tokens | https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens | The one-repo token | not re-checked |
| Permissions for fine-grained tokens | https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens | Contents read and write only | not re-checked |
| Git references | https://docs.github.com/en/rest/git/refs | Moving `main` | not re-checked |
| Git commits | https://docs.github.com/en/rest/git/commits | The one atomic commit | not re-checked |
| Git trees | https://docs.github.com/en/rest/git/trees | Building the commit's files | not re-checked |
| Git blobs | https://docs.github.com/en/rest/git/blobs | File contents | not re-checked |
| GitHub API rate limits | https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api | Read limits | not re-checked |
| Push protection | https://docs.github.com/en/code-security/concepts/secret-security/push-protection | Secret scanning on push | not re-checked |
| GitHub rulesets | https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets | Protecting `main` from force pushes | not re-checked; added by Wren from the project docs |

### 5.7 Installable app (PWA)
| Label | URL | Why | Status |
|---|---|---|---|
| MDN: Making PWAs installable | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable | What makes a site installable | not re-checked |
| MDN: Web app manifest | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest | The manifest fields | not re-checked |
| MDN: PWA caching | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Caching | Offline strategy | not re-checked |
| MDN: beforeinstallprompt | https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event | The Android install button | not re-checked |
| web.dev: Install criteria | https://web.dev/articles/install-criteria | Chrome's rules | not re-checked |
| web.dev: Maskable icons | https://web.dev/articles/maskable-icon | The app icon shape | not re-checked |
| web.dev: Service worker lifecycle | https://web.dev/articles/service-worker-lifecycle | Why updates wait | not re-checked |
| WebKit: Web Push for web apps on iOS | https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/ | What iOS home-screen apps can do | not re-checked |
| WebKit: Updates to storage policy | https://webkit.org/blog/14403/updates-to-storage-policy/ | Why iPhone may forget a site | not re-checked |
| Apple: Configuring web applications | https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html | Home Screen icon and title | not re-checked |
| Chrome: install criteria update | https://developer.chrome.com/blog/update-install-criteria | When Chrome offers to install | not re-checked; added by Wren from the project docs |
| MDN: Manifest icons | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons | The icon sizes the manifest lists | not re-checked; added by Wren from the project docs |
| MDN: Manifest screenshots | https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/screenshots | The richer Android install sheet | not re-checked; added by Wren from the project docs |
| Trusted Web Activity: Bubblewrap | https://github.com/GoogleChromeLabs/bubblewrap | The Play Store path Beach Day did not take | not re-checked; added by Wren from the project docs |
| Capacitor documentation | https://capacitorjs.com/docs | The App Store path Beach Day did not take | not re-checked; added by Wren from the project docs |
| App Store Review Guidelines | https://developer.apple.com/app-store/review/guidelines/ | Why a repackaged website would not pass | not re-checked; added by Wren from the project docs |

### 5.8 Design and accessibility
| Label | URL | Why | Status |
|---|---|---|---|
| Apple Human Interface Guidelines | https://developer.apple.com/design/human-interface-guidelines/ | The design rules the screens follow | not re-checked |
| HIG: Writing | https://developer.apple.com/design/human-interface-guidelines/writing | Why the text is short and plain | not re-checked |
| HIG: Buttons | https://developer.apple.com/design/human-interface-guidelines/buttons | Button names and sizes | not re-checked |
| HIG: Sheets | https://developer.apple.com/design/human-interface-guidelines/sheets | The beach picker and Approve sheets | not re-checked |
| HIG: Managing accounts | https://developer.apple.com/design/human-interface-guidelines/managing-accounts | Why sign-in waits until Agents | not re-checked |
| WCAG 2.2 | https://www.w3.org/TR/WCAG22/ | The accessibility standard | not re-checked |
| WCAG: Accessible authentication | https://www.w3.org/TR/WCAG22/#accessible-authentication-minimum | Why paste and password managers work | not re-checked |
| WCAG: Status messages | https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html | Announced updates | not re-checked |
| WCAG: Target size | https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html | The 44 px targets | not re-checked |
| WAI-ARIA 1.2 | https://www.w3.org/TR/wai-aria-1.2/ | Roles and live regions | not re-checked |
| Playwright documentation | https://playwright.dev/docs/emulation | How the phone layouts are tested | not re-checked |
| WCAG: Use of color | https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html | Why every verdict has a word and an icon | not re-checked; added by Wren from the project docs |
| Playwright: service workers | https://playwright.dev/docs/service-workers | How offline is tested | not re-checked; added by Wren from the project docs |
| Playwright: network | https://playwright.dev/docs/network | How the forecast is faked in tests | not re-checked; added by Wren from the project docs |

### 5.9 This project
| Label | URL | Why | Status |
|---|---|---|---|
| How it works | /how-it-works/ | The scoring in plain words | local |
| Step-by-step guide | /guide/ | How Beach Day was built and deployed | local |

## 6. How it works page: content
`h1` "How it works". Short sections, each an `h2`, plain words, no secrets, no file paths in the body. Reading level: about grade 8.

1. **The short version.** Pick a beach. Beach Day looks at the forecast for the daylight hours, finds the best three hours, and gives one verdict: Great beach day, Good, Fair — pick your hours, or Skip it. It also tells you why.
2. **Where the data comes from.** Weather and sea conditions come from Open-Meteo (free, no account), straight from your phone. Beach Day has no weather server. Link: Open-Meteo, CC BY 4.0.
3. **The beach window.** Only daylight hours count: from one hour after sunrise (but not before 8 am) to half an hour before sunset (but not after 7 pm). For today, hours that have passed are skipped. If fewer than three remain, Beach Day uses what is left and never says better than Good.
4. **Hard stops.** Some conditions set an hour to zero: thunderstorms; the hour right after thunder (the 30-minute rule); too much wind (25 mph, or gusts of 32 mph); dangerous heat (NWS heat index of 103 °F or more). A three-hour window with a stopped hour is not used. A storm later in the day still shows as the first reason.
5. **Penalties.** Each hour starts at 100. Points come off for rain chance, measurable rain, rain type (drizzle, rain, showers), storm risk, cloud cover, how hot or cool it feels, wind, waves offshore and cool water. Rain chance counts, and the wetness (how much, or the type) counts once, with a cap. UV never lowers the score; it becomes sunscreen advice.
6. **The verdict.** The best three-hour average, rounded, then: 80 and up Great beach day; 65 to 79 Good; 45 to 64 Fair — pick your hours; under 45 Skip it. Every verdict has a word, an icon and a colour.
7. **How sure it is.** Beach Day says when waves or water data are missing, when the window is short, and that days four and later are an outlook. It never guesses missing data.
8. **What it does not do.** It does not score rip currents, beach flags, water quality, red tide, sargassum or tides. Those need local, current information. Always check NWS rip-current risk and posted flags. Show the exact safety line [safety.line] in a callout, with the NWS link.
9. **Install it.** The iPhone steps [install.ios.step1..3] and the Android line. Mention that favorites live on your phone and can be lost if Safari clears the site (install to keep them).
10. **Agents (for the team).** A separate page where people with access can chat with the Beach Day agents. An agent can suggest a change, and nothing goes live until a person chooses Approve. Sign-up is open, but only approved accounts can use Agents. No keys or tokens are ever in the page.
11. **How it is built, in plain words.** A static site on Netlify; two small server functions that only talk to Claude and GitHub; the browser talks to Open-Meteo and the sign-in service directly. Link to /guide/.

Scoring numbers on this page come from `public/js/score-config.js`. If Dewey changes a threshold, this page changes with it (review gate: open-meteo-integrator and Wren).

## 7. Guide page: content
`h1` "Step-by-step guide". Intro: "How Beach Day was built and put on the web, in order." An ordered list (`<ol>`) where each step is an `h2` with a short paragraph and, where useful, a code block of a command. Never show a secret, a token, a real project host or a password. Write placeholders like `<your-project-ref>`.

1. **Write the design first.** The decisions live in `docs/` (use case and scoring, installable app, Netlify, Agents, Claude API, testing) and in short decision records (`docs/adr/`). Read `docs/README.md` first.
2. **Set up the agent team.** Twelve specialist agents and their shared skills live in `.claude/agents/` and `.claude/skills/`. Each has its own knowledge folder in `knowledge/`. One agent, the orchestrator, plans and passes work between the others.
3. **Build in waves.** W0 lays the npm and test foundation. W1 builds the pieces that do not depend on each other, in parallel. Each wave ends with read-only reviews by the experts whose area the change touches; owners fix only the required items. W2 builds screens and handlers on W1's output. W3 is the full test run, the local run and the final security review. W4 fixes what they found.
4. **Prove it locally.** Install with `npm ci`. Run the unit tests with `npx vitest run`. Run the phone-sized browser tests with `npx playwright test --trace off`. Serve the whole site with `node tests/harness/server.mjs` (http://127.0.0.1:4173) using fake Supabase, Anthropic and GitHub, so nothing real is called. Prove the Netlify build with `npx netlify build --offline`.
5. **Create the Supabase project and Google sign-in.** Apply `supabase/migrations/20261123000000_profiles.sql` (SQL editor, or `supabase db push`). Turn on Confirm email and Confirm phone, set the minimum password length to 12, add custom SMTP, set the Site URL and Redirect URLs to your production `/console` only, turn anonymous sign-ins off, and keep TOTP on. Create a Google OAuth client and paste its client secret into Supabase only. Details: `docs/04-agent-console.md` §4.5 and `supabase/README.md`.
6. **Connect the repository to Netlify.** New site from Git, branch `main`, publish directory `public`. The build settings are in `netlify.toml`.
7. **Set the Netlify environment variables.** `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` (public by design). `ANTHROPIC_API_KEY` and `GITHUB_TOKEN` as secrets, Production context only. The token is fine-grained, this repo only, Contents read and write, no Workflows. Never put the Supabase secret or service_role key anywhere.
8. **Turn deploy previews off.** In Site settings, Build and deploy, turn off Deploy Previews and branch deploys. Required, because only production should be able to read the secrets.
9. **First deploy.** Push to `main`. Each production deploy costs 15 of 300 monthly credits on the Free plan, so batch changes. Check the site, then run `BASE_URL=https://<your-site> node scripts/smoke.mjs`.
10. **Make yourself super_admin.** Sign up and confirm your email on the live site. Then, in the Supabase SQL editor, run `supabase/manual/promote-super-admin.sql` with your user id. Only a confirmed-email user id. Sign in the way you will normally sign in (email or Google), because they may be separate users until linked.
11. **Run the launch checks, then turn Approve on.** Approve stays off until the Supabase pre-launch tests (a) to (g) in `docs/04-agent-console.md` pass. Then change `approveEnabled` in `netlify/functions/lib/settings.mts` and deploy.
12. **Roll back if needed.** Netlify, Deploys, open the last good deploy, Publish deploy, then Lock to stop auto publishing. It costs 0 credits. Fix forward with `git revert` and unlock. Full steps: `docs/runbooks/rollback.md`.

Honesty rules: step 6 onward are not done until Dr. Lee links a Netlify site (none is linked at the time of writing); the page says "Do this once you have a Netlify account" and does not claim a live URL. Step 11 states plainly that Approve is off by default.

## 8. Usability walk-through (desk check, iPhone 390 px and Pixel 412 px profiles)
Friction found and the fix built into this spec:
1. Four header items at 320 px do not fit on one row. Fix: brand row plus link row (§1.1).
2. Header nav plus a tab bar is two navigation systems. Fix: no tab bar; "Change beach" button (§1.1).
3. The footer safety line is short, so a verdict page might seem to have only the short one. Fix: the full exact line sits under the verdict card (§2).
4. Install sheet on first launch would interrupt the choice of a beach. Fix: timing rule in §2.3.
5. Agent cards with 12 agents and long knowledge lists get tall. Fix: knowledge is a closed disclosure; counts show first (§3.2).
6. "Console" in screen text no longer matches the page name. Fix: strings now say "Agents" (§9).
7. A new account that opens Agents hits "This account can't use Agents" with no way forward except sign out. Fix: S6 says who to ask and offers Back to Beach Day.
8. External links in a standalone app can strand a person outside the app. Fix: open in a new tab, say so in hidden text, and keep the Beach Day link in the footer.
9. Android Chrome in dark mode: verdict colours are Sable's job; the text label carries the meaning in every mode.

## 9. Copy deck: what changed against the knowledge JSON
`public/js/copy/copy-deck.js` is the app's source. `knowledge/.../copy-deck.json` is the older example and is unchanged; a note for Juno to refresh it.
- Text changed for open sign-up, "Agents" and "Sign in": reason.short (usable hours), advice.confidence.medium ("Fairly sure."), auth.signin.title ("Sign in to Agents"), auth.signin.sub ("Chat with the Beach Day agents."), auth.signup.title ("Create an account"), auth.signout.done ("Signed out."), console.error.budget and console.error.budget.nodate ("Agents is at its usage limit for now…").
- New groups: positiveReasons (6), nav and footer (14), ui (32), install (8), agents (34), plus [reason.feels], [reason.water], and buttons [btn.install] [btn.notNow] [btn.done] [btn.send] [btn.showKnowledge] [btn.hideKnowledge] [btn.viewCommit].
- Exports: `t`, `verdictFor`, `STRINGS`, `DECK`, `SAFETY`, `VERDICTS`. No reason or advice helpers (see §2.2). Everything is deep-frozen.
- Lint: the checker from example 02, adapted to read the module (limits unchanged: reasons 36, status 60, buttons 22 and 4 words, others 90; Flesch ≥ 60; banned words; sentence case). 294 strings, PASS.

## 10. Open items and UNVERIFIED
- Heading of the 403 screen: pending Dr. Lee (D4).
- Dewey: confirm nothing emits reason.sunny, reason.wind.light, reason.waves.calm or reason.water.warm after the score.js fix; if so, I drop them.
- Resources links: only GitHub was reachable; every other URL is "not re-checked". Two links were added by Wren and are not in the project docs (NOAA Tides and Currents, Google Cloud credentials). W2 added 21 more rows that the project docs cite (Open-Meteo pricing, Netlify functions, Claude errors, GitHub rulesets, PWA, native-path and Playwright pages), also not re-checked.
- Install-sheet timing (30 s or second visit) is Wren's choice; Pip may adjust with a reason.
- TOTP and 3.3.8, lost-phone recovery, and Google step-up freshness remain as listed in example 04.
