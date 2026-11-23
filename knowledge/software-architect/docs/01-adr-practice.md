# Architecture Decision Records (ADR) practice
Source: https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions (Michael Nygard, 2011) ; https://adr.github.io/
Retrieved: 2026-11-23

## Definitions (adr.github.io)

- An **Architectural Decision (AD)** is "a justified design choice that addresses a functional or non-functional requirement that is architecturally significant".
- An **Architecturally Significant Requirement (ASR)** "has a measurable effect on the architecture and quality of a software and/or hardware system".
- An **ADR** "captures a single AD and its rationale". "The collection of ADRs created and maintained in a project constitute its *decision log*." ([adr.github.io](https://adr.github.io/))
- The adr organization's work builds on Zdun et al., "Sustainable Architectural Decisions", including the **Y-statement** format. It also links a WICSA 2015 comparison of seven templates. The Y-statement shape itself is not quoted on the page; the commonly used form is "In the context of …, facing …, we decided for … and neglected …, to achieve …, accepting …". That form is **[UNVERIFIED]** from this retrieval.

## Nygard's original format

From [Documenting Architecture Decisions](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions):

- **Why:** without the rationale, a newcomer can only "Blindly accept the decision" or "Blindly change it". Both are risky. "Large documents are never kept up to date. Small, modular documents have at least a chance".
- **Scope:** record "architecturally significant" decisions, meaning "those that affect the structure, non-functional characteristics, dependencies, interfaces, or construction techniques."
- **Storage:** in the repo (his example path: `doc/arch/adr-NNN.md`), in a lightweight markup such as Markdown.
- **Numbering:** "ADRs will be numbered sequentially and monotonically. Numbers will not be reused."
- **Reversal:** "If a decision is reversed, we will keep the old one around, but mark it as superseded."
- **Sections:**

| Section | Rule |
|---|---|
| Title | "short noun phrases", e.g. "ADR 9: LDAP for Multitenant Integration" |
| Context | The forces at play (technological, political, social, project-local), "probably in tension". The language is "value-neutral. It is simply describing facts." |
| Decision | "stated in full sentences, with active voice. 'We will …'" |
| Status | "proposed" until stakeholders agree, then "accepted". It may later be "deprecated" or "superseded" with a reference to the replacement |
| Consequences | "All consequences should be listed here, not just the 'positive' ones" |

- **Length:** "one or two pages long", written "as if it is a conversation with a future developer", in full sentences. Bullets are for visual style only.
- "The consequences of one ADR are very likely to become the context for subsequent ADRs."

## Good-ADR checklist (derived from the above)

1. One decision per ADR. The title is a noun phrase naming the choice.
2. Context lists the competing forces with links to evidence. No advocacy in Context.
3. Decision is specific and testable, in active voice ("We will …").
4. Consequences include the bad and the neutral, plus follow-up work.
5. Status starts as Proposed; only the decision owner accepts it.
6. Never edit an accepted ADR's substance. Supersede it with a new number and update the old status line.

## Beach Day notes

- Our template (`docs/adr/README.md`, `architecture-decision-records` skill) is Nygard's plus two additions: **Deciders** (Dr. Lee plus agents consulted) and **Revisit when** (a concrete trigger). The trigger makes "the time to change old decisions ... clear from changes in the project's context", which is Nygard's own consequence, made explicit.
- File naming is `docs/adr/NNNN-short-title.md` with 4 digits, never reused. The next free number is **0009** (0006–0008 accepted 2026-11-23).
- **Only Dr. Lee accepts.** Agents write `Status: Proposed`, and the orchestrator brings it to Dr. Lee. Exception: when Dr. Lee has stated the decision himself (0006–0008), the ADR records it as Accepted with `Deciders: Dr. Lee`. The status line is the only allowed edit to an accepted ADR (when superseding it).
- Write an ADR (per our skill) for: a new dependency or service, a trust-boundary change, a deploy-flow change, a data-source change, or anything that changes cost. These map directly onto Nygard's "dependencies, interfaces, non-functional characteristics".
- **Consequences must include cost in Netlify credits** where relevant (ADR-0004: 300 credits a month, 15 per production deploy). Cost is the non-functional force that most often decides things here.
- A worked Proposed ADR in our format is in `examples/03-proposed-adr/`.
