# Example 01: streaming chat function (Netlify v2 + Anthropic SDK + Supabase guard)

## What it shows
`chat.mjs` is the shape of `netlify/functions/chat.mts`, in the order docs/04 §4.1, §4.6 and §8 require:

1. **Method.** Anything but `POST` gets 405.
2. **Guard first.** An injected `guard(req, context)` stands in for `lib/auth` (supabase-auth-engineer's token-and-role check plus the Origin check). It runs before the body is read. Its outcomes map to **401** (`www-authenticate: Bearer`), **403** and **503**. A thrown error or an unexpected status becomes 503, so it fails closed. The upstream error is never echoed. The production stub always answers 503.
3. **Production only.** Outside `context.deploy.context === "production"` the function answers 503 before the SDK client, and with it the key, is created.
4. **Input.** Body ≤ 32 KB before parsing. `{agent, messages}`, where messages alternate `user`/`assistant`, have **string** content only (the browser never sends `tool_use`, `tool_result` or `thinking` blocks), and end with `user` (no prefill).
5. **Model allow-list.** The agent's resolved model must be `claude-opus-5-5`, `claude-sonnet-5-5` or `claude-haiku-5-5` (docs/04 §11). Anything else is a 500 that never reaches Claude.
6. **A correct Claude request:** adaptive thinking, explicit `output_config.effort: "low"`, no `temperature`/`top_p`/`top_k`, no forced `tool_choice`. The production client passes `baseURL: "https://api.anthropic.com"` **and** `apiKey` explicitly, with `timeout: 50_000` and `maxRetries: 1`.
7. **One deadline per turn.** `AbortSignal.timeout(55 s − elapsed)` is passed as the SDK request option `{ signal }`. It bounds the SDK's retries too, which the per-attempt `timeout` does not. A timeout ends the stream with `error {code: "timeout"}`.
8. **docs/04 §2.1 SSE events only.** `event:` equals `data.type`. `text {delta}`, then exactly one `done {stopReason}` or `error {code, message, retryable}`. Thinking, signatures, `ping` and unknown events are dropped.
9. **Refusals** end with `error {code: "refusal", retryable: false}`. The UI removes the partial bubble. The refusal category is logged, not shown.
10. **Mid-stream errors** (an `event: error` after the 200) become a generic `upstream` error. Logs hold the request id and error type only.
11. **Headers on every status:** `cache-control: no-store`, `x-content-type-options: nosniff`, an explicit `content-type`, and the JSON CSP on error bodies. No `Access-Control-Allow-*`.

Not covered here: tool rounds (example 02), the hand-off to `/api/jobs-run`, per-user counters and the compute budget (docs/04 §8, §9).

## Files
- `chat.mjs`: `createChatHandler({guard, getClient, getAgent, deadlineMs?, now?})` plus the production default export and `config` (path, method, the `/api/chat` rate-limit rule).
- `mock-anthropic.mjs`: a local `node:http` server for `POST /v1/messages`. It emits real-shaped SSE events (`message_start`, a thinking block with only a `signature_delta`, `ping`, `text_delta`s, `message_delta`, `message_stop`) based on the streaming docs page. Scenarios: `refuse`, `overload` (mid-stream `overloaded_error`), `slow` (2 s before headers). It returns 400 if `temperature` or disabled/budgeted thinking is sent.
- `chat.test.mjs`: 8 `node:test` tests, with a fake guard selected by the Bearer value (`admin`, `user`, `down`, anything else).

**No real API is called.** The SDK's `baseURL` points at the local mock, and the key is the placeholder `sk-ant-EXAMPLE`, which is too short to match the secret scan.

## How to run
```bash
# outside the repo
mkdir -p /tmp/ex01 && cp *.mjs package.json /tmp/ex01 && cd /tmp/ex01
npm install          # installs @anthropic-ai/sdk 1.12.0
node --test chat.test.mjs
```

## Verified
Re-run on 2026-11-23 after the Supabase rework, with Node v22.23.5 and @anthropic-ai/sdk 1.12.0, from a scratch copy whose `node_modules` was installed outside the repo (trimmed to the result lines):

```
$ node --test chat.test.mjs
# text {"type":"text","delta":"Hollywood Beach "}
# text {"type":"text","delta":"looks great "}
# text {"type":"text","delta":"today."}
# done {"type":"done","stopReason":"end_turn"}
ok 1 - streams text deltas and ends with exactly one done (docs/04 §2.1 shapes)
ok 2 - request sent to Claude has the required shape
# chat_refusal { requestId: 'test-req', category: 'cyber' }
ok 3 - refusal ends with error{code:refusal}, no done, no category shown
ok 4 - mid-stream error event becomes a generic upstream error
ok 5 - guard outcomes: 401 / 403 / 503, JSON error shape, and Claude is never called
ok 6 - outside production: 503 before the client (and the key) is touched
ok 7 - bad input: trailing assistant turn, smuggled block content, unknown agent → 400; fable model → 500
# deadline 300 ms, stream closed after 304 ms
ok 8 - per-turn deadline aborts a slow upstream and ends with error{code:timeout}
# tests 8
# pass 8
# fail 0
```

Things learned while running it:
- SDK 1.12.0 sends `anthropic-version: 2026-10-21` and puts the key in `Authorization: Bearer …`, not `x-api-key`. The official docs show both forms in their curl examples.
- On a mid-stream `error` event, the SDK error has `status: undefined`. Branch on `err.error.error.type`, not on the HTTP status.
- The SDK 1.12.0 request option `{ signal }` on `messages.stream(params, options)` aborts the request; the stream then throws, and `signal.aborted` tells a deadline apart from an upstream error (test 8).
