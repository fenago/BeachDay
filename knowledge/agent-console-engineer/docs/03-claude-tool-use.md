# Claude tool use: definitions, strict schemas, the client loop
Source: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview · https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools · https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls · https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use · https://platform.claude.com/docs/en/build-with-claude/structured-outputs · https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming
Retrieved: 2026-11-23

## Client tools vs server tools ([overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview))
- **Client tools** run in our code. Claude answers with `stop_reason: "tool_use"` plus `tool_use` blocks, and we send back `tool_result`s.
- **Server tools** (`web_search`, `web_fetch`, `code_execution`, `tool_search`) run at Anthropic. Beach Day uses **only client tools**.

## Tool definition fields ([define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools))
| Field | Notes |
|---|---|
| `name` | must match `^[a-zA-Z0-9_-]{1,128}$` |
| `description` | the most important field. Say what the tool does, when to use it, and its limits |
| `input_schema` | JSON Schema object |
| `input_examples` | optional array of schema-valid example inputs |
| `strict` | `true` means inputs are guaranteed to match the schema (grammar-constrained sampling) |
| `eager_input_streaming` | optional; fine-grained streaming of input values (see below) |
| `cache_control`, `defer_loading`, `allowed_callers` | optional; see the tool reference |

## Strict schemas ([strict tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/strict-tool-use), [JSON Schema limitations](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations))
- **Supported:**
  - the basic types
  - `enum`/`const`
  - `anyOf`/`allOf` (with restrictions)
  - `$ref`/`$defs`
  - `required`
  - `additionalProperties`, which **must be `false` for objects**
  - string `format`s (`date-time`, `email`, `uri`, `uuid`, …)
  - array `minItems` of 0 or 1 only
- **Not supported** (400 if used):
  - recursive schemas, `oneOf`, `not`
  - numeric constraints (`minimum`, `maximum`, `multipleOf`)
  - **string constraints (`minLength`, `maxLength`)**
  - array constraints beyond `minItems` 0/1, so **no `maxItems`**
  - external `$ref`
- Strict guarantees the **shape**, not the **safety**. Lengths, counts and path rules must be enforced in code.
- Data note: only the JSON schema is cached, for up to 24 h since last use. The same grammar pipeline is used for structured outputs.

```json
{ "name": "propose_change", "strict": true,
  "description": "Store a proposed change for a human to review. Never commits. Allow-listed paths only.",
  "input_schema": { "type": "object", "additionalProperties": false, "required": ["summary","files"],
    "properties": {
      "summary": { "type": "string" },
      "files": { "type": "array", "items": { "type": "object", "additionalProperties": false,
        "required": ["path","content"], "properties": { "path": {"type":"string"}, "content": {"type":"string"} } } } } } }
```

## `tool_choice`
- Values are `auto` (the default), `any`, `tool` (with `name`) and `none`.
- Forced tool use is **not supported** on Claude Fable 5.2, Mythos 5.2, **Opus 5.5**, **Sonnet 5.5**, Fable 5.1 and Mythos 5.1. Sending `any` or `tool` returns 400 `invalid_request_error`, including on the token-counting endpoint, with the message:
  > `tool_choice: type "tool" and "any" are not supported for this model.`

  ([errors § Forced tool use not supported](https://platform.claude.com/docs/en/api/errors), [define tools](https://platform.claude.com/docs/en/agents-and-tools/tool-use/define-tools))
- What to do instead: use `auto` with strict tools, and say in the prompt which tool to use. Haiku 5.5 is not in that list. Beach Day uses `auto` everywhere anyway.
- `{"type":"auto","disable_parallel_tool_use":true}` limits Claude to at most one tool call per turn ([overview](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)).
- Changing `tool_choice` invalidates cached *message* blocks. Tools and system prompt stay cached.

## The client loop ([handle tool calls](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls))
1. The response has `stop_reason: "tool_use"` and one or more `tool_use` blocks, each with `id`, `name` and `input`.
2. Run each tool.
3. Add the response's `content` **unchanged** as an `assistant` message.
4. Add **one** `user` message with **one `tool_result` per `tool_use`**, even if the tool failed.
5. Resend with the **same `tools`**, and repeat while `stop_reason` is `tool_use`.

`tool_result` fields:
- `type: "tool_result"`
- `tool_use_id`
- `content` (optional): a string, or blocks of `text`, `image`, `document` or `search_result`
- `is_error` (optional): `true` when the tool failed or the call was invalid

Formatting rules (exact):
- "Tool result blocks must immediately follow their corresponding tool use blocks in the message history."
- "In the user message containing tool results, the `tool_result` blocks must come FIRST in the content array. Any text must come AFTER all tool results."
- The error you get otherwise: "tool_use ids were found without tool_result blocks immediately after".

Opus 5.5 always returns `thinking` blocks first. Pass them back unmodified as part of `content` (doc 01).

## Stop reasons that matter in the loop ([stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons))
| `stop_reason` | Action |
|---|---|
| `tool_use` | run the tools, send results, loop |
| `end_turn` / `stop_sequence` | done |
| `max_tokens` | output truncated. A `tool_use` input may be cut off, so **don't run it**. Raise `max_tokens` or stop |
| `pause_turn` | server-tool loop hit its iteration limit; send the content back. Can't happen without server tools |
| `refusal` | declined (HTTP 200). Read `stop_details`, discard the output, reset or fall back (doc 04) |
| `model_context_window_exceeded` | treat as truncated |

## Fine-grained input streaming ([fine-grained tool streaming](https://platform.claude.com/docs/en/agents-and-tools/tool-use/fine-grained-tool-streaming))
- `eager_input_streaming: true` per tool, with `stream: true`, sends `input_json_delta` fragments as soon as Claude starts a parameter.
- "the API does not buffer or validate a tool's input before streaming it, you might receive partial or invalid JSON." Guard the `JSON.parse` and return unparseable input as an `is_error` result.
- Without it, the API "buffers and validates each parameter value before streaming it back".

## Prompt injection through tool results
The handle-tool-calls page warns that tool results carry outside content (here, repo files the agent reads), which can contain "indirect prompt injection". Keep that content inside `tool_result` blocks, never in `system` or user text.

## Beach Day notes
- The three tools are `read_file(path)`, `list_files(dir)` and `propose_change({summary, files:[{path, content}]})`. All are `strict: true` with closed objects. Size and count limits (≤20 files, ≤200 KB each) are enforced in code, because strict schemas can't express `maxItems`/`maxLength`.
- `propose_change` stores a **pending** proposal in Blobs and returns its ID. **No tool can commit.** Committing is the human-only Approve endpoint (ADR-0003).
- The allow-list is re-checked in `propose_change` *and* at approve time. Denials go back as `is_error: true` so the agent can correct itself.
- Cap rounds at 15 per job, and cap `max_tokens`. On `max_tokens` with a pending `tool_use`, stop and do not run it.
- `read_file` and `list_files` go through the GitHub Contents API, so run them **serially**, not in parallel, even when Claude asks for several at once.
- Worked example with tests: `examples/02-tool-use-loop/`.
