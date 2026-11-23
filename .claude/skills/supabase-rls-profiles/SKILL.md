---
name: supabase-rls-profiles
description: The Beach Day profiles table and Row Level Security rules — the role column, the sign-up trigger, why API roles get no write grants, and the checklist for any new table. Use when writing or reviewing SQL for Supabase, the profiles table or a policy.
---
# profiles and RLS (reference SQL, run in pglite: knowledge/supabase-auth-engineer/examples/02-profiles-rls-sql/)

## Standing rules
- **Every table in `public` has RLS on, and policies name `to authenticated`.** Write `(select auth.uid())`, not bare `auth.uid()`.
- **A policy cannot protect one column.** The `role` column is safe because `anon` and `authenticated` hold **no INSERT, UPDATE or DELETE privilege** on `profiles`, not because of a policy. Never run `grant update on public.profiles` at table level. If users need an editable field, put it in a separate table.
- **No `service_role` or secret key in any code, test or doc example.** Promotion to `super_admin` is one `update` run by Dr. Lee in the SQL editor.
- **Never read `user_metadata`/`raw_user_meta_data` for authorisation.** The user writes it at sign-up.

## profiles
- `id uuid primary key references auth.users (id) on delete cascade`
- `role text not null default 'user' check (role in ('user','super_admin'))`
- `created_at timestamptz not null default now()`
- One select policy: `to authenticated using ((select auth.uid()) = id)`. `revoke all` from `anon`, `authenticated`; `grant select` to `authenticated`.
- Trigger `after insert on auth.users` runs `public.handle_new_user()`: `security definer set search_path = ''`, inserts only `id`, schema-qualifies every name, and has `execute` revoked from API roles. A failing trigger blocks sign-ups, so test it first.

## Checklist for a new table or function
1. RLS enabled? Policies per operation, each with `to authenticated`?
2. Grants match the policies (a policy without a grant does nothing, a grant without a policy is closed)?
3. Any `security definer` function: `set search_path = ''`, not in an exposed schema, `execute` revoked from API roles unless meant to be callable?
4. Any view: it bypasses RLS by default. Avoid it, or use `security_invoker`.
5. Run the Supabase Security Advisor after applying.

## Not verified
The SQL ran in pglite with stubbed Supabase roles, not on a real project. Dry-run it on a throwaway project first.
