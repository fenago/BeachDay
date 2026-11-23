# 0004 — Stay on the Netlify Free plan for now
- Status: Accepted
- Date: 2026-11-23
- Deciders: Dr. Lee

## Context
The Free plan gives 300 credits a month as a hard cap, and the site pauses when they run out. A production deploy costs 15 credits, so that is about 20 deploys a month. Free includes Functions, background and scheduled functions, Secrets Controller, code-based rate limits (2 rules) and basic firewall rules. It does **not** include site password protection, env-var scopes or function region choice.

## Decision
Stay on Free.

## Consequences
- The Console password gate is implemented in the functions, not by Netlify.
- Each proposal goes in as one atomic commit.
- Docs-only commits skip builds via `[build] ignore`.
- Builds can read env vars because scopes are not available on Free, so build scripts must never print env.
- Only 2 `config.rateLimit` rules: `/api/login` and `/api/chat`. Other limits use Blobs counters.
- The orchestrator or netlify-engineer watches credit usage.

## Revisit when
Monthly usage passes about 70% of credits, or a site password or env scopes are needed. Move to Personal ($9/mo, 1,000 credits) or Pro.
