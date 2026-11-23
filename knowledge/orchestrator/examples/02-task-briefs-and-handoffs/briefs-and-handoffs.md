# Three good task briefs and the HANDOFFs they produced

Each brief follows `team-protocol` (TASK / WHY / CONTEXT / SCOPE + OUT OF SCOPE / DONE WHEN / RETURN). It also carries the four things Anthropic's Research-system post says every subagent needs: an objective, an output format, guidance on tools and sources, and clear task boundaries.

## Brief 1 → open-meteo-integrator (build task, testable)

```
TASK: Make the scorer treat a missing marine hour as "unknown", not as calm seas.
WHY: Dr. Lee saw "Great beach day" for Jupiter when the Marine API returned null wave_height for
  the afternoon. Missing data must not improve a score (beach-day-scoring: "skip those factors and say so").
CONTEXT: beach-day-scoring skill (penalties table, "Missing marine data"); open-meteo-apis skill
  (nulls in hourly arrays); fixture to add: tests/fixtures/openmeteo/marine-nulls.json (copy of
  week-calm.json with wave_height = null for 12:00–17:00).
SCOPE: public/js/score.js, tests/unit/score.test.js, tests/fixtures/openmeteo/marine-nulls.json
OUT OF SCOPE: thresholds in score-config.js, UI copy, any other fixture.
DONE WHEN: scoreHour() skips wave and water penalties when the value is null/undefined and adds reason
  "Wave data unavailable" once per day; existing tests still pass; new tests cover null, undefined
  and 0 (0 is real data, not missing); npx vitest run is green.
RETURN: HANDOFF block. List the test command and counts.
```

```
HANDOFF
status: done
summary: scoreHour() now treats null/undefined wave_height and sea_surface_temperature as missing:
  no wave/water penalty, and scoreDay() adds "Wave data unavailable" once. 0 ft is still scored.
files: public/js/score.js, tests/unit/score.test.js, tests/fixtures/openmeteo/marine-nulls.json
tests: npx vitest run tests/unit/score.test.js — 41 passed, 0 failed (3 new)
needs: ux-designer-apple-hig — confirm wording "Wave data unavailable" (verdict wording gate)
risks/questions: none
```

## Brief 2 → security-engineer (review task, can block)

```
TASK: Review the proposed change to netlify/functions/lib/allowlist.mts that adds "public/data/**".
WHY: agent-console-engineer wants agents to propose beach-list JSON edits through the Console.
CONTEXT: docs/04-agent-console.md §3 (threat model) and §6 (allow-list rules); ADR-0005 (PAT can't be
  path-limited, so the allow-list is the control); diff at docs/design/allowlist-public-data.diff.
SCOPE: read-only review; write findings to docs/design/allowlist-public-data-review.md.
OUT OF SCOPE: editing allowlist.mts yourself; changing the PAT or Netlify settings.
DONE WHEN: verdict approve / approve-with-changes / block, with reasons tied to threats in §3; checks
  that DENY still wins, path normalisation still rejects "..", and tests cover the new pattern.
RETURN: HANDOFF block. If you block, say exactly what would unblock it.
```

```
HANDOFF
status: blocked
summary: Blocking. The new ALLOW entry "public/data/**" also matches "public/data/../../netlify/x" before
  normalisation in the proposed order of checks. Normalise first, then match; add tests for ".." and
  encoded "%2e%2e" paths.
files: docs/design/allowlist-public-data-review.md
tests: read the existing tests (tests/unit/allowlist.test.js, 22 cases); none cover the new pattern
needs: agent-console-engineer — reorder normalise → DENY → ALLOW and add the two traversal tests;
  netlify-engineer — second review once fixed (functions gate)
risks/questions: Dr. Lee — adding public/data/** widens what the Console can change; confirm you want it.
```

## Brief 3 → ux-designer-apple-hig (Wren) (design task, non-code output)

```
TASK: Write the copy and states for the Console's Approve button flow (idle → confirming → committing →
  deploying → live / failed / stale).
WHY: ADR-0003 commits straight to main, so the human review in the Console is the main safety control;
  the button must make that consequence obvious.
CONTEXT: docs/04-agent-console.md §1 (user flow) and §7 (stale/409 handling); ADR-0003; accessibility-wcag22
  skill (status messages, accessible auth for re-auth).
SCOPE: docs/design/console-approve-flow.md (new).   OUT OF SCOPE: code, CSS, endpoint changes.
DONE WHEN: every state has visible text + screen-reader announcement; the confirm step names the branch
  ("main") and the number of files; the stale state tells the user what happens next; re-auth allows paste.
RETURN: HANDOFF block.
```

```
HANDOFF
status: needs-review
summary: Seven states specified with copy, focus order and live-region text. Confirm sheet reads
  "Commit 3 files to main and deploy to production?" Stale state offers "Ask agent to refresh".
files: docs/design/console-approve-flow.md
tests: n/a (design); copy checked at 320 px width; contrast to be checked by QA once styled
needs: ui-designer-apple-liquid-glass — visual states for the sheet; agent-console-engineer — confirm the
  stale/409 path returns enough info to show the file names
risks/questions: none
```

## How the orchestrator routed these

| HANDOFF | Routed to | What the next brief carried |
|---|---|---|
| 1 (done, needs Wren) | ux-designer-apple-hig | The exact string "Wave data unavailable" plus the scoring-wording gate. No re-brief of the whole task |
| 2 (blocked) | agent-console-engineer, then netlify-engineer | The blocking finding verbatim, the two required tests, and the review file path. Dr. Lee's scope question went in the report |
| 3 (needs-review) | ui-designer-apple-liquid-glass and agent-console-engineer, in parallel (independent) | The spec path; for the engineer, only the stale/409 question |
