# Example 02: profiles table, RLS, trigger, safe promotion, and "role is never self-writable"

## What it shows
`profiles.sql` is the SQL Dr. Lee runs in the Supabase SQL editor:
- `profiles`: `id` references `auth.users` on delete cascade; `role` defaults to `'user'`, with a check constraint.
- RLS with one select policy for the user's own row.
- **No write grants** to API roles.
- A `security definer set search_path = ''` trigger that creates the row.

`promote-super-admin.sql` is the by-hand promotion, in two steps:
1. **Look first.** One row for the email. `email_confirmed_at` is set. `last_sign_in_at` is his own recent sign-in. Every linked identity (`email`, `google`) is one he set up himself.
2. **Promote.** The update also requires `email_confirmed_at is not null`. An unconfirmed account changes 0 rows.

`profiles.test.mjs` runs both files in **pglite** (Postgres in WASM). It uses stand-ins for Supabase's `anon`/`authenticated` roles, `auth.users`, `auth.identities` and `auth.uid()`, and switches roles with `set role`, the way the API does.

## Run
```bash
cd knowledge/supabase-auth-engineer/examples/02-profiles-rls-sql
npm install      # @electric-sql/pglite 0.6.0; do not commit node_modules
npm test
```

## Verified
Run 2026-11-23 from a clean install, Node v22.23.5, pglite 0.6.0:
```
ok 1 - trigger creates a profile with role user; user_metadata role is ignored
ok 2 - a user reads only their own row
ok 3 - anon reads nothing (no grant)
ok 4 - a user cannot update their own role (privilege denied)
ok 5 - a user cannot insert a profile or delete one
ok 6 - role check constraint rejects unknown roles
ok 7 - the trigger function is not executable by API roles
ok 8 - promotion refuses a user whose email is not confirmed (0 rows changed)
ok 9 - step 1 of the promotion file lists confirmation, last sign-in and every identity
ok 10 - Dr. Lee by hand: a confirmed user is promoted (1 row); the user then sees super_admin
ok 11 - promotion cannot be run by an API user (privilege denied)
ok 12 - deleting the auth user cascades to the profile
# tests 12
# pass 12
# fail 0
```
Tests 8–11 were written first and failed until `promote-super-admin.sql` existed.

## Why step 1 matters (pre-account takeover)
Anyone can sign up with Dr. Lee's address and a password of their choosing. The account stays unconfirmed, but the confirmation email lands in **his** inbox.
- If he clicks that link, the account is confirmed **with the other person's password**.
- If he later signs up himself, the Auth server does not replace the existing password. Read in `supabase/auth` `internal/api/signup.go`: "do not update the user because we can't be sure of their claimed identity".

So:
- Never click a confirmation email you did not ask for.
- If step 1 lists `email` and you never chose this account's password, run "Forgot password" first.
- Enrol TOTP (docs/04 §4.5).

## Not verified
- **The SQL has not run on a real Supabase project.** The `auth` schema, roles and `auth.uid()` are stubs. Real default grants, the Security Advisor and the trigger on the managed `auth.users` table are untested. Dry-run it on a throwaway project first.
- The real `auth.identities` has more columns. Step 1 reads only `user_id` and `provider`, which the docs name.

## Why privileges and not a policy
An UPDATE policy cannot restrict one column (docs/05), so the table grants API roles no write privilege at all.
