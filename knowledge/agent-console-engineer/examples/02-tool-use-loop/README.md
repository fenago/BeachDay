# Example 02: manual tool-use loop (read_file / list_files / propose_change)

## What it shows
This is the core of the background agent job (`/api/jobs`). It is what good looks like for these reasons.

**Strict tool definitions** (`tools.mjs`):
- Each tool has `strict: true`, and every object in its schema, nested `files[]` items included, sets `additionalProperties: false`. The strict-tool docs require that.
- Names match `^[a-zA-Z0-9_-]{1,128}$`.
- Each tool has a description that says when to use it.

**The loop** (`agent-loop.mjs`). It follows the rules on the "Handle tool calls" page:
- Continue while `stop_reason === "tool_use"`.
- Append `response.content` **unchanged** as the assistant turn. That includes the `thinking` blocks Opus 5.5 always returns.
- Answer **every** `tool_use` with a `tool_result`, and put all results in **one** user message, results first.
- Return failures as `is_error: true`. The model then recovers by itself: in the test it tries `netlify.toml`, gets "deny list" back and re-proposes `public/index.html`.

**Request settings:**
- `tool_choice: {type: "auto"}`, because `any` and `tool` return 400 on Opus 5.5 and Sonnet 5.5.
- `thinking: {type: "adaptive"}`.
- `output_config.effort: "high"` for code-change jobs.
- No sampling parameters.

**Stop reasons:**
- `max_tokens`: a possibly truncated `tool_use` is **not** executed.
- `refusal`: the partial output is discarded.
- `pause_turn` and others: the job stops cleanly. `pause_turn` only happens with server tools, and we have none.
- `maxRounds` (default 15) caps runaway loops and spend.

**Policy is code, not prompt.** `propose_change` re-checks the path allow-list, the file count and the size, and only stores a `pending` proposal. No tool can commit. Approve is a separate, human-only endpoint (example 03).

**Tools run serially.** They will become GitHub API reads, and GitHub asks for serial requests.

`mock-anthropic.mjs` is a scripted local `node:http` mock of `POST /v1/messages`. Like the real API, it returns **400** for:
- forced `tool_choice`;
- strict tools whose objects aren't closed;
- missing or misordered `tool_result`s;
- a conversation that ends with an assistant turn.

**No real API or key is used.** The key is the placeholder `sk-ant-EXAMPLE`.

## How to run
```bash
mkdir -p /tmp/ex02 && cp *.mjs package.json /tmp/ex02 && cd /tmp/ex02
npm install
node --test agent-loop.test.mjs
```

## Verified
Run on 2026-11-23 with Node v22.23.5 and @anthropic-ai/sdk 1.12.0, from a scratch copy outside the repo:

```
$ node --test agent-loop.test.mjs
# round 1: stop_reason=tool_use blocks=thinking,text,tool_use,tool_use
# round 2: stop_reason=tool_use blocks=thinking,tool_use
# round 3: stop_reason=tool_use blocks=thinking,tool_use
# round 4: stop_reason=end_turn blocks=thinking,text
ok 1 - happy path: parallel calls, is_error recovery, proposal stored, never committed
ok 2 - max rounds stops a runaway loop
ok 3 - tool_use cut off by max_tokens is never executed
ok 4 - tool definitions are strict and closed
ok 5 - mock rejects forced tool_choice like the real API
ok 6 - checkPath basics
# tests 6
# pass 6
# fail 0
```

`checkPath` here is a minimal stand-in. The full, tested allow-list and deny-list validator is in `knowledge/security-engineer/examples/02-path-allowlist/`.
