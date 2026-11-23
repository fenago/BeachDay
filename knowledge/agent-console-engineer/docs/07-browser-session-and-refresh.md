# Browser session and token refresh (Console page)

Date: 2026-11-23 · Source: docs/04 §4.3 and knowledge/supabase-auth-engineer/examples/03-browser-auth-calls/ (12/12 tests). Hosted behaviour is UNVERIFIED.

What the Console page does, so the chat client and the functions agree:

- **Storage.** auth-js keeps the session in `localStorage` (its default). The page never copies tokens anywhere else, and never logs them. The chat draft and transcript are memory-only (docs/04 §1).
- **Refresh.** `autoRefreshToken: true`. The library ticker runs every 30 s and refreshes when about 90 s are left. Access tokens live 10 minutes (600 s).
- **Before a long call.** Call `ensureFresh(120)` before `/api/chat` and `/api/jobs`: refresh if fewer than 120 s are left, then send `Authorization: Bearer <access_token>`. A chat turn can run about 60 s, and the function checks the token only at its start.
- **Never send a stale token on purpose.** On `401` (not `step_up_required`), try one refresh and one retry, then show "Session ended". On `401 step_up_required`, reopen the Confirm sheet; no refresh helps, because refresh does not make a sign-in fresher.
- **Other tabs.** auth-js shares the session across tabs through `localStorage`, so a sign-out in one tab ends the others at their next check.
- **Not your job.** Sign-in flows, the role check and `profiles` belong to supabase-auth-engineer. Read `.claude/skills/supabase-auth/SKILL.md` before changing the client.
