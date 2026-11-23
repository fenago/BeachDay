# Plan: "Add a 7-day view" (worked example)

Goal from Dr. Lee: *"Add a 7-day view so I can see which day this week is best for the beach."*
Prepared by: orchestrator · Date: 2026-11-23 · Status: example (no code exists for this yet)

## 0. Fit check before planning (orchestrator, no delegation)

| Question | Answer | Source |
|---|---|---|
| Does it conflict with an ADR? | No. Data still comes from Open-Meteo in the browser (ADR-0001). No new function, no rip-current data (ADR-0002) | `docs/adr/` |
| Is the data available? | Forecast `forecast_days` allows 0–16; Marine allows 0–8. 7 days fits both | `open-meteo-apis` skill |
| Scoring rule for later days? | Days 4 and later are `confidence: "outlook"`, shown with less emphasis | `beach-day-scoring` skill |
| Deploy cost | Ship as **one** commit (one production deploy = 15 of 300 credits) | ADR-0003, ADR-0004 |
| Needs Dr. Lee? | One product question: does the 7-day list replace "next few days" or sit below it? Asked up front, with a default (replace) so work isn't blocked | — |

## 1. Task graph

```
Wave 1 (parallel, one message, 3 Agent calls)
  T1 ux-designer-apple-hig (Wren) ── flow + copy for the week list
  T2 open-meteo-integrator ───────── scoreWeek() + 7-day fetch + fixtures + unit tests
  T3 software-architect ──────────── interface note: WeekVerdict contract + module boundaries
            │ (T1 done)                 │ (T2, T3 done)
Wave 2      ▼                           │
  T4 ui-designer-apple-liquid-glass (Sable) ── day-row component tokens/CSS
            │ (T3, T4 done)             │
Wave 3      ▼                           ▼
  T5 pwa-mobile-engineer ── week-view.js render module + #/week route + SW cache check
            │
Wave 4      ▼
  T6 qa-engineer ── unit + Playwright (iPhone, Pixel) + axe + offline; release gate
            │
            ▼
  Report to Dr. Lee → Dr. Lee asks for commit → orchestrator commits once
```

Not called, and why (keep the team lean):

| Agent | Why not needed |
|---|---|
| security-engineer | No change to functions, headers, env vars, the Console or the GitHub path. Routed only if T5 touches `public/_headers` |
| netlify-engineer | No `netlify.toml` or function change. Routed only if a HANDOFF says so |
| agent-console-engineer | Console untouched |
| agent-builder | No agent or skill change, unless the post-mortem finds a repeated mistake |

## 2. Task briefs (exact text sent)

### T1 → ux-designer-apple-hig (Wren)
```
TASK: Design the 7-day "best beach day this week" flow and its copy.
WHY: Dr. Lee wants to see which day this week is best for the chosen beach.
CONTEXT: docs/01-use-case-and-scoring.md (screens, §5 scoring), beach-day-scoring skill (verdict table,
  outlook rule for days 4+), ADR-0002 (NWS safety line on every verdict screen).
  Data per day will be: {date, verdict, score, bestWindow{start,end}, reasons[], advice[], confidence}.
SCOPE: docs/design/seven-day-view.md (new).   OUT OF SCOPE: CSS, JS, scoring thresholds.
DONE WHEN: flow covers loading, offline/stale data, missing marine data, "outlook" days, best-day
  highlight that does not rely on colour alone, and the NWS rip-current line; all copy strings listed
  in a table with max lengths; 44 px targets noted.
RETURN: HANDOFF block.
```

### T2 → open-meteo-integrator
```
TASK: Add scoreWeek() and fetch 7 days of forecast + marine data for one beach.
WHY: Feeds the new 7-day view (Dr. Lee request).
CONTEXT: open-meteo-apis + beach-day-scoring skills; existing scoreDay() contract
  {verdict, score, bestWindow, reasons, advice, confidence}. Forecast forecast_days=7,
  Marine forecast_days=7 (always explicit; max 8). SST arrives in °C — convert.
SCOPE: public/js/api/openmeteo.js, public/js/score.js, tests/unit/score-week.test.js,
  tests/fixtures/openmeteo/week-*.json.   OUT OF SCOPE: UI, score-config thresholds.
DONE WHEN: scoreWeek(forecast, marine, beach) returns 7 DayVerdicts in date order; days index >= 3
  have confidence "outlook"; missing marine hours skip wave/water factors and add a reason;
  Vitest boundary tests pass; fixture for a 7-day response saved.
RETURN: HANDOFF block.
```

### T3 → software-architect
```
TASK: Write the interface note for the week view: WeekVerdict shape and module boundaries.
WHY: Lets T2 (data) and T5 (render) build in parallel against one contract.
CONTEXT: docs/03-architecture-netlify.md §2 layout; web-platform-vanilla skill; ADR-0001.
SCOPE: docs/design/seven-day-contract.md (new).   OUT OF SCOPE: code.
DONE WHEN: JSON shape with types/units; which module owns fetch, scoring, rendering; route name;
  cache behaviour (no new function, SW caches per device); no ADR needed or a Proposed ADR drafted.
RETURN: HANDOFF block.
```

T4–T6 briefs follow the same shape. T4 adds Wren's spec path from the T1 HANDOFF. T5 adds T3's contract and T4's CSS paths. T6 adds every file path from T2, T4 and T5.

## 3. HANDOFFs received and how they were routed

```
HANDOFF
status: done
summary: Week list flow + copy. Best day marked with "Best day" text badge + icon, not colour only.
  Outlook days (Thu–Sat) use lighter weight and an "Outlook" label. NWS line pinned under the list.
files: docs/design/seven-day-view.md
tests: n/a (design); copy lengths checked against 320 px width mock
needs: ui-designer-apple-liquid-glass — day-row and "Best day" badge visuals; open-meteo-integrator —
  confirm reasons[] max 3 so rows don't wrap past 2 lines
risks/questions: Dr. Lee — should tapping a day open the hourly view (not built yet)? Default: no tap.
```
**Routing:** Sable → T4 (brief includes `docs/design/seven-day-view.md`). The reasons[] question goes into T2's follow-up via `SendMessage` to the running integrator, not a new spawn. Dr. Lee's question goes in the report with the default.

```
HANDOFF
status: done
summary: scoreWeek() added; 7-day fetch with forecast_days=7 on both APIs; outlook rule for days 4+;
  reasons capped at 3 per Wren. 38 unit tests incl. boundaries.
files: public/js/api/openmeteo.js, public/js/score.js, tests/unit/score-week.test.js,
  tests/fixtures/openmeteo/week-calm.json, tests/fixtures/openmeteo/week-storm.json
tests: npx vitest run — 38 passed, 0 failed
needs: none
risks/questions: Marine API returned 7×24 hours; Forecast request asks 13 hourly + 5 daily vars (>10, so
  Open-Meteo counts it as more than one call). Still far inside 10k/day.
```
**Routing:** no `needs`. Recorded for T6 (QA gets all file paths). The call-count note goes in the report.

```
HANDOFF
status: needs-review
summary: Contract note written. WeekVerdict = DayVerdict[7]; route #/week; render in public/js/ui/week-view.js;
  no new dependency; no ADR needed.
files: docs/design/seven-day-contract.md
tests: n/a
needs: pwa-mobile-engineer — check SW runtime cache max-age still fits a 7-day response
risks/questions: none
```
**Routing:** "needs-review" plus a pwa-mobile-engineer request. Folded into the T5 brief, because T5 is already pwa-mobile-engineer's task.

(T4, T5 and T6 HANDOFFs follow. T6 is the gate. If QA reports `status: blocked`, for example "axe: Outlook label contrast 3.9:1", the orchestrator routes the fix to Sable with the exact failure and re-runs only the failing QA spec.)

## 4. Gates applied (change-proposal-protocol)

| Changed path | Gate | Satisfied by |
|---|---|---|
| `public/js/score.js` (reasons/outlook wording) | open-meteo-integrator + Wren | T2 author + T1 review of copy |
| `public/css/*` tokens/components | Sable + QA a11y | T4 + T6 axe |
| `public/sw.js` (only if T5 changes it) | pwa-mobile-engineer + QA offline | T5 + T6 offline spec |
| anything to production | qa-engineer green | T6 |

## 5. Report to Dr. Lee (template)

- **Done:** 7-day list with a best-day highlight, outlook days, offline state and the NWS line.
- **Verified:** Vitest 38/38; Playwright iPhone + Pixel; axe 0 violations; offline spec. These numbers are quoted only from HANDOFFs that show the runs.
- **Open questions:** tap-to-hourly? (default: no).
- **Decision needed:** commit now as **one** commit (1 deploy, 15 credits)?
