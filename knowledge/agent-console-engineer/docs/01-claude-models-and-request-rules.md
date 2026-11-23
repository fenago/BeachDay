# Claude models and the rules every request must satisfy
Source: https://platform.claude.com/docs/en/about-claude/models/overview · https://platform.claude.com/docs/en/models/opus-5-5/migration-guide · https://platform.claude.com/docs/en/build-with-claude/effort · https://platform.claude.com/docs/en/api/versioning · https://platform.claude.com/docs/en/api/messages/create
Retrieved: 2026-11-23

## Current models (models overview)
| | Fable 5.2 | Opus 5.5 | Sonnet 5.5 | Haiku 5.5 |
|---|---|---|---|---|
| API ID (= alias) | `claude-fable-5-2` | `claude-opus-5-5` | `claude-sonnet-5-5` | `claude-haiku-5-5` |
| Price in / out per MTok | $8 / $40 | $4 / $20 | $2 / $10 | from $0.10 / from $0.50 |
| Thinking | Adaptive (always on) | Adaptive (always on) | Adaptive | Adaptive |
| Default effort | `high` | `medium` | `high` | `medium` |
| Context / max output | 1M / 128K | 1M / 128K | 1M / 128K | 1M / 128K |
| Retirement not sooner than | 2027-11-09 | 2027-09-22 | 2027-09-28 | 2027-10-07 |

- The overview says to start with Opus 5.5 "for most workloads", and to use Fable 5.2 for "demanding reasoning and long-horizon agentic work" ([overview](https://platform.claude.com/docs/en/about-claude/models/overview)).
- "Every Claude model ID is a pinned snapshot, including the dateless IDs used from the 4.6 generation on." So there are no date suffixes to add.
- Prompt-cache reads cost 10% of base input, but only 5% on Opus 5.5 and Sonnet 5.5, and 2.5% on Fable 5.2/5.1. Batch is 50% off.
- `GET /v1/models` (`client.models.list()`) returns `max_input_tokens`, `max_tokens` and a `capabilities` object per model. `capabilities.thinking.types.disabled.supported` is `false` where `{type:"disabled"}` would be rejected. Read `line` (for example `opus`) instead of parsing the ID.

## Request checklist for `claude-opus-5-5` (migration guide, "What every request … must satisfy")
Where an item says a setting is rejected, the API returns **400**.
- **Model ID:** `claude-opus-5-5`, with no date suffix.
- **Thinking:**
  - Send no `thinking` field, or `{"type": "adaptive"}`. They are equivalent, because adaptive thinking is always on.
  - `{"type": "disabled"}` and `{"type": "enabled", "budget_tokens": N}` are rejected. The error messages are `"thinking.type.disabled" is not supported for this model.` and `"thinking.type.enabled" is not supported for this model.`
- **Effort:** `output_config.effort` is "the only request parameter that controls" thinking depth. The levels are `low`, `medium`, `high`, `xhigh` and `max`, and the default is `medium`.
- **Tool choice:** only `{"type":"auto"}` (the default) or `{"type":"none"}`. `any` and `tool` are rejected. See doc 03.
- **Sampling:** omit `temperature`, `top_p` and `top_k`.
- **Prefill:** don't end `messages` with an assistant turn; it is rejected.
- **`max_tokens`** is a hard limit on thinking **plus** text, and thinking tokens are billed as output even when they aren't shown. At `xhigh`/`max`, start at 64k.
- **Thinking blocks come first** in every response. Select content blocks by `type`, and pass `thinking` blocks back unmodified with tool results.
- **Thinking display:** `thinking.display` defaults to `"omitted"`, so thinking blocks have an empty `thinking` string plus a `signature`. Set `display: "summarized"` to get readable summaries. Notes between tool calls also arrive as thinking blocks; `display: "updates"` is in beta.

Source for all of the above: [Opus 5.5 migration guide](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide).

## `thinking` types in the API reference
The Messages create reference lists `thinking.type` values `"enabled"`, `"disabled"`, `"between_tools"` and `"adaptive"`. Which ones a model accepts is a per-model capability.
- On Sonnet 5.5 the Models API reports `between_tools.supported: true` and `disabled.supported: false` ([overview](https://platform.claude.com/docs/en/about-claude/models/overview)).
- Beach Day uses only `adaptive`.

## Effort guidance ([effort](https://platform.claude.com/docs/en/build-with-claude/effort))
| Level | Doc description |
|---|---|
| `max` | "Absolute maximum capability with no constraints on token spending" |
| `xhigh` | Long-running agentic and coding tasks (over 30 minutes) |
| `high` | "Spends as many tokens as the task needs"; the default except on Opus 5.5 and Haiku 5.5 |
| `medium` | Balanced; the default on Opus 5.5 and Haiku 5.5 |
| `low` | "Most efficient… Simpler tasks… such as subagents" |

- Setting effort to the model's default is identical to omitting it.
- "Effort is a behavioral signal, not a strict token budget."
- Opus 5.5 also supports **per-message effort**: a `system` message inside `messages` changes the effort for later turns and keeps the prompt cache. Changing the top-level `output_config.effort` between requests "can invalidate cached prefixes".

## API version header ([versioning](https://platform.claude.com/docs/en/api/versioning))
- `anthropic-version` is required, and the SDKs set it.
- Current: **`2026-10-21`**. In that version the Messages API changes are:
  - **`temperature`, `top_p`, `top_k` are removed and return 400 "on every model".**
  - a `document` block in an `assistant` message returns 400.
  - a non-empty `citations` array in a user `text` block returns 400.
- Previous: `2023-06-01`.
- Verified locally: `@anthropic-ai/sdk` 1.12.0 sends `anthropic-version: 2026-10-21` and sends the key as `Authorization: Bearer …` (see examples/01). The docs show both `x-api-key` and `Authorization: Bearer` in their curl examples.

## Request shape (TypeScript SDK)
```ts
import Anthropic from "@anthropic-ai/sdk";
const client = new Anthropic({ baseURL: "https://api.anthropic.com", timeout: 50_000, maxRetries: 1 });
const msg = await client.messages.create({
  model: "claude-opus-5-5",
  max_tokens: 16000,
  thinking: { type: "adaptive" },          // or omit
  output_config: { effort: "low" },        // explicit
  system: agent.systemPrompt,              // stable: no timestamps / request IDs (cache)
  messages,                                // must end with role "user"
});
const text = msg.content.filter(b => b.type === "text").map(b => b.text).join("");
```
SDK facts, checked in the installed package source (`client.js`):
- the default timeout is 600000 ms (10 min);
- `maxRetries` defaults to 2;
- `baseURL` defaults to `process.env.ANTHROPIC_BASE_URL ?? https://api.anthropic.com`.

## Differences from the brief and the repo skill
- **Confirmed:** default model `claude-opus-5-5`; the 5.5/5.2 IDs; adaptive thinking; `budget_tokens`/`disabled` return 400; forced `tool_choice` returns 400 on Opus 5.5 and Sonnet 5.5; no prefill; strict tools; checking `stop_reason: "refusal"`.
- **New:** sampling parameters are rejected on **every** model under API version `2026-10-21`, not only on new models.
- **Nuance:** Sonnet 5.5 defaults to `high` effort, not `medium`, and Fable 5.2 also defaults to `high`. The `claude-api` skill only mentions the Opus default.

## Beach Day notes
- Map `.claude/agents/*.md` `model:` aliases to exact IDs at build time (`opus` → `claude-opus-5-5`, `sonnet` → `claude-sonnet-5-5`, `haiku` → `claude-haiku-5-5`, `fable` → `claude-fable-5-2`). Fail the build on an unknown alias.
- Always send `output_config.effort`: `low` for `/api/chat`, `high` for `/api/jobs` code-change work. Leave room in `max_tokens`, because thinking counts toward it.
- Never forward `thinking` blocks to the browser, and never parse them as data. Keep them in the stored conversation for tool rounds.
- Pin `baseURL` in function code so a stray `ANTHROPIC_BASE_URL` env var can't redirect traffic, and with it the key, somewhere else.
- `timeout` in ms below the Netlify limits (ADR-0001): ~50_000 in the 60 s chat function, ~840_000 in the 15 min background function.
