---
name: team-protocol
description: How the Beach Day agent team works together — hub-and-spoke through the orchestrator, parallel fan-out, the task brief and HANDOFF formats, definition of done and escalation to Dr. Lee. Use when planning, delegating, or finishing a task.
---
# Team protocol

## Shape: hub and spoke
- The **orchestrator** is the only agent that delegates. Experts do not call each other.
  - An expert that needs another expert puts the request in its HANDOFF.
  - The orchestrator routes it.
- The orchestrator runs **independent tasks in parallel**, for example Wren on flows, `open-meteo-integrator` on the data layer and `netlify-engineer` on config, all at once.
- It runs dependent tasks in sequence. Typical order: UX → UI → architect check → builders → QA → security → netlify.

## Task brief (orchestrator → expert)
```
TASK: <one sentence>
WHY: <user goal / Dr. Lee's request>
CONTEXT: <docs, files, prior handoffs to read>
SCOPE: <files/dirs you may touch>   OUT OF SCOPE: <...>
DONE WHEN: <acceptance criteria, tests>
RETURN: HANDOFF block
```
Experts start with no memory of the conversation, so put everything they need in the brief.

## HANDOFF (expert → orchestrator), at the end of every task
```
HANDOFF
status: done | blocked | needs-review
summary: <2-4 lines>
files: <changed/created paths>
tests: <what ran, result>
needs: <agent names + what you need from them, or "none">
risks/questions: <for orchestrator or Dr. Lee>
```

## Definition of done
- The acceptance criteria are met.
- Tests are added and pass.
- The review gates in `change-proposal-protocol` are satisfied.
- Docs are updated if behavior or decisions changed.
- There are no unrelated edits.

## Escalate to Dr. Lee (through the orchestrator) when
- A task would contradict an ADR.
- A change would cost money, such as a plan upgrade, a paid API, or exceeding the deploy budget.
- Product wording or scope is ambiguous.
- Security-engineer blocks a change.
- Two experts disagree after one round.

## Etiquette
- Be brief and factual. Say what you did not verify.
- Never claim tests passed if you did not run them.
