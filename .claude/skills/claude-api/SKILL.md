---
name: claude-api
description: Claude API facts for the Agent Console Netlify Functions — model IDs, adaptive thinking and effort, Messages API streaming, tool use with strict schemas, refusals, errors, caching, rate and spend limits. Use when writing or reviewing code that calls Claude.
---
# Claude API (summary of docs/05-claude-api.md — read it for details)

## Defaults
- **SDK:** `@anthropic-ai/sdk`, only from Netlify Functions, never from the browser. Always pass the endpoint and key explicitly: `new Anthropic({ baseURL: "https://api.anthropic.com", apiKey: process.env.ANTHROPIC_API_KEY, timeout, maxRetries })`, so an injected `ANTHROPIC_BASE_URL` or AI-Gateway variable can't reroute calls (docs/03 §5).
- **Model:** `claude-opus-5-5`. Per agent, map `model:` aliases to IDs:
  - `opus` / `inherit` / missing → `claude-opus-5-5`
  - `sonnet` → `claude-sonnet-5-5`
  - `haiku` → `claude-haiku-5-5`
  - **Console allow-list is these three only.** `fable`, full IDs and anything else fail `build-agents`, and functions re-check the ID (docs/04 §11). Fable 5.2 (`claude-fable-5-2`) is for Claude Code sessions only.
  - Use exact IDs; never add date suffixes.
- **Thinking:** `thinking: {type: "adaptive"}`, or omit it.
  - `budget_tokens` and `{type: "disabled"}` return **400** on current models.
  - Thinking display defaults to `"omitted"`. Use `display: "summarized"` to show reasoning.
- **Effort:** set `output_config: {effort: ...}` explicitly.
  - Use `low` for chat and `high` for code-change jobs.
  - Default effort when unset: `medium` on Opus 5.5 and Haiku 5.5, `high` on Sonnet 5.5 and Fable 5.2.
- **Strict schemas** don't support `maxLength` or `maxItems`, so enforce size limits in code.
  - Opus 5.5 defaults to `medium`.
- **Streaming:** use `client.messages.stream({...})`, iterate the events, then `await stream.finalMessage()`.
  - Use `max_tokens` around 64000 when streaming and around 16000 when not.
- **No assistant prefill**, which returns 400. No `temperature`, `top_p` or `top_k` either: API version `2026-10-21`, which current SDKs send, rejects them on every model. Shape output with the system prompt or `output_config.format`.

## Tool use
- **Tool definitions:** `{name, description, strict: true, input_schema: {type: "object", properties, required, additionalProperties: false}}`.
- **`tool_choice`:** `auto` only. Forced `any` / `tool` returns **400** on Opus 5.5, Sonnet 5.5 and Fable 5.x. Say which tool to use in the prompt instead.
- **Loop:**
  - Continue while `stop_reason === "tool_use"`.
  - Append the **full** `response.content`.
  - Return **all** `tool_result` blocks for a turn in **one** user message, matched by `tool_use_id`. Use `is_error: true` for failures.
  - Parse tool input with JSON.parse, then validate it yourself (schema plus allow-list). `strict` guarantees shape, not safety.
- **Truncated input:** if `stop_reason === "max_tokens"` while a tool_use is present, the input may be cut off. Do not run it.
- **Streaming with client tools:** set `eager_input_streaming: true` on each tool and validate the parsed input before running it.
- **Beach Day tools:**
  - `read_file(path)`
  - `list_files(dir)`
  - `propose_change({summary, files:[{path, content}]})`. This stores a pending proposal and **never** commits.

## Refusals & errors
- **Refusals** come back as HTTP 200 with `stop_reason: "refusal"`. Check `stop_reason` before reading content, and discard partial output.
  - Opt into fallbacks with `client.beta.messages.create({..., betas: ["server-side-fallback-2026-07-01"], fallbacks: "default"})`. The streaming variant takes the same parameters.
- **Error classes,** most specific first: `Anthropic.NotFoundError`, `Anthropic.RateLimitError`, `Anthropic.APIError`, `Anthropic.APIConnectionError`.
- **SDK retries:** 408/409/429/5xx are retried twice by default.
- **TypeScript timeout is in ms.** Keep it under the Netlify limit: about 50_000 for chat, 840_000 in background functions. In chat also pass a per-turn deadline as the request option `{ signal }` (55 s from the turn's start), so retries can't overrun 60 s (docs/04 §8).

## Caching
- Put the stable system prompt and tools first, with `cache_control: {type: "ephemeral"}`.
- Never put timestamps or request IDs in the system prompt.
- Mid-conversation `{role: "system"}` messages are allowed on Opus/Sonnet/Haiku 5.5.

## Limits & cost
- Limits are per organization and per model: RPM, ITPM and OTPM. The Start tier is 4,000 RPM for the 5.5 models.
- A 429 includes `retry-after`. `error.details.error_code` tells `ramp_limit_exceeded` and `enforced_spend_limit_reached` apart.
- Use a **dedicated workspace with a low monthly spend limit** for the deployed app.
- Cached reads don't count toward ITPM.

## Models (cached 2026-11; confirm with `client.models.list()`)
| Model | Price (input / output per MTok) |
|---|---|
| Opus 5.5 | $4 / $20 |
| Sonnet 5.5 | $2 / $10 |
| Haiku 5.5 | $0.10 / $0.50 |
| Fable 5.2 | $8 / $40 |

All have a 1M context window.

Live docs: https://platform.claude.com/docs/en/api/messages/create · https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview · https://platform.claude.com/docs/en/api/rate-limits
