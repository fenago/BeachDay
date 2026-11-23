-- profiles: one row per auth user. role is never writable by an API user.
-- Run in the Supabase SQL editor (or psql) by Dr. Lee. Idempotent enough for a first run only.

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

-- BY HAND, ONCE, by Dr. Lee in the SQL editor (never from the app):
--   update public.profiles set role = 'super_admin' where id = '<Dr. Lee''s auth user id>';
