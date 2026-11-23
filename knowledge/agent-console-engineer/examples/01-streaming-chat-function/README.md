# Example 01: streaming chat function (Netlify v2 + Anthropic SDK)

## What it shows
`chat.mjs` is the shape of `netlify/functions/chat.mts`:

- **Netlify Functions v2 syntax.** `export default async (req, context) => Response` plus `export const config = { path: "/api/chat" }`.
- **Session first.** `requireSession` runs before any work, and the handler returns 401 if it fails. The production stub denies by default.
- **Input limits.** The body is capped at 32 KB (docs/04 §9). The conversation must end with a `user` turn, because assistant prefill returns 400 on current models.
- **A correct Claude request:**
  - `model: "claude-opus-5-5"`
  - `thinking: {type: "adaptive"}`
  - explicit `output_config.effort: "low"` (Opus 5.5 would default to `medium`)
  - no `temperature`/`top_p`/`top_k` (removed in API version `2026-10-21`)
  - no forced `tool_choice`
- **A simplified SSE stream to the browser.** It sends only `text`, `refusal`, `error` and `done`. Thinking blocks, signatures, `ping` and unknown event types are dropped, and the docs say clients must tolerate unknown event types.
- **Refusals.** `stop_reason: "refusal"` arrives with HTTP 200 and `stop_details` on `message_delta`. The function sends a `refusal` event, and the UI must discard any partial text it already showed.
- **Mid-stream errors.** An `event: error` such as `overloaded_error` after the 200 is caught. The browser gets a generic message, and the log records only the request ID and error type.
- **Response headers.** The function sets its own `content-type: text/event-stream`, `cache-control: no-store` and `x-content-type-options: nosniff`, because `_headers` does not apply to function responses.
- **SDK client settings.** `timeout: 50_000` stays under the 60 s Netlify limit, `maxRetries: 1`, and `baseURL` is pinned because the SDK otherwise reads `ANTHROPIC_BASE_URL` from the environment.

It is "what good looks like" because all of these are proven by tests against a mock, with no real key and no network.

Not covered here: tool rounds (see example 02), the 45 s handoff to a background job, and rate limits.

## Files
- `chat.mjs`: the handler factory `createChatHandler({client, requireSession, system})` plus the production default export.
- `mock-anthropic.mjs`: a local `node:http` server for `POST /v1/messages`. It emits real-shaped SSE events (`message_start`, a thinking block with only a `signature_delta`, `ping`, `text_delta`s, `message_delta`, `message_stop`) based on the examples on the streaming docs page. It also has refusal and `overloaded_error` scenarios, and it returns 400 if `temperature` or disabled/budgeted thinking is sent.
- `chat.test.mjs`: `node:test` tests.

**No real API is called.** The SDK's `baseURL` points at the local mock, and the key is the placeholder `sk-ant-EXAMPLE`.

## How to run
```bash
# outside the repo
mkdir -p /tmp/ex01 && cp *.mjs package.json /tmp/ex01 && cd /tmp/ex01
npm install          # installs @anthropic-ai/sdk 1.12.0
node --test chat.test.mjs
```

## Verified
Run on 2026-11-23 with Node v22.23.5 and @anthropic-ai/sdk 1.12.0, from a scratch copy whose `node_modules` was installed outside the repo:

```
$ node --test chat.test.mjs
# text {"text":"Hollywood Beach "}
# text {"text":"looks great "}
# text {"text":"today."}
# done {"stop_reason":"end_turn","usage":{"input_tokens":25,"output_tokens":15}}
ok 1 - streams text deltas and ends with done
ok 2 - request sent to Claude has the required shape
ok 3 - refusal becomes a refusal event (UI discards partial text)
# chat_failed { requestId: 'test-req', status: undefined, type: 'overloaded_error' }
ok 4 - mid-stream error event becomes a generic error event
ok 5 - 401 without a session, 400 when last turn is not user
# tests 5
# pass 5
# fail 0
```

Things learned while running it:
- SDK 1.12.0 sends `anthropic-version: 2026-10-21` and puts the key in `Authorization: Bearer …`, not `x-api-key`. The official docs show both forms in their curl examples.
- On a mid-stream `error` event, the SDK error has `status: undefined`. Branch on `err.error.error.type`, not on the HTTP status.
