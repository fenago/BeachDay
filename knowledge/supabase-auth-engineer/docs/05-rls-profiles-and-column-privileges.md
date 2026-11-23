# Row Level Security, the profiles table and "role is never self-writable"
Sources: https://supabase.com/docs/guides/database/postgres/row-level-security · https://supabase.com/docs/guides/database/postgres/column-level-security · https://supabase.com/docs/guides/auth/managing-user-data
Retrieved: 2026-11-23. supabase.com blocked here; read from the `supabase/supabase` docs source.

## From the docs
- Profiles pattern: `id uuid not null references auth.users on delete cascade`, RLS on, "only granting the necessary privileges for each role" (managing-user-data).
- Create the row with a trigger on `auth.users`: `create function public.handle_new_user() ... security definer set search_path = ''` with every name schema-qualified. "If the trigger fails, it could block signups, so test your code thoroughly."
- Policies: `using ( (select auth.uid()) = id )` for select. Wrap `auth.uid()` in `select` (initPlan, faster). Name the role with `to authenticated`.
- "Once RLS is enabled, no data is accessible through the API when using a publishable key, until you create policies." A missing grant gives a permission error; a policy matching nothing gives an empty result.
- **An UPDATE policy cannot protect one column.** `with check` constrains the resulting row, but the user still holds UPDATE on every column. For per-column control the docs show `revoke update` at table level and `grant update (col)` for specific columns, but call it "an advanced feature" and recommend "RLS policies in combination with a dedicated table for handling user roles".
- `security definer` functions run with the owner's rights (`bypassrls` on Supabase). Always `set search_path = ''`. Never put one in an exposed schema unless it is meant to be callable over the API.
- `service_role` bypasses RLS, so policies are no defence against it, which is why we never use it.

## Beach Day design (examples/02, run in pglite)
- `public.profiles(id, role, created_at)`; `role` is `text not null default 'user'` with `check (role in ('user','super_admin'))`.
- Our `profiles` holds **only** `id`, `role`, `created_at`, nothing a user needs to edit, so the simplest safe rule is **no UPDATE/INSERT/DELETE grant at all** for `anon` and `authenticated`, and a single select policy for the own row. If a user-editable column is added later, put it in a different table, or use a column-level grant; never grant table-level UPDATE on `profiles`.
- The trigger inserts `id` only. `raw_user_meta_data` (which the user controls at sign-up) is never read.
- `super_admin` is set only by Dr. Lee, in the SQL editor as the table owner, with `examples/02-profiles-rls-sql/promote-super-admin.sql`: look at the account and its identities first, then an update that changes nothing unless `email_confirmed_at is not null`.
- `revoke execute` on the trigger function from API roles.
- **Not verified:** the SQL ran against pglite with stubbed `auth` schema and roles, not against a real Supabase project. Run `profiles.sql` on a throwaway project first, and run the Security Advisor.
