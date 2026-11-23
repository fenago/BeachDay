# 05 — Claude API reference for the Agent Console

> Scope: the parts of the Claude API (Messages API, models, tool use, streaming, rate limits) that the Agent Console's Netlify Functions need. Researched 2026-11-23. The API changes often; re-check the live docs before coding (links at the end).

## 1. Decisions in one table

| Topic | Decision | Why |
|---|---|---|
| Surface | **Messages API** (`POST /v1/messages`) with **client-defined tools**, called only from Netlify Functions | The project requires the key to stay server-side and the loop to run in our own functions. (Anthropic's hosted *Managed Agents* is an alternative — see §9.) |
| SDK | Official TypeScript SDK `@anthropic-ai/sdk` (works in plain JS too) | Never hand-roll `fetch` against the API in a JS project; the SDK gives typed errors, retries, streaming helpers. |
| Auth and endpoint | `ANTHROPIC_API_KEY` secret env var, Production context only (docs/04 §4.6; env-var scopes are Pro-only). The client passes it explicitly with `baseURL: "https://api.anthropic.com"` | Explicit values mean an injected `ANTHROPIC_BASE_URL` or Netlify AI-Gateway variable can't reroute calls or billing (docs/03 §5). Never sent to the browser. |
| Default model | `claude-opus-5-5` | Current default Opus. |
| Per-agent model | From the agent file's `model:` frontmatter (alias → ID map in §3). Console allow-list: Opus 5.5, Sonnet 5.5, Haiku 5.5 only | Lets cheaper agents run on Sonnet/Haiku; an approved agent edit can't pick an unlisted or pricier model. |
| Thinking | `thinking: {type: "adaptive"}` (or omit) | `budget_tokens` and `{type:"disabled"}` return **400** on Opus 5.5 / Sonnet 5.5 / Fable 5.x. |
| Effort | Set `output_config.effort` explicitly (`low` for chat, `high` for code-change jobs) | Opus 5.5 and Haiku 5.5 default to `medium`, not `high`. |
| Streaming | Always stream chat replies (`client.messages.stream`) | Long outputs; avoids HTTP timeouts; lets the UI show text as it arrives. |
| Tool choice | `tool_choice: {type: "auto"}` + `strict: true` on tools | Forced `any`/`tool` returns **400** on Opus 5.5, Sonnet 5.5 and Fable 5.1/5.2. |
| Refusals | Check `stop_reason === "refusal"` before reading content; enable server-side `fallbacks` | Safety classifiers can decline with HTTP 200. |

## 2. Current models (cached 2026-11-03 — confirm with `GET /v1/models`)

| Model | ID | Context | $ in / out per 1M tokens | Use in Beach Day |
|---|---|---|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | 1M | $4 / $20 | Default; code-change agents |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 1M | $2 / $10 | Everyday chat agents |
| Claude Haiku 5.5 | `claude-haiku-5-5` | 1M | $0.10 / $0.50 (≤100K prompt) | Cheap triage / summaries |
| Claude Fable 5.2 | `claude-fable-5-2` | 1M | $8 / $40 | Not on the Console allow-list (§3); Claude Code sessions only |

Rules: use the exact ID strings (no date suffixes). The Models API (`client.models.list()` / `.retrieve(id)`) returns `max_input_tokens`, `max_tokens` and `capabilities` for live checks.

## 3. Mapping `.claude/agents/*.md` to API calls

Claude Code subagent files are Markdown with YAML frontmatter; the body is the agent's system prompt ([docs](https://code.claude.com/docs/en/sub-agents)). Required fields: `name`, `description`. Optional fields include `tools`, `disallowedTools`, `model`, `color`, `effort`, `maxTurns`, `skills`, `mcpServers`, `memory`, `permissionMode`, `isolation`.

* `model` accepts `sonnet`, `opus`, `haiku`, `fable`, a full model ID, or `inherit`.
* **There is no standard `personality` field.** Claude Code ignores unknown frontmatter fields silently, so we can add our own `personality:` (one line) without breaking Claude Code. The Console should fall back to `description` if it is absent. (Typos in field names also fail silently — run `claude --debug` to catch them.)

Suggested file shape for the team:

```markdown
---
name: ui-designer
description: Builds and reviews the Beach Day mobile UI and accessibility.
model: sonnet
color: cyan
personality: Warm, visual, quick to sketch options; always checks contrast.
---
You are the UI designer for Beach Day...
```

Alias → API ID map used by the Netlify Function (keep in one module):

| `model:` value | API model ID |
|---|---|
| `opus` / `inherit` / missing | `claude-opus-5-5` |
| `sonnet` | `claude-sonnet-5-5` |
| `haiku` | `claude-haiku-5-5` |
| `fable`, a full ID, anything else | **build fails** (not on the Console allow-list) |

The Console allow-list is exactly these three IDs (docs/04 §11). `scripts/build-agents.mjs` fails the build on any other `model:` value and names the file; the chat and job functions re-check the resolved ID before calling Claude. Claude Code itself still accepts `fable` and full IDs, so an agent that needs one in Claude Code must not be shown in the Console until a human widens the list (a `scripts/**` + `netlify/**` change).

**How the deployed app gets the agent list.** Netlify Functions do not see the repo at runtime unless files are bundled. Two options:

1. **Build-time manifest (recommended):** a build script parses `.claude/agents/*.md` (e.g. with `gray-matter`) into `agents.json` (name, description, model, color, personality, system prompt) and bundles it with the function (`included_files` in `netlify.toml`). The public list endpoint returns everything except the system prompt. Every approved commit redeploys, so the manifest stays current.
2. Runtime read via the GitHub Contents API. Slower and spends GitHub rate limit; only needed if agents must change without a redeploy.

## 4. Messages API request shape (TypeScript SDK)

```ts
import Anthropic from "@anthropic-ai/sdk";
// Explicit endpoint and key: never let the environment choose them (docs/03 §5, docs/04 §8).
const client = new Anthropic({
  baseURL: "https://api.anthropic.com",
  apiKey: process.env.ANTHROPIC_API_KEY,   // read only after the production-context check
  timeout: 50_000,                          // ms; 840_000 in jobs-run
  maxRetries: 1,                            // 2 in jobs-run
});

const startedAt = Date.now();             // per chat turn
const signal = AbortSignal.timeout(Math.max(0, 55_000 - (Date.now() - startedAt)));
const stream = client.messages.stream({
  model: agent.model,                      // one of the three allow-listed IDs (§3)
  max_tokens: 64000,                       // streaming: give room; non-streaming ~16000
  thinking: { type: "adaptive" },
  output_config: { effort: "low" },
  system: [{ type: "text", text: agent.systemPrompt, cache_control: { type: "ephemeral" } }],
  tools,                                   // see §5
  messages,                                // [{role:"user"|"assistant", content}]
}, { signal });                            // the turn's deadline also bounds SDK retries
for await (const event of stream) {
  if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
    // forward event.delta.text to the browser (SSE / chunked response)
  }
}
const final = await stream.finalMessage();  // full message incl. tool_use blocks, usage
```

Key facts:

* `response.content` is an array of typed blocks (`text`, `thinking`, `tool_use`, …) — narrow by `.type`.
* **No assistant prefill** on current models (400). Use system-prompt instructions or structured outputs (`output_config.format`) to shape output.
* Thinking display defaults to `"omitted"` (empty thinking text). Set `thinking: {type:"adaptive", display:"summarized"}` if the UI should show reasoning summaries; otherwise the UI should show a "thinking…" indicator during the pause.
* **Prompt caching:** put the stable agent system prompt and tool definitions first and mark them `cache_control: {type:"ephemeral"}`. Cached reads are cheaper and do not count toward input-tokens-per-minute limits. Never put timestamps or request IDs in the system prompt (silently breaks the cache).
* Mid-conversation `{role:"system"}` messages are supported on Opus 5.5 / Sonnet 5.5 / Haiku 5.5 — useful to inject "proposal approved" state without editing the cached prefix.
* Always append the **full** `response.content` (not just text) back into `messages` on the next turn.

## 5. Tool use for "propose a change"

Agents never write to GitHub themselves. They get **read tools** and one **proposal tool**; the commit happens in a separate function only after a human clicks Approve.

```ts
const tools = [
  {
    name: "read_file",
    description: "Read a file from the Beach Day repo (main branch). Paths are repo-relative.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
  {
    name: "list_files",
    description: "List files under a repo directory.",
    strict: true,
    input_schema: { type: "object", properties: { dir: { type: "string" } }, required: ["dir"], additionalProperties: false },
  },
  {
    name: "propose_change",
    description:
      "Propose edits for human review. Nothing is committed until the user approves. " +
      "Only paths on the allow-list are accepted. Send full new file contents.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        files: {
          type: "array",
          items: {
            type: "object",
            properties: { path: { type: "string" }, content: { type: "string" } },
            required: ["path", "content"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "files"],
      additionalProperties: false,
    },
  },
];
```

Loop rules (manual loop or the SDK's beta Tool Runner, `client.beta.messages.toolRunner`):

* Continue while `stop_reason === "tool_use"`; stop on `end_turn`.
* Return **all** `tool_result` blocks for one assistant turn in **one** user message, each with the matching `tool_use_id`. On failure send `is_error: true` with a clear message (e.g. "path not on allow-list") instead of dropping it.
* **Validate tool input server-side anyway** (path allow-list, size caps, no `..`). `strict: true` guarantees schema shape, not safety. Parse with `JSON.parse`, never string matching.
* If `stop_reason` is `max_tokens` while a `tool_use` block is present, the input may be truncated — do not run it; retry with more `max_tokens`.
* If streaming with client tools, set `eager_input_streaming: true` on each tool and validate the parsed input before running it.
* Cap iterations per job (e.g. 15 tool rounds) and total tokens per job. On Opus 5.5 / Sonnet 5.5 you can also set a beta **task budget** (`output_config.task_budget`, header `task-budgets-2026-03-13`, min 20,000 tokens) so the model paces itself.
* `propose_change` writes a proposal record (status `pending`) to Netlify Blobs and returns its ID to the model; the UI renders a diff with Approve / Reject.

## 6. Streaming events (what the browser needs)

SSE event sequence: `message_start` → (`content_block_start` → `content_block_delta`* → `content_block_stop`)* → `message_delta` (carries `stop_reason`, usage) → `message_stop`. Delta types: `text_delta`, `thinking_delta`, `input_json_delta` (tool input). `ping` and `error` events can appear at any time.

The function should re-emit a **simplified** event stream to the browser (e.g. `{type:"text", text}`, `{type:"tool", name, status}`, `{type:"proposal", id}`, `{type:"done"}`) rather than raw API events, so no internal data leaks and the UI stays simple. See doc 04 for how this fits Netlify's time limits.

## 7. Refusals and errors

* **Refusals:** HTTP 200 with `stop_reason: "refusal"` (optional `stop_details.category`). Check before reading `content`; a mid-stream refusal means discard the partial output. For Opus 5.5 / Sonnet 5.5, opt into server-side fallbacks: `client.beta.messages.create({ ..., betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" })`.
* **Errors:** catch specific SDK classes, most specific first (`Anthropic.NotFoundError`, `Anthropic.RateLimitError`, `Anthropic.APIError`, `Anthropic.APIConnectionError`). The SDK retries 408/409/429/5xx twice by default (`maxRetries`). TypeScript `timeout` is in **milliseconds** (default 10 min) — set it below the Netlify function limit.
* 400 errors you will see if you copy old examples: `budget_tokens`, `thinking: {type:"disabled"}`, forced `tool_choice`, assistant prefill, `temperature`/`top_p`/`top_k` (rejected on current models).

## 8. Rate limits, spend limits, cost control

From the [rate-limits doc](https://platform.claude.com/docs/en/api/rate-limits):

* Limits are per organization, per model class: requests/min (RPM), input tokens/min (ITPM), output tokens/min (OTPM). Start tier: Opus 5.5 / Sonnet 5.5 / Haiku 5.5 each 4,000 RPM, 2M ITPM, 400K OTPM. New orgs may begin in a lower **Evaluation** tier.
* 429 `rate_limit_error` includes a `retry-after` header (seconds). `error.details.error_code` distinguishes `ramp_limit_exceeded` (sudden bursts) and `enforced_spend_limit_reached` (monthly cap — no `retry-after`; retries fail until the 1st of the month).
* **Spend limits:** each tier has a monthly cap (Start $500, Build $1,000, Scale $200,000). You can set a lower **organization or workspace spend limit** in the Console (`platform.claude.com/settings/spend-limits`); hitting it returns HTTP 400 `invalid_request_error` "You have reached your specified … usage limits".
* **Recommendation for Beach Day:** create a dedicated workspace and API key for the deployed app with a low monthly spend limit (e.g. $20) and per-workspace rate limits. This is the hard backstop behind the app's own per-user limits (doc 04).
* Cached input tokens don't count toward ITPM — another reason to cache the system prompt.

## 9. Alternative considered: Claude Managed Agents

Anthropic's Managed Agents (beta) hosts the agent loop and a per-session sandbox container, streams events, and has session budgets and webhooks. It would remove the Netlify time-limit problem for long jobs (the function only starts a session and relays events). Trade-offs: beta; billed for session runtime on top of tokens; session history kept until deleted; GitHub repo must be mounted into the environment. The brief asked for the Claude API called from a Netlify Function, so the baseline design uses the Messages API; Managed Agents is the upgrade path if long jobs outgrow background functions.

## 10. Sources

* Messages API: https://platform.claude.com/docs/en/api/messages/create
* Models overview: https://platform.claude.com/docs/en/about-claude/models/overview
* Tool use: https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview
* Streaming: https://platform.claude.com/docs/en/build-with-claude/streaming
* Adaptive thinking / effort: https://platform.claude.com/docs/en/build-with-claude/adaptive-thinking , https://platform.claude.com/docs/en/build-with-claude/effort
* Prompt caching: https://platform.claude.com/docs/en/build-with-claude/prompt-caching
* Refusals and fallback: https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
* Task budgets: https://platform.claude.com/docs/en/build-with-claude/task-budgets
* Rate limits: https://platform.claude.com/docs/en/api/rate-limits
* Errors: https://platform.claude.com/docs/en/api/errors
* TypeScript SDK: https://github.com/anthropics/anthropic-sdk-typescript
* Claude Code subagents: https://code.claude.com/docs/en/sub-agents
