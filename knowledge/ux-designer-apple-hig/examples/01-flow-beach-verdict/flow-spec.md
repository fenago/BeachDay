# UX flow: pick a beach → today's verdict → day detail
Owner: Wren · Status: example spec · Date: 2026-11-23
Follows: HIG (docs/01–06), ADR-0001 (browser calls Open-Meteo directly), ADR-0002 (rip currents are link-outs, never scored), beach-day-scoring skill (verdict bands and reasons).

## 0. Principles for this flow
- One primary question per screen, answer first (HIG "Order content by relative importance").
- Every state is designed: loading, empty, error, offline, stale, partial.
- Verdict = color + icon + text. The safety line is on every verdict screen.
- 44×44 px targets. Every gesture has a button. Status changes use `role="status"`.
- No alert at launch, no onboarding carousel, no permission prompt until the user taps "Nearest".

## 1. Steps
| # | User does | App does | Screen |
|---|---|---|---|
| 1 | Opens Beach Day for the first time | No saved beach → shows the picker as the first screen | S1 |
| 2 | Taps "Hollywood Beach" (or "Use Nearest Beach") | Saves the beach (localStorage), fetches Forecast + Marine from Open-Meteo in the browser, shows the Today skeleton at once | S2 → S3 |
| 3 | Reads the verdict, best hours, reasons | — | S3 |
| 4 | Taps a day in "Next days" | Opens day detail (hash route `#/day/YYYY-MM-DD`) | S4 |
| 5 | Taps "Hourly" in day detail | Expands the hourly list in place (progressive disclosure) | S4 expanded |
| 6 | Back (button, browser back, or edge swipe) | Returns to Today, keeping its scroll position | S3 |
| later | Opens the app again | Restores the last beach and goes straight to Today; shows cached data first, then refreshes | S3 |

## 2. Screens (text wireframes, 390 px wide)

### S1 Choose a beach (first launch; later shown as a sheet from the top bar)
```
┌──────────────────────────────────────┐
│ Choose a Beach                        │  h1, large title
│ Pick one to see today's beach verdict.│  subhead
│ ┌──────────────────────────────────┐ │
│ │ ◎ Use Nearest Beach              │ │  button, 44px; asks location on tap
│ └──────────────────────────────────┘ │
│ MIAMI-DADE                            │  list section header
│  Miami Beach (South Beach)        ›   │  row, 44px+
│  Key Biscayne (Crandon Park)      ›   │
│ BROWARD                               │
│  Hollywood Beach                  ›   │
│  Fort Lauderdale Beach            ›   │
│ MONROE                                │
│  Key West (Smathers Beach)        ›   │
└──────────────────────────────────────┘
```
- Choosing a row completes the task, so there is no Done button. As a sheet (later visits) it has **Cancel** on the leading edge, a grabber, and the medium detent.
- "Use Nearest Beach": on denial or error, show an inline status "Location is off. Choose a beach from the list." and keep focus on the list. No alert.
- **Empty favorites** (Beaches tab, before any star): "No favorite beaches yet. Tap the star on a beach to keep it here." plus a [Choose Beach] button (HIG: blank screens give a next step).

### S2 Today: loading (first fetch, no cache)
```
┌──────────────────────────────────────┐
│ Hollywood Beach                 [⟳]  │  glass top bar; refresh 44px
│ Getting the forecast…                │  role="status"
│ ┌──────────────────────────────────┐ │
│ │ ▒▒▒▒▒▒▒▒▒▒▒▒                      │ │  skeleton verdict card
│ │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒             │ │  (static shimmer-free blocks
│ │ ▒▒▒▒▒▒▒▒                          │ │   when reduced motion)
│ └──────────────────────────────────┘ │
│ Beach Day is not a safety service —  │  safety line visible even while
│ check NWS rip-current risk and       │  loading; link to NWS office
│ posted beach flags.                  │
└──────────────────────────────────────┘
```
- The skeleton has `aria-hidden="true"`. The status line carries the announcement.
- At > 10 s with no response: status changes to "Still getting the forecast…" and a [Try Again] button appears. The fetch timeout is 15 s, after which it moves to the error state.

### S3 Today: success (the main screen)
```
┌──────────────────────────────────────┐
│ Hollywood Beach                 [⟳]  │
│ Updated 8:15 am                      │  role="status"
│ ┌──────────────────────────────────┐ │
│ │ Today · Sun 23 Nov               │ │
│ │ GREAT BEACH DAY                  │ │  h2, 34px bold
│ │ [☀ Great beach day]              │ │  chip: color+icon+text
│ │ Best hours 10 am – 1 pm          │ │
│ │ • Sunny, feels like 84 °F        │ │  top 3–4 reasons
│ │ • Light wind, 8 mph              │ │
│ │ • Offshore waves under 2 ft      │ │
│ │ UV very high — sunscreen, shade  │ │  advice (not scored)
│ │ 10 am–4 pm                       │ │
│ │ [ See Hourly ]                   │ │  the one prominent button
│ └──────────────────────────────────┘ │
│ ⚠ Beach Day is not a safety service —│  prominent, above the fold
│ check NWS rip-current risk and       │  link: weather.gov/beach/mfl
│ posted beach flags.                  │  (Key West: weather.gov/key/)
│ Next days                            │  h2
│  Mon [⛅ Good]                     ›  │  rows → S4
│  Tue [☁ Fair — pick your hours]   ›  │
│  Wed [⛈ Skip it]                  ›  │
│  Thu–Sat (outlook, lighter style) ›  │  confidence: "outlook"
│ Weather data by Open-Meteo.com       │  attribution, always visible
│ ─────────────────────────────────── │
│ [ Today ]        [ Beaches ]         │  tab bar, labels + icons
└──────────────────────────────────────┘
```
- Heading order: h1 (beach name) → h2 (Today verdict) → h2 (Next days).
- A refresh doesn't move focus; only the status line updates ("Updated 9:02 am").

### S4 Day detail (`#/day/2026-11-25`)
```
┌──────────────────────────────────────┐
│ ‹ Today       Tue 25 Nov             │  back button 44px, labeled "Today"
│ [☁ Fair — pick your hours]           │
│ Best hours 8 am – 11 am              │
│ Why:                                 │
│ • Storms possible after 2 pm         │
│ • Breezy, 18 mph                     │
│ • Waves 3–5 ft offshore              │
│ [ Show Hourly ]  ▾                   │  aria-expanded false/true
│  8 am  ☀  82°  wind 9   ○ good       │  hourly rows when expanded
│  9 am  ☀  83°  wind 11  ○ good       │  each row: icon + text, no color-only dots
│  …                                   │
│ ⚠ Beach Day is not a safety service —│
│ check NWS rip-current risk and       │
│ posted beach flags.                  │
│ Weather data by Open-Meteo.com       │
└──────────────────────────────────────┘
```
- Previous and next day: [‹ Mon] [Wed ›] buttons at the bottom. Horizontal swipe is an optional extra.

## 3. State matrix (Today; day detail inherits it)
| State | Trigger | What shows | Status text (`role="status"` unless noted) | Actions |
|---|---|---|---|---|
| Loading, no cache | First fetch | Skeleton + safety line | "Getting the forecast…" | — (Try Again after 10 s) |
| Success | Both APIs OK | S3 | "Updated 8:15 am" | Refresh, See Hourly |
| **Partial** | Marine API fails, Forecast OK | Verdict from weather only; wave and water-temperature reasons hidden | "Couldn't load waves. Verdict uses weather only." | Try Again |
| **Error**, no cache | Forecast fails or times out | No verdict card; message card | `role="alert"`: "Couldn't get the forecast. Check your connection and try again." | [Try Again] focused |
| **Offline** with cache | `navigator.onLine` false or fetch fails while cache exists | Cached verdict, dimmed "as of" label | "Offline — showing 8:15 am forecast" | Refresh (disabled with a reason until online) |
| Offline, no cache | Same, no cache | Message card | `role="alert"`: "You're offline. Connect to get the forecast." | Try Again |
| **Stale** | Cached data > 3 h old (online or not) | Cached verdict + stale banner above the card | "Forecast is 3 hours old. Getting a new one…" then "Updated 11:20 am" | Refresh |
| Stale, too old | Cache > 24 h | No verdict (don't show yesterday's answer as today) | "Forecast is out of date. Connect to update." | Try Again |
| **Empty** | No beach chosen | S1 picker | — | Choose beach |
| Outlook days | Day 4+ | Lighter rows, "Outlook" tag | — | Opens S4 with an "Outlook — less certain" note |
| Night / outside window | After the beach window closes | Verdict switches to tomorrow | "Beach hours are over for today. Here is tomorrow." | — |

Rules:
- Never show a verdict built from data older than 24 h.
- Never guess missing marine data (scoring skill).
- The safety line and the Open-Meteo attribution appear in **every** state that shows weather data.

## 4. Accessibility checklist for this flow
- [ ] One `h1` per view; landmarks `header`, `main`, `nav` (tab bar).
- [ ] Verdict chip text is the accessible name; the icon is `aria-hidden`.
- [ ] Status line is a single persistent `role="status"` element, present on load.
- [ ] Errors that block the task use `role="alert"`; focus moves to [Try Again] only when there's nothing else useful on screen.
- [ ] Back, refresh, sheet close, tabs: all ≥ 44×44 px, keyboard-operable, visible focus.
- [ ] Units read correctly ("84 degrees Fahrenheit" via visually hidden text).
- [ ] Works at 320 px wide and at 200% text size: day rows stack chip under the day name.

## 5. Friction found in a walkthrough (iPhone 390 px and Pixel 412 px profiles, desk-check)
1. On first launch, the location prompt would appear before any context. **Fix:** location is asked only after tapping "Use Nearest Beach".
2. The safety line sat below "Next days" and was off-screen on small phones. **Fix:** moved directly under the verdict card (ADR-0002 says it must be prominent).
3. "Fair" alone read like a positive word. **Fix:** label "Fair — pick your hours" plus best hours.
4. Stale cache from yesterday showed a confident "Great". **Fix:** 24 h hard limit; 3 h stale banner.
