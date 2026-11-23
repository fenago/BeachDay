# Example 03: Before/after prompt-improvement post-mortem

## What it demonstrates

`postmortem.md` is a complete agent-builder post-mortem for one failure: the NWS safety line went missing from the 7-day list. It covers:

1. what happened and why it matters (ADR-0002);
2. root cause, ruling each of agent-builder's four buckets in or out (missing fact, unclear rule, wrong tools, too much context);
3. the **smallest fix in the right place**: the shared `beach-day-scoring` skill, not one agent's body;
4. exact **before/after** text, with a reason for each change taken from the prompting docs;
5. verification with a deterministic end-state check, plus the review gates that apply.

`check-safety-line.mjs` is a dependency-free checker. Every `## ` section of a UX spec that shows a verdict label must also contain the safety line. `samples/ux-week-v1.md` (before) and `samples/ux-week-v2.md` (after) are the spec excerpts it runs on.

## Why this is "what good looks like"

- **Diagnose before editing.** The incident is pinned to one ambiguous word ("screen"). The rule existed; it wasn't missing.
- **Fix where every affected agent reads it.** Wren, open-meteo-integrator and qa-engineer all preload `beach-day-scoring`.
- **Apply the docs' guidance:**
  - explain the why ("Claude can generalize from the explanation");
  - put standing rules at the top (only the start of a skill survives compaction);
  - use calm wording instead of CRITICAL/MUST (current models over-trigger).
- **Verify the end state, not the process.** This follows Anthropic's multi-agent guidance to evaluate "whether it achieved the correct final state". The checker turns a judgement call into a repeatable test QA can reuse.
- **Propose, don't edit.** The skill change goes through the orchestrator and Dr. Lee, per change-proposal-protocol and the `.claude/skills/**` review gate.

## How to run

```bash
cd knowledge/agent-builder/examples/03-prompt-postmortem
node check-safety-line.mjs samples/ux-week-v1.md   # before: expected FAIL, exit 1
node check-safety-line.mjs samples/ux-week-v2.md   # after: expected ok, exit 0
```

## Verified

Run on 2026-11-23, Node v22.23.5:

```
$ node check-safety-line.mjs samples/ux-week-v1.md
ok   samples/ux-week-v1.md § Today
FAIL samples/ux-week-v1.md § Week list — verdicts shown without the safety line
exit=1
$ node check-safety-line.mjs samples/ux-week-v2.md
ok   samples/ux-week-v2.md § Today
ok   samples/ux-week-v2.md § Week list
exit=0
```

Not run: re-running Wren on the brief with the edited skill, which needs a live Claude Code session. The incident is illustrative. The "before" text is the real last line of `.claude/skills/beach-day-scoring/SKILL.md` as of 2026-11-23. The "after" text was approved by Dr. Lee on 2026-11-23 and applied to `.claude/skills/beach-day-scoring/SKILL.md`.
