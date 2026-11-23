# Knowledge: agent-console-engineer
Date: 2026-11-23

Reference notes from official docs, plus worked examples that ran against local mocks. Read these together with `docs/04-agent-console.md`, `docs/05-claude-api.md` and the ADRs.

## docs/
| File | Covers | Read it when |
|---|---|---|
| [docs/01-claude-models-and-request-rules.md](docs/01-claude-models-and-request-rules.md) | Model IDs, prices, default effort per model, the Opus 5.5 request checklist (adaptive thinking, no prefill, no sampling params), `anthropic-version: 2026-10-21`, SDK defaults | Writing or reviewing any `messages.create`/`stream` call, or mapping agent `model:` aliases |
| [docs/02-claude-streaming.md](docs/02-claude-streaming.md) | SSE event flow and exact JSON, delta types, mid-stream `error` events, refusals in a stream, resuming without prefill | Building `/api/chat` or the browser's SSE reader |
| [docs/03-claude-tool-use.md](docs/03-claude-tool-use.md) | Tool definition fields, strict-schema subset (no `maxLength`/`maxItems`), forced `tool_choice` 400, the client loop and `tool_result` ordering, stop reasons in the loop | Building the agent job loop or changing `read_file`/`list_files`/`propose_change` |
| [docs/04-claude-errors-limits-refusals.md](docs/04-claude-errors-limits-refusals.md) | HTTP error table, error body, SDK retries, rate-limit tiers and headers, spend cap (429) vs your spend limit (400), refusal categories and server-side fallback | Error handling, cost controls, refusal UX |
| [docs/05-github-rest-auth-versions-limits.md](docs/05-github-rest-auth-versions-limits.md) | Bearer auth, required headers (User-Agent!), API versions `2022-11-28`/`2026-03-10`, primary and secondary rate limits, fine-grained PAT permissions per endpoint | Writing `lib/github`, or debugging 401/403/404/429 from GitHub |
| [docs/06-github-git-database-and-contents.md](docs/06-github-git-database-and-contents.md) | refs/commits/trees/blobs and Contents API fields, limits and status codes; why `base_tree` and `force:false`; the Approve sequence | Building or reviewing the approve function and `read_file` |

## examples/
| Example | Demonstrates | Verified |
|---|---|---|
| [examples/01-streaming-chat-function/](examples/01-streaming-chat-function/) | Netlify v2 streaming function: token-and-role guard first (401/403/503, fail closed), production-only, explicit `baseURL` and key, model allow-list, per-turn deadline `signal`, docs/04 §2.1 SSE events | 8/8 `node:test` against a local SSE mock (re-run 2026-11-23 after the Supabase rework) |
| [examples/02-tool-use-loop/](examples/02-tool-use-loop/) | Manual tool loop: strict tools, all `tool_result`s in one user message, `is_error` recovery, max rounds, never running a truncated `tool_use` | 6/6 against a mock that 400s on rule violations |
| [examples/03-atomic-commit/](examples/03-atomic-commit/) | One atomic multi-file commit via the Git Database API, stale-base check, one retry on non-fast-forward, plus GET contents | 6/6 against a mock GitHub that asserts headers and sequence |

None of the examples call a real API or use a real credential. The placeholders are `sk-ant-EXAMPLE` and `github_pat_EXAMPLE`. To run them, copy an example folder outside the repo and run `npm install` there. Never commit `node_modules`.

## Differences found against the brief and the repo skills (2026-11-23)
- **Sampling parameters:** `temperature`/`top_p`/`top_k` are rejected on **every** model under API version `2026-10-21`, which SDK 1.12.0 sends.
- **Default effort:** Sonnet 5.5 and Fable 5.2 default to `high`; Opus 5.5 and Haiku 5.5 default to `medium`.
- **Spend limits:** a spend limit *you set* returns **400**. The tier monthly cap returns 429 `enforced_spend_limit_reached`.
- **API key header:** SDK 1.12.0 sends the key as `Authorization: Bearer`. The docs show `x-api-key` too.
- **Supabase Auth (ADR-0006), wave 3:** the old password, session cookie and CSRF header are gone from this folder. Example 01's guard is injected and stands in for `lib/auth` (supabase-auth-engineer owns it); the browser side is in docs/04 §1.
- **GitHub API version:** the GitHub docs now default their examples to `X-GitHub-Api-Version: 2026-03-10`. `2022-11-28` stays supported until 2028-03-10.
