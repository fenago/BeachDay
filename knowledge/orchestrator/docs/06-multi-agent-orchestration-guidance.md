# Anthropic engineering guidance on orchestrating agents
Source: https://www.anthropic.com/engineering/multi-agent-research-system ; https://www.anthropic.com/engineering/building-effective-agents ; https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#subagent-orchestration ; https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5#time-signals-for-multi-agent-harnesses
Retrieved: 2026-11-23

Both engineering posts now redirect to `anthropic.com/research/...`. "Building effective agents" carries a note that "much of the tooling landscape described in this post has changed since December 2024". Its patterns are still the vocabulary used below.

## Patterns (Building effective agents)

- **Workflows vs agents:** workflows are "systems where LLMs and tools are orchestrated through predefined code paths". Agents "dynamically direct their own processes and tool usage". ([building-effective-agents](https://www.anthropic.com/engineering/building-effective-agents))
- Start with "the simplest solution possible, and only increasing complexity when needed". Agentic systems "trade latency and cost for better task performance".
- Named patterns:
  - **Prompt chaining**: fixed sequential steps with programmatic "gates" between them.
  - **Routing**: classify, then send to a specialized handler.
  - **Parallelization**: either *sectioning* (independent subtasks) or *voting* (same task several times).
  - **Orchestrator-workers**: "a central LLM dynamically breaks down tasks, delegates them to worker LLMs, and synthesizes their results". Suited to cases where "you can't predict the subtasks needed", for example coding changes across many files.
  - **Evaluator-optimizer**: one call generates, another critiques, in a loop. Use it when there are clear evaluation criteria.
- Three principles: keep the design **simple**, make planning **transparent**, and invest in the agent-computer interface (tool **documentation and testing**).
- Agents need "ground truth from the environment at each step". Use stopping conditions such as a maximum number of iterations. Human review "remains crucial" for coding agents even when tests pass.

## Lessons from the multi-agent Research system

From [multi-agent-research-system](https://www.anthropic.com/engineering/multi-agent-research-system):

- **Architecture:** orchestrator-worker. A lead agent plans, saves the plan to memory (context over 200,000 tokens gets truncated), spawns subagents in parallel, and synthesizes the results.
- **Cost:** agents use about **4×** the tokens of chat, and multi-agent systems about **15×**. Token usage alone explained **80%** of performance variance on BrowseComp. Multi-agent fits "valuable tasks that involve heavy parallelization". It is a poor fit where agents must share context or have "many dependencies". "most coding tasks involve fewer truly parallelizable tasks than research".
- **Teach the orchestrator how to delegate:** "Each subagent needs an objective, an output format, guidance on the tools and sources to use, and clear task boundaries." Vague instructions led to duplicated work and gaps.
- **Scale effort to query complexity:** embed explicit rules. Simple tasks: 1 agent, 3–10 tool calls. Comparisons: 2–4 subagents. Complex work: more than 10, with clearly divided responsibilities. Early failures included "spawning 50 subagents for simple queries".
- **Parallel tool calling:** the lead spins up 3–5 subagents in parallel, which cut research time by up to 90%.
- **Let agents improve themselves:** given a prompt and a failure mode, Claude can diagnose the problem and rewrite the prompt or tool description.
- **Guide thinking:** the lead uses thinking to plan tool fit, complexity and subagent count. Subagents use interleaved thinking after tool results.
- **Evaluation:** start with about **20** realistic cases. Use an LLM judge with a rubric (accuracy, citations, completeness, source quality, tool efficiency). For agents that change state, use **end-state evaluation**. Human testers still catch what automation misses.
- **Reliability:** errors compound, so resume from checkpoints instead of restarting. The system ran subagents synchronously, which "creates bottlenecks" but simplifies coordination.
- **Artifacts over telephone:** let subagents write outputs to a filesystem and "pass lightweight references back to the coordinator", rather than copying large outputs through the lead.

## Current-model guidance

- Latest models "orchestrate subagents natively", but watch for overuse. Suggested damping prompt: "Use subagents when tasks can run in parallel, require isolated context, or involve independent workstreams that don't need to share state. For simple tasks, sequential operations, single-file edits, or tasks where you need to maintain context across steps, work directly rather than delegating." ([best practices#subagent-orchestration](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#subagent-orchestration))
- **Claude Opus 5.5** is "highly responsive to information about elapsed time". In multi-agent harnesses, a line such as `elapsed 340s / 1200s` on each message, or a sentence saying that time matters, made teams finish sooner. The budget is advisory, so keep your own hard timeout. ([prompting-claude-opus-5-5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5#time-signals-for-multi-agent-harnesses))
- **Opus 5.5 unattended runs:** a text-only `end_turn` may be a progress report rather than completion. Keep a checklist, nudge on open items, and cap automatic continuations at 2–3.

## Beach Day notes

- **Our orchestrator is the orchestrator-workers pattern with gates.** The review gates in `change-proposal-protocol` are the "gate" of prompt chaining, and the QA → security sequence is an evaluator step.
- **Brief = objective + output format + tools/sources + boundaries.** That maps one-to-one onto TASK, RETURN (HANDOFF), CONTEXT, and SCOPE / OUT OF SCOPE. Never send a one-line brief.
- **Effort scaling rule for Beach Day:**
  - Copy tweak or one-file fix: 1 expert, no fan-out.
  - Feature touching data + UI: 2–4 experts in the first wave.
  - Never more than about 5 at once; this is a small app and most coding work is sequential (UX → UI → build → QA).
- **Cost:** multi-agent runs cost roughly 15× a chat. Call only the experts a task needs ("Keep the team lean" in the orchestrator prompt), and don't add security-engineer to a copy change unless a gate requires it.
- **Artifacts over telephone:** experts write specs to `docs/design/<topic>.md` and code to the repo. The HANDOFF lists file paths instead of pasting content, and the orchestrator passes paths to the next expert.
- **End-state evaluation** fits our definition of done: the files exist, the tests pass, the gates are signed off. "The expert said it's done" is not enough.
- **Improving agents from failures** is agent-builder's job; route repeated mistakes there, as the orchestrator prompt says.
