# Post-mortem: the safety line went missing from the 7-day list

Status: example post-mortem (illustrative incident, realistic fix) · Author: agent-builder · Date: 2026-11-23

## 1. What happened

During the "add a 7-day view" task (see `knowledge/orchestrator/examples/01-seven-day-view-plan/`), Wren's first spec (`ux-week-v1.md`) put the NWS safety line only on the **Today** screen. The seven day rows showed "Great beach day" with no safety line or link anywhere on the week list. QA's review caught it before anything shipped. One round trip was lost; there was no user impact.

## 2. Why it matters

ADR-0002 accepts that "The verdict can say 'Great' on a high-rip-risk day, so the safety link and wording must be prominent." A verdict without the line is the exact risk the ADR names.

## 3. Root cause

agent-builder's four buckets (from the agent-builder prompt): missing fact / unclear rule / wrong tools / too much context.

| Candidate | Evidence | Verdict |
|---|---|---|
| Missing fact | Wren preloads `beach-day-scoring`, which contains the line, and Wren's body quotes it | No |
| Wrong tools | Not a tool problem | No |
| Too much context | `beach-day-scoring` is 67 lines, far below the 5,000 tokens kept after compaction | No |
| **Unclear rule** | The skill says: "Every verdict **screen** includes: 'Beach Day is not a safety service ...'". Wren's HANDOFF reasoning: "the week list is a section of Home, and the verdict screen is Today". The word "screen" let a list of verdicts fall outside the rule | **Yes** |

Secondary: the rule sits at the **end** of the skill, after the tables, and gives no reason. Prompting guidance says to explain why ("Claude can generalize from the explanation") and to put the most important instructions near the top.

## 4. Fix: the smallest change, in the shared skill

Fixing one agent's prompt wouldn't be enough. open-meteo-integrator (reason strings) and qa-engineer (checks) read the same skill, so the fix goes in `beach-day-scoring`, which all three preload. This follows the agent-builder rule: "prefer the shared skill over one agent's prompt".

**Before** (last lines of `.claude/skills/beach-day-scoring/SKILL.md`):

```markdown
Every verdict screen includes: "Beach Day is not a safety service — check NWS rip-current risk and posted beach flags."
```

**After** (moved to directly under the `# Beach-day scoring` heading):

```markdown
## Always: the safety line goes with every verdict
Wherever a verdict appears (screen, list row, card, share text, notification), the same view shows
"Beach Day is not a safety service — check NWS rip-current risk and posted beach flags." with the NWS link.
Why: verdicts ignore rip currents and flags (ADR-0002), so a "Great" day can still be dangerous.
```

What changed, and why each part helps:

| Change | Why |
|---|---|
| "screen" → "Wherever a verdict appears (screen, list row, card, share text, notification)" | Removes the loophole by listing the surfaces explicitly |
| Added a one-line **Why** tied to ADR-0002 | Gives Claude the reason, so it generalizes to surfaces not on the list |
| Moved to the top under an "Always" heading | Standing rules first; survives compaction truncation |
| Kept calm wording (no CRITICAL/MUST) | Current models over-trigger on aggressive wording; the rule is clear without it |
| Didn't touch Wren's body | Wren already quotes the line; the scope question lived in the skill |

## 5. Verification

1. **Re-run the scenario.** Send Wren the same T1 brief and check the new spec. A deterministic end-state check, `check-safety-line.mjs`, scans a UX spec: every section that shows a verdict label must also include the safety line or reference it.
2. **Regression.** Run the same check on the Today spec, which must still pass.
3. **Lint.** Run `lint-agents.mjs` from example 02 after editing the skill: 0 errors.
4. **Gate.** This is a `.claude/skills/**` change, so agent-builder + orchestrator review it. open-meteo-integrator and Wren review it under the verdict-wording gate.

The check was run against the two spec excerpts in this folder; see README `## Verified`. Re-running Wren itself needs a live model session and was not done here.

## 6. Follow-ups

- Report to the orchestrator: a proposed edit to `beach-day-scoring`. Dr. Lee approves the commit, so the skill is **not** edited in this example.
- Note in agent-builder memory: "Rules phrased by surface ('screen') get read narrowly. Phrase them by data ('wherever a verdict appears')."
