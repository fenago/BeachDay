# supabase/

Database and auth-client files for the Agent Console's sign-in (ADR-0006). Owner: supabase-auth-engineer. Any change here needs security-engineer review (docs/expert-roster.md §5).

| Path | What it is | Who runs it |
|---|---|---|
| `migrations/20261123000000_profiles.sql` | `public.profiles` (id → `auth.users` on delete cascade, `role` default `'user'`), RLS with one select-own-row policy, **no** INSERT/UPDATE/DELETE grant to `anon` or `authenticated`, and the sign-up trigger that inserts `id` only | Dr. Lee, once per project |
| `manual/promote-super-admin.sql` | Look-first, then promote **one** confirmed user to `super_admin`. **Not a migration.** | Dr. Lee, by hand, in the SQL editor |
| `vendor/entry-auth.js`, `vendor/build-auth-bundle.mjs` | How `public/vendor/supabase-auth-js-2.119.2.mjs` is built from the pinned `@supabase/auth-js` | A human, only when the pinned version changes |

No file here, in the app or in the tests uses the Supabase secret key or the legacy `service_role` key. Only `SUPABASE_URL` and the publishable key exist (docs/04 §4.1).

## Apply the migration

Do this on a **throwaway project first**: the SQL was tested in pglite with stand-ins for Supabase's `auth` schema and roles, not on a real project.

Either:
- **SQL editor:** Dashboard → SQL Editor → New query. Paste `migrations/20261123000000_profiles.sql` and run it once. Or:
- **CLI:** `supabase link --project-ref <project-ref>`, then `supabase db push`. The CLI applies files in `supabase/migrations/` that the project hasn't recorded yet. `manual/` is not read by the CLI.

Then:
1. Dashboard → Advisors → **Security Advisor**: expect no warning on `public.profiles` (pre-launch test (i), docs/04 §4.2).
2. Create a test user, and check that a row with `role = 'user'` appears in `public.profiles`. A failing trigger blocks every sign-up, so check this straight away.
3. Make the Dashboard settings in docs/04 §4.5 (Confirm email **and** Confirm phone on, password minimum 12, JWT expiry 600 s, Site URL and the one exact Redirect URL `https://<production host>/console`, custom SMTP, `token_hash` email templates, asymmetric signing keys, anonymous sign-ins off). The Google client setup is in the `google-oauth-signin` skill.

## Promote Dr. Lee to super_admin (once, by hand)

1. Sign up and confirm your email (or use Continue with Google), the way you'll normally sign in.
2. SQL editor: run **STEP 1** of `manual/promote-super-admin.sql` with your address. Read every check in the comments. Stop if anything is unexpected (an extra provider, an MFA factor you didn't enrol, a pending email change).
3. Run **STEP 2** with the id from STEP 1. Expect `1 row affected`. `0` means the id is wrong or the email isn't confirmed; nothing changed.
4. The role is read on every request (no cache), so the next Console call sees it.

Demotion: `update public.profiles set role = 'user' where id = '<USER_ID>';` (applies on the next request).

## Rebuild the vendored auth bundle (only when the pin changes)

```bash
npm ci
node supabase/vendor/build-auth-bundle.mjs   # writes public/vendor/supabase-auth-js-<version>.mjs + the licence file
npx vitest run tests/unit/vendor-version.test.mjs
```
If the version changes, rename the file, update the import in `public/js/console/auth.js`, and get security-engineer's review. `public/vendor/**` is denied to agents.
