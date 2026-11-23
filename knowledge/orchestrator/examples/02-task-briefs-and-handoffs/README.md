# Example 02: Task briefs, HANDOFFs and a HANDOFF validator

## What it demonstrates

- **`briefs-and-handoffs.md`** holds three briefs of different kinds (build, security review that blocks, design spec), the HANDOFF each one produced, and how the orchestrator routed them.
- **`validate-handoff.mjs`** is a dependency-free Node 22 script that checks HANDOFF blocks against `team-protocol`:
  - all six fields are present and non-empty, in order: `status, summary, files, tests, needs, risks/questions`;
  - `status` ∈ `done | blocked | needs-review`;
  - `needs` is `none` or names a roster agent (or Dr. Lee);
  - a `blocked` status says what blocks it;
  - a `tests` line that claims a pass also shows what ran (a command or count). This enforces "never claim tests passed unless you ran them".
- **`bad-handoffs.txt`** contains four broken blocks the validator must reject.

## Why this is "what good looks like"

- Each brief gives the expert everything it can't see. Subagents start with a fresh context and don't see the conversation (see `docs/01-subagents-delegation.md`). So each brief has the objective, why, exact files, out-of-scope, testable acceptance criteria, and the return format. This matches Anthropic's guidance that every subagent needs "an objective, an output format, guidance on the tools and sources to use, and clear task boundaries" (`docs/06-multi-agent-orchestration-guidance.md`).
- The HANDOFFs list **paths, not pasted content**, name the next agent in `needs:`, and quote real test commands and counts.
- The blocked review says exactly what would unblock it, so the orchestrator can route without another round trip.
- The validator makes the format machine-checkable. The orchestrator (or a `SubagentStop` hook, if Dr. Lee ever wants enforcement) can reject a malformed HANDOFF before routing it.

## How to run

```bash
cd knowledge/orchestrator/examples
node 02-task-briefs-and-handoffs/validate-handoff.mjs 02-task-briefs-and-handoffs/briefs-and-handoffs.md 01-seven-day-view-plan/plan.md
node 02-task-briefs-and-handoffs/validate-handoff.mjs 02-task-briefs-and-handoffs/bad-handoffs.txt   # expected to fail
```

It also works as a module: `import { validateBlock } from './validate-handoff.mjs'`.

## Verified

Run on 2026-11-23 with Node v22.23.5:

```
$ node 02-task-briefs-and-handoffs/validate-handoff.mjs 02-task-briefs-and-handoffs/briefs-and-handoffs.md 01-seven-day-view-plan/plan.md
ok      02-task-briefs-and-handoffs/briefs-and-handoffs.md:23 [status=done]
ok      02-task-briefs-and-handoffs/briefs-and-handoffs.md:48 [status=blocked]
ok      02-task-briefs-and-handoffs/briefs-and-handoffs.md:76 [status=needs-review]
ok      01-seven-day-view-plan/plan.md:93 [status=done]
ok      01-seven-day-view-plan/plan.md:106 [status=done]
ok      01-seven-day-view-plan/plan.md:120 [status=needs-review]

6 block(s) checked, 0 problem(s)
exit=0

$ node 02-task-briefs-and-handoffs/validate-handoff.mjs 02-task-briefs-and-handoffs/bad-handoffs.txt
INVALID 02-task-briefs-and-handoffs/bad-handoffs.txt:3 [status=finished]
  - status "finished" not in done | blocked | needs-review
  - needs must be "none" or name an agent from the roster (or Dr. Lee)
  - tests claims a pass but gives no command/count; say what ran
INVALID 02-task-briefs-and-handoffs/bad-handoffs.txt:11 [status=done]
  - fields out of order (expected status, summary, files, tests, needs, risks/questions)
INVALID 02-task-briefs-and-handoffs/bad-handoffs.txt:19 [status=blocked]
  - status "blocked" must say what blocks it (needs or risks/questions)
INVALID 02-task-briefs-and-handoffs/bad-handoffs.txt:27 [status=done]
  - empty field "summary"
  - missing field "risks/questions"

4 block(s) checked, 4 problem(s)
exit=1
```

The test counts inside the example HANDOFFs (for example "41 passed") are illustrative. Beach Day has no code or tests yet.
