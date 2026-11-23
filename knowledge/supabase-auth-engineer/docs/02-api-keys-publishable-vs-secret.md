# API keys: publishable vs secret (and the legacy anon / service_role pair)
Source: https://supabase.com/docs/guides/getting-started/api-keys (read as `apps/docs/content/guides/getting-started/api-keys.mdx` in the `supabase/supabase` repo; supabase.com itself blocked in this sandbox)
Retrieved: 2026-11-23

- **Publishable key** `sb_publishable_...`: "Safe to expose online: web page, mobile or desktop app ... source code." Maps to Postgres role `anon`, or `authenticated` once a user is signed in. It "only reaches what Row Level Security allows".
- **Secret key** `sb_secret_...`: backend only. It resolves to `service_role`, which has `BYPASSRLS`, so "Policies never apply to a secret key". Never in a browser, a bundle, source control, a URL or (until log sanitising exists) a request header. A secret key sent from a browser gets 401 (User-Agent match), but "an attacker can still use the key from other tools".
- **Legacy** `anon` / `service_role` are long-lived JWTs (they start `eyJ`). Both systems work side by side until the legacy keys are disabled in the Dashboard. "If a tool, tutorial, or AI assistant tells you to copy a long key that begins with `eyJ`, it was written for the legacy keys."
- Publishable and secret keys "aren't JWTs": send them on the **`apikey`** header, not `Authorization: Bearer`. The user's access token goes on `Authorization: Bearer`.
- What a publishable key does not protect against: reverse engineering, the network inspector, CSRF, XSS, phishing, MITM. Protection is RLS on every table.
- The Data API root `GET /rest/v1/` accepts only secret keys; test a publishable key against a table route or `/auth/v1/health`.

## Beach Day rules
- Only `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` exist, both non-secret, both safe in `public/` JS. **No secret key and no `service_role` key anywhere** (Dr. Lee's decision 9). If a grep finds `sb_secret_`, `service_role` or `eyJ` in the repo, stop and tell Vera.
- Functions send `apikey: <publishable>` plus `Authorization: Bearer <user token>`. They never see a privileged key, so a bug in a function cannot bypass RLS.
- Consequence: anything that would need `service_role` (for example promoting a user) is done by hand by Dr. Lee in the SQL editor.
