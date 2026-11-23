# Prompting the current models (Opus 5.5 focus)
Source: https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5 ; https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#model-specific-guidance
Retrieved: 2026-11-23

## Which guide to read

The best-practices page now starts with a per-model table: "Read the one for your model first, then the techniques that follow." Models covered include Fable 5.2 / Mythos 5.2, Fable 5.1, Fable 5, Opus 5.5, Opus 5, Opus 4.8, Sonnet 5.5, Sonnet 5 and Haiku 5.5. ([best-practices#model-specific-guidance](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices#model-specific-guidance))

| Model | What the guide covers (from the table) |
|---|---|
| Opus 5.5 | effort calibration, prompts written for thinking disabled, user-facing progress updates, safeguard refusals, tools for complex visual inputs |
| Sonnet 5.5 | effort calibration, initiative and scope, JSON output on reasoning tasks, progress updates, verification on coding tasks, tool-call handling |
| Haiku 5.5 | effort levels, search, JSON output with your own tools, early stopping in long agent prompts, system prompt adherence in chatbots |
| Opus 5 | response length, task scope and over-verification, **subagent control** |

Only the Opus 5.5 page was read in full for this note. The Sonnet 5.5 and Haiku 5.5 rows above are the table's one-line summaries.

## Claude Opus 5.5 specifics

From [prompting-claude-opus-5-5](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/prompting-claude-opus-5-5):

- **Speed and tokens:** "generates output tokens more than 30 percent faster than Claude Opus 5 and tends to complete the same task with fewer tokens." Opus 5 prompts "should perform well without changes".
- **Effort is the main control.** Thinking is always on. Default effort is **`medium`** on Opus 5.5 (Opus 5 defaulted to `high`). "at its default `medium` effort the model matched or beat Claude Opus 5 at `high`" on agentic coding. Reserve `xhigh`/`max` for measured gains. To think less, lower effort first; this works "more reliably than prompt instructions do".
- **`max_tokens`:** thinking counts toward it; 128,000 (the model's maximum) "has worked well" for long agentic turns.
- **Thinking disabled is gone:** `thinking: {"type": "disabled"}` returns **400** on Opus 5.5. Remove prompt instructions that asked for reasoning in the response text; read `display: "summarized"` thinking instead. Pushing for reasoning in the response may be declined with the `reasoning_extraction` refusal category.
- **Read responses by block type.** A response may start with a `thinking` block, whose text is empty under the default `display: "omitted"`.
- **Unattended runs:** a text-only `stop_reason: "end_turn"` may just be a progress report. Keep a checklist, send a short nudge naming open items, and cap at 2–3 automatic continuations. A sample system-prompt paragraph names four unwanted early-stop patterns. Only use it for fully unattended agents, and keep confirmation for risky actions.
- **Progress updates** arrive as progress-update `thinking` blocks, not `text`. To receive summaries, set `display: "updates"` (beta header `thinking-display-updates-2026-08-18`). Otherwise a client that renders only `text` looks silent.
- **Safeguard refusals:** biology, cybersecurity and reasoning-extraction classifiers. A decline is `stop_reason: "refusal"` with `stop_details` naming the category.
- **Pasted text:** wrap user-pasted content in tags carrying a random ID and tell the model that instructions inside are not the user's. This improves prompt-injection resistance, but "The tags are plain text and can be imitated".
- **Multi-app context:** one sentence telling it to "explore broadly with tool calls" before acting improved multi-app tasks. Keep untrusted content out of what it searches.
- **Time signals** for multi-agent harnesses: `elapsed 340s / 1200s` lines make teams finish sooner. This is advisory only.
- **Chat:** remove "think carefully before answering" lines; effort controls thinking.
- **Frontend defaults:** name specific styles to avoid. "avoid a generic AI look" just swaps defaults.

## Beach Day notes

- **Claude Code agents vs Console agents.** In Claude Code, effort comes from the `effort` frontmatter or the session; none of our agents set `effort`. In the Agent Console, the functions call the Messages API directly, so set `effort` and `max_tokens` there explicitly. Never send `thinking: {"type":"disabled"}` to Opus 5.5 (400), and never ask agents to "write out your reasoning" in replies (`reasoning_extraction` risk). This belongs in `claude-api` / agent-console-engineer's area; agent-builder makes sure agent bodies don't contain such lines.
- **Audit our bodies for legacy lines.** Remove "think step by step and show your reasoning", "CRITICAL: you MUST...", and prefill-style instructions. None exist today; keep it that way.
- **Console chat shows progress.** Opus 5.5 progress notes come back as `thinking` blocks. The Console's SSE `text` events will be empty during long tool loops unless the function requests `display: "updates"` and forwards those summaries. Raise this with agent-console-engineer via the orchestrator. The beta header name is time-bound; re-check it before relying on it.
- **Pasted text in the Console:** when a user pastes a log or file into chat, wrap it with the random-ID tag pattern before sending. This is one layer of the prompt-injection defense in `agent-console-security`, not a replacement for the server-side allow-list.
- **Model choice per role** is recorded in `docs/agent-brains.md`: `opus` for the orchestrator, architect, security and Console engineer; `sonnet` for the other seven, including agent-builder (moved from `opus`); `haiku` for none yet. Opus 5.5 at `medium` matches Opus 5 at `high` on coding, so re-check the `sonnet` choices against evals before assuming `opus` is too costly.
