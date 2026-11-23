# Claude API errors, rate limits, spend limits and refusals
Source: https://platform.claude.com/docs/en/api/errors · https://platform.claude.com/docs/en/api/rate-limits · https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback · https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
Retrieved: 2026-11-23

## HTTP errors ([errors](https://platform.claude.com/docs/en/api/errors))
| Status | `error.type` | Meaning / action |
|---|---|---|
| 400 | `invalid_request_error` | Bad request. **Also returned when usage reaches a spend limit *you set*** for the organization or workspace |
| 401 | `authentication_error` | Key malformed, revoked or expired |
| 402 | `billing_error` | Billing or payment problem |
| 403 | `permission_error` | Key not allowed to use the resource |
| 404 | `not_found_error` | Wrong path or ID |
| 409 | `conflict_error` | Concurrent modification |
| 413 | `request_too_large` | Messages API max request is **128 MB** (returned by Cloudflare before it reaches the API) |
| 429 | `rate_limit_error` | Rate limit, tier monthly spend cap, or ramp limit |
| 500 | `api_error` | Retry with backoff |
| 504 | `timeout_error` | Use streaming for long requests |
| 529 | `overloaded_error` | Temporarily overloaded |

Error body shape:
```json
{ "type": "error",
  "error": { "type": "not_found_error", "message": "The requested resource could not be found." },
  "request_id": "req_011CSHoEeqs5C35K2UUqR7Fy" }
```
- Every response has a `request-id` header. The TS SDK exposes it as `message._request_id`, and `.withResponse()` gives you the raw headers.
- **SDK retries:** "connection errors, rate limits, and 5xx server errors" are retried with exponential backoff, "twice by default, honoring the `retry-after` header". Configure with `maxRetries`.
- **SDK error classes:** for example `Anthropic.NotFoundError`. Catch the typed classes, most specific first, and don't string-match messages.
- **Mid-stream errors** arrive as `event: error` after the 200 (doc 02).

Validation errors worth knowing (exact messages):
- Prefill on 4.6 and later models:
  > "This model does not support assistant message prefill. The conversation must end with a user message."
- Forced tools:
  > `tool_choice: type "tool" and "any" are not supported for this model.`
- Thinking:
  > `"thinking.type.disabled" is not supported for this model.`

  ([migration guide](https://platform.claude.com/docs/en/models/opus-5-5/migration-guide))

## Rate limits ([rate limits](https://platform.claude.com/docs/en/api/rate-limits))
- Limits are measured per model class as **RPM**, **ITPM** (input tokens per minute) and **OTPM** (output tokens per minute), using a token-bucket algorithm with continuous refill.
- **Start tier:** Opus 5.5, Sonnet 5.5 and Haiku 5.5 each get 4,000 RPM / 2,000,000 ITPM / 400,000 OTPM. Fable 5.2 gets 4,000 / 500,000 / 100,000.
- New organizations may start in a lower **Evaluation** tier.
- **Tier monthly spend cap:** the Start tier cap is $500.
  - Hitting it returns 429 `rate_limit_error` with `error.details.error_code: "enforced_spend_limit_reached"` and **no `retry-after`**.
  - Retries, including the SDK's, keep failing until access resumes.
- **Ramp limit:** a sharp increase in usage can return 429 even under your limits, with `error.details.error_code: "ramp_limit_exceeded"`. Wait at least `retry-after`.
- Response headers:
  - `retry-after`
  - `anthropic-ratelimit-requests-{limit,remaining,reset}`
  - `anthropic-ratelimit-tokens-{limit,remaining,reset}`
  - `anthropic-ratelimit-input-tokens-*`
  - `anthropic-ratelimit-output-tokens-*`

  The reset times are RFC 3339. `anthropic-workspace-id` names the workspace that was charged.

## Spend limits you set
- Set them in the Console (`platform.claude.com/settings/spend-limits`) for the organization or a workspace.
- Reaching one returns **400** `invalid_request_error` ([errors](https://platform.claude.com/docs/en/api/errors)). The tier cap above is a 429.
- The `claude-api` skill only mentions the 429 codes. Handle both.

## Refusals ([refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback), [stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons))
- Fable 5.2/5.1/5, **Opus 5.5**, Opus 5, **Sonnet 5.5** and **Haiku 5.5** include safety classifiers. A refusal is a **normal HTTP 200** with `stop_reason: "refusal"` and a `stop_details` object:
```json
"stop_reason": "refusal",
"stop_details": { "type": "refusal", "category": "cyber", "explanation": "This request was declined because it could enable cyber harm." }
```
- `stop_details` is `null` for every other stop reason.
- `category` and `explanation` can be `null`, which is "a normal, permanent value".
- The categories are `"cyber"`, `"bio"`, `"frontier_llm"`, `"reasoning_extraction"` and `"general_harms"`.
  - `bio`, `frontier_llm` and `reasoning_extraction` are "billed before any output"; `cyber` and `general_harms` are not.
  - `reasoning_extraction` is triggered by prompts that ask for reasoning in the output text, such as a `<thinking>` section or a `reasoning` field in JSON or tool input. The page lists the Fable models as the ones that may return it. Change the prompt; don't retry on another model.
- A refusal can come before any output or mid-stream. "In either case, treat any partial output as incomplete and discard it."
- **Server-side fallback** (beta):
  - Send `fallbacks: "default"` with beta header `anthropic-beta: server-side-fallback-2026-07-01`. In TS: `client.beta.messages.create({..., fallbacks: "default", betas: ["server-side-fallback-2026-07-01"]})`.
  - The API retries on Anthropic's recommended fallback model for that category.
  - `stop_details.recommended_model` appears only on requests that set `fallbacks`.
  - **Haiku 5.5 has no server-side fallback**; use client-side fallback.
- Benign cybersecurity work can also trigger the `cyber` category. That is relevant to our security-engineer agent, which discusses exploits.

## Beach Day notes
- Map errors to calm UI messages, and never echo upstream bodies to the browser. Log `request_id`, status and `error.type` only. Never log prompts or keys.
- Keep SDK `maxRetries` low (1 in chat, 2 in background) so retries can't overrun Netlify's 60 s / 15 min limits (docs/03 §5). In chat, the per-turn `signal` is the hard bound.
- Run the deployed app in a **dedicated workspace** with a low workspace spend limit as the hard stop. Treat a 400 spend-limit error and a 429 `enforced_spend_limit_reached` as "Console paused: budget reached". Never retry them.
- Our own limits run after the token-and-role check and before calling Claude (docs/04 §9): per Supabase user per New York day, 200 chat turns and 20 jobs; a site-wide compute budget; the site-wide Approve cap (ADR-0008). Netlify's 2 `rateLimit` rules on Free cover `/api/chat` and `/api/jobs`.
- On `refusal`: drop the partial reply, tell the user plainly, and either reset that turn or offer a retry on a fallback. Opting into server-side fallback is a product decision for Dr. Lee, so it is not on by default.
