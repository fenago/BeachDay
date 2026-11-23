# Example 02: profiles table, RLS, trigger, and "role is never self-writable"

## What it shows
`profiles.sql` is the SQL Dr. Lee runs in the Supabase SQL editor: `profiles` (`id` references `auth.users` on delete cascade, `role` default `'user'` with a check constraint), RLS with one select policy for the own row, **no write grants** to API roles, a `security definer set search_path = ''` trigger that creates the row, and the by-hand promotion line.

`profiles.test.mjs` runs it in **pglite** (Postgres in WASM) with stand-ins for Supabase's `anon`/`authenticated` roles, `auth.users` and `auth.uid()`, switching roles with `set role` the way the API does.

## Run
```bash
cd knowledge/supabase-auth-engineer/examples/02-profiles-rls-sql
npm install      # @electric-sql/pglite 0.6.0; do not commit node_modules
npm test
```

## Verified
Run 2026-11-23, Node v22.23.5, pglite 0.6.0:
```
ok 1 - trigger creates a profile with role user; user_metadata role is ignored
ok 2 - a user reads only their own row
ok 3 - anon reads nothing (no grant)
ok 4 - a user cannot update their own role (privilege denied)
ok 5 - a user cannot insert a profile or delete one
ok 6 - role check constraint rejects unknown roles
ok 7 - the trigger function is not executable by API roles
ok 8 - Dr. Lee by hand: the owner can promote one user; the user then sees super_admin
ok 9 - deleting the auth user cascades to the profile
# tests 9
# pass 9
# fail 0
```
Not verified: **the SQL has not run on a real Supabase project.** The `auth` schema, roles and `auth.uid()` are stubs; real default grants, the Security Advisor and the trigger on the managed `auth.users` table are untested. Dry-run it on a throwaway project first.

Why privileges and not a policy: an UPDATE policy cannot restrict one column (docs/05), so the table simply grants API roles no write privilege.
