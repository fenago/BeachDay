# Claude Messages API streaming (SSE)
Source: https://platform.claude.com/docs/en/build-with-claude/streaming · https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals · https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons
Retrieved: 2026-11-23

## Turning it on
- Set `"stream": true` on `POST /v1/messages`, or in the TS SDK use `client.messages.stream({...})`, which returns a `MessageStream`.
- SDK helpers:
  - `.on("text", (delta, snapshot) => …)`
  - `for await (const event of stream)`, which yields the raw events
  - `await stream.finalMessage()`, which gives the accumulated `Message`
- The SDK "requires streaming" for requests with large `max_tokens` values, to avoid HTTP timeouts ([streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)).
- The installed `MessageStream` type also emits `streamEvent`, `thinking`, `signature`, `inputJson`, `contentBlock`, `message`, `finalMessage`, `error`, `abort` and `end` (read from `lib/MessageStream.d.ts`, SDK 1.12.0).

## Event flow (exact names)
1. `message_start`: a `Message` with empty `content`.
2. For each content block: `content_block_start`, then any number of `content_block_delta`, then `content_block_stop`. `index` is the block's position in the final `content` array.
3. One or more `message_delta`: top-level changes, including `stop_reason`, plus `usage`.
4. `message_stop`.

`ping` events can appear anywhere. Some blocks arrive whole, with no deltas: `redacted_thinking`, server-tool results, and server-side-fallback `fallback` blocks.

> "The token counts shown in the `usage` field of the `message_delta` event are *cumulative*."

> "new event types may be added, and your code should handle unknown event types gracefully."

### Raw examples (from the docs page)
```
event: message_start
data: {"type": "message_start", "message": {"id": "msg_…", "type": "message", "role": "assistant", "content": [], "model": "claude-opus-5-5", "stop_reason": null, "stop_sequence": null, "usage": {"input_tokens": 25, "output_tokens": 1}}}

event: content_block_start
data: {"type": "content_block_start", "index": 0, "content_block": {"type": "text", "text": ""}}

event: content_block_delta
data: {"type": "content_block_delta","index": 0,"delta": {"type": "text_delta", "text": "ello frien"}}

event: content_block_stop
data: {"type": "content_block_stop", "index": 0}

event: message_delta
data: {"type": "message_delta", "delta": {"stop_reason": "end_turn", "stop_sequence":null}, "usage": {"output_tokens": 15}}

event: message_stop
data: {"type": "message_stop"}
```

### Delta types
| `delta.type` | Field | Notes |
|---|---|---|
| `text_delta` | `text` | the text to show |
| `input_json_delta` | `partial_json` | a partial JSON *string* for a `tool_use` block's `input`. Accumulate it and parse at `content_block_stop`; the final `tool_use.input` is always an object |
| `thinking_delta` | `thinking` | empty in practice on Opus 5.5 unless `display: "summarized"` |
| `signature_delta` | `signature` | sent just before `content_block_stop` of a thinking block |

- By default the API buffers each tool `input` key and value until it is complete.
- Setting `eager_input_streaming: true` on a tool streams parameter values with less buffering ("fine-grained tool streaming"). The input may then be incomplete or invalid, so validate it before use ([fine-grained tool streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming)).

## Errors after the 200
```
event: error
data: {"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}}
```
- This corresponds to a 529 in non-streaming mode. Normal HTTP error handling doesn't apply once the 200 has been sent ([errors](https://platform.claude.com/docs/en/api/errors)).
- Verified locally: the TS SDK throws an `APIError` with `status` `undefined` and `error.error.type === "overloaded_error"` (examples/01).

## Refusals in a stream
- "The stream ends with `stop_reason` `"refusal"`, and `stop_details` (`category` and `explanation`) arrives on the `message_delta` event" ([streaming refusals](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/handle-streaming-refusals)).
- Partial text may already have been sent, for example `"Hello.."`, so the UI must drop it.
- `category` and `explanation` can be `null`. Branch on `stop_reason` or `stop_details.type`.
- After a refusal you "must reset the conversation context before continuing" (remove or rephrase the triggering turn), or retry on another model (doc 04).
- `stop_reason` is `null` in `message_start`, is set only in `message_delta`, and appears in no other event ([stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons)).

## Recovering an interrupted stream (Claude 4.6 and later)
Prefill is not allowed, so don't resume with a partial assistant turn. Instead, send a **user** message that contains the partial response and asks the model to continue:
> "Your previous response was interrupted and ended with [previous_response]. Continue from where you left off."

Tool-use and thinking blocks "cannot be partially recovered" ([streaming § Error recovery](https://platform.claude.com/docs/en/build-with-claude/streaming)).

## Beach Day notes
- `/api/chat` is a Netlify **streaming** function. It has a 60 s limit and a 20 MB response limit (docs/03 §5). The SDK `timeout` is ~50_000 ms per attempt, a 55 s per-turn `signal` bounds retries, and a new tool round starts only with ≥ 15 s left; otherwise the turn hands off to `/api/jobs-run` (docs/04 §8).
- Re-emit only the docs/04 §2.1 events to the browser: `text`, `tool`, `proposal`, `handoff`, `error`, `done`. A refusal is `error {code: "refusal"}`. Never forward raw Anthropic events, thinking blocks, signatures or error internals. Ignore unknown event types.
- Response headers: `content-type: text/event-stream`, `cache-control: no-store`, `x-content-type-options: nosniff`. `_headers` doesn't cover function responses. The service worker must never cache `/api/*`.
- In the UI, the chat log is `role="log"` with `aria-busy="true"` while streaming. On `error {code: "refusal"}`, remove the partial bubble and show a plain message.
- Worked example with tests: `examples/01-streaming-chat-function/`.
