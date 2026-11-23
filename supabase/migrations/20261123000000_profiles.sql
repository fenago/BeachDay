-- Beach Day: public.profiles, one row per auth user. role is never writable by an API user.
-- Source: knowledge/supabase-auth-engineer/examples/02-profiles-rls-sql/profiles.sql (pglite-tested; see supabase/README.md).
-- Apply once: Supabase SQL editor (paste and run) or `supabase db push`. Rules: docs/04 §4.5, supabase-rls-profiles skill.
-- Promotion to super_admin is NOT here: Dr. Lee runs supabase/manual/promote-super-admin.sql by hand.


create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  role       text not null default 'user' check (role in ('user', 'super_admin')),
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- A signed-in user may read only their own row.
create policy "profiles: read own row"
  on public.profiles for select
  to authenticated
  using ( (select auth.uid()) = id );

-- No insert/update/delete policies exist, and the grants below back that up.
-- RLS cannot protect a single column, so privileges do the real work:
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

-- Trigger: create the row when a user signs up (email/password or Google).
-- Inserts only id; role comes from the column default, never from user metadata.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- The trigger function must not be callable through the API.
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Promotion to super_admin: BY HAND, ONCE, by Dr. Lee in the SQL editor, never from the app.
-- Use supabase/manual/promote-super-admin.sql (it checks the account first and refuses an unconfirmed email).
