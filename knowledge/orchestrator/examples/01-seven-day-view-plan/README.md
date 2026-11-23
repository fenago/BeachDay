# Example 01: Worked plan for "add a 7-day view"

## What it demonstrates

`plan.md` is the orchestrator's full plan for one realistic Dr. Lee request:

1. A **fit check** before delegating: ADRs, data limits, the scoring "outlook" rule, deploy cost, and the one product question for Dr. Lee (asked with a default so work isn't blocked).
2. A **task graph** with waves: three independent experts in parallel (Wren, open-meteo-integrator, software-architect), then Sable, then the builder, then QA.
3. **Which experts are not called, and why.** "Keep the team lean" is part of the orchestrator prompt.
4. The **exact task briefs** for the first wave.
5. **Three HANDOFFs received** and how each `needs:` line was routed. One goes to a new task, one is folded into a running expert via `SendMessage`, one is folded into a later brief.
6. The **review gates** that apply to each changed path, and the **report** to Dr. Lee.

## Why this is "what good looks like"

- **Parallel where independent, sequential where dependent.** Wave 1 has no shared files, so it is one message with three Agent calls. Sable waits for Wren's flow; the builder waits for the contract and CSS. This follows CLAUDE.md ("UX → UI → architect check → builders → QA") and the docs' "chain subagents" pattern.
- **Respects every ADR:**
  - no new function (ADR-0001);
  - the NWS line stays (ADR-0002);
  - one commit equals one deploy (ADR-0003/0004);
  - Console and GitHub paths are untouched (ADR-0005).
- **Briefs are self-contained**, because experts start with a fresh context (doc 01).
- **Gates and "done" are explicit.** The report quotes only test results that appear in HANDOFFs.

## How to run

This is a planning artifact, not code. Its HANDOFF blocks are machine-checked by the validator in example 02:

```bash
cd knowledge/orchestrator/examples
node 02-task-briefs-and-handoffs/validate-handoff.mjs 01-seven-day-view-plan/plan.md
```

## Verified

```
$ node 02-task-briefs-and-handoffs/validate-handoff.mjs 01-seven-day-view-plan/plan.md
ok      01-seven-day-view-plan/plan.md:93 [status=done]
ok      01-seven-day-view-plan/plan.md:106 [status=done]
ok      01-seven-day-view-plan/plan.md:120 [status=needs-review]

3 block(s) checked, 0 problem(s)
```

The file paths, test counts and HANDOFF contents in the plan are illustrative. No `public/` code exists in the repo yet. The Open-Meteo limits quoted (`forecast_days` 0–16 and 0–8, calls with more than 10 variables) come from the repo's `open-meteo-apis` skill and were not re-checked against open-meteo.com for this example.
