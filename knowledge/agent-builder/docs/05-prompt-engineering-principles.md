# Prompt engineering principles for agent and skill text

Source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview ; https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices
Retrieved: 2026-11-23

## Before prompt engineering

The overview page assumes you already have ([overview](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview)):

1. "A clear definition of the success criteria for your use case"
2. "Some ways to empirically test against those criteria"
3. "A first draft prompt you want to improve"

Not every failure is a prompt problem; "you can sometimes improve latency and cost more easily by choosing a different model." The living reference for techniques is "Prompting best practices".

## General principles (best-practices page)

From [claude-prompting-best-practices#general-principles](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#general-principles):

- **Be clear and direct.** "Think of Claude as a brilliant but new employee who lacks context on your norms and workflows." Key test: "Show your prompt to a colleague with minimal context ... If they'd be confused, Claude will be too." Use numbered steps when order or completeness matters.
- **Add context (the why).** Example: instead of "NEVER use ellipses", explain that output is read by a text-to-speech engine. "Claude can generalize from the explanation."
- **Use examples well.** Make them relevant, diverse and structured, wrapped in example tags. "Include 3–5 examples for best results."
- **Structure with XML tags** when a prompt mixes instructions, context, examples and inputs. Use "consistent, descriptive tag names" and nest naturally.
- **Give Claude a role** in the system prompt: "Even a single sentence makes a difference".
- **Long context (20k+ tokens):** put long documents at the **top**, with instructions after them. "Queries at the end can improve response quality by up to 30 percent". Ask Claude to quote relevant parts first.

The exact tag names in the scraped examples were stripped by the page conversion. The page says to wrap examples in example tags and multiple examples in an outer tag. That the names are `<example>` and `<examples>` is **[UNVERIFIED]** from this retrieval, but it is the conventional form.

## Output and formatting

- Current models are "more direct and grounded", "less verbose", and "might skip verbal summaries after tool calls". Ask for a summary if you want one.
- "Tell Claude what to do instead of what not to do" (e.g. "smoothly flowing prose paragraphs" rather than "no markdown").
- "Match your prompt style to the output you want". Markdown-heavy prompts invite markdown-heavy output.
- Prefill is being retired. The page has a section "Migrating away from prefilled responses", and the repo's docs/05 notes that assistant prefill is no longer allowed on current models.

## Tool use and action

- Models follow instructions literally. "Can you suggest some changes" may yield suggestions only; "Change this function" makes changes.
- Default-to-action and default-to-caution system prompt snippets exist. Pick one deliberately per agent.
- **Over-triggering:** later models are "more responsive to the system prompt". Replace "CRITICAL: You MUST use this tool when..." with "Use this tool when...". ([best-practices#tool-usage](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#tool-usage))
- **Parallel tool calls:** a snippet raises parallel calling to "about 100 percent": "If you intend to call multiple tools and there are no dependencies ... make all of the independent tool calls in parallel ... Never use placeholders or guess missing parameters".

## Agentic systems (selected)

- **Subagent orchestration:** models delegate natively. Watch for overuse. Damping snippet: "Use subagents when tasks can run in parallel, require isolated context, or involve independent workstreams ... For simple tasks, sequential operations, single-file edits ... work directly rather than delegating."
- **Overeagerness / over-engineering:** a snippet limits scope ("Don't add features, refactor code, or make 'improvements' beyond what was asked"), documentation, defensive coding and abstractions.
- **Don't game tests:** "Tests are there to verify correctness, not to define the solution ... If ... any of the tests are incorrect, please inform me rather than working around them."
- **Minimize hallucinations:** "Never speculate about code you have not opened. If the user references a specific file, you MUST read the file before answering."
- **Autonomy vs safety:** "Consider the reversibility and potential impact of your actions". Confirm before destructive or shared-system actions such as `git push --force`, pushing code, or commenting on PRs. "do not use destructive actions as a shortcut".
- **State across context windows:** use structured state files (e.g. `tests.json`), freeform progress notes, and git as a log. "It is unacceptable to remove or edit tests".
- **Self-correction chain:** draft, then review against criteria, then refine, as separate calls when you need to inspect intermediate output.

([best-practices#agentic-systems](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#agentic-systems))

## Beach Day notes: how this maps to our agent files

| Principle | In our files |
|---|---|
| Role in one sentence | Body opens "You are the **<role>** for Beach Day." |
| Explain the why | Rules carry a reason ("Each push to `main` is a production deploy and uses 15 of 300 credits"), not bare NEVERs |
| Structure | role → responsibilities → how you work → boundaries → handoff (authoring skill). Markdown headings play the part XML tags play in API prompts |
| Positive instructions | "Finish with a HANDOFF block", not "don't end without..." |
| Calm language | Avoid "CRITICAL/MUST" stacking; the only hard rules are safety ones (no commit, no secrets, no delegation) |
| Read before claiming | Every expert: "Read the relevant `docs/` files and the existing code first" |
| No test-gaming | qa-engineer and builders: tests verify; report a wrong test instead of editing it to pass |
| Confirm risky actions | Covered structurally: experts can't commit; Console agents only `propose_change` |
| Delegation damping | Orchestrator's "Keep the team lean" |

When fixing an agent, change **one thing**, say *why* in the prompt, and re-run the scenario that failed (see the post-mortem example in `examples/03-prompt-postmortem/`).
