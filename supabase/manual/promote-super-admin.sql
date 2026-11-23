-- NOT A MIGRATION. Never move this file into supabase/migrations/ and never run it from app code.
-- Source: knowledge/supabase-auth-engineer/examples/02-profiles-rls-sql/promote-super-admin.sql (pglite-tested).
-- Promote ONE user to super_admin. Dr. Lee runs this BY HAND in the Supabase SQL editor (as the table owner).
-- No app code, function or API role can run it: anon and authenticated hold no UPDATE privilege on profiles.
-- Run STEP 1, read the result, then run STEP 2 with the id from STEP 1.

-- STEP 1: look before you promote. Replace <EMAIL> with the address you sign in with.
select u.id,
       u.email,
       u.email_confirmed_at,
       u.last_sign_in_at,
       nullif(u.email_change, '') as pending_email_change,   -- column names from the Auth server source;
       u.email_change_sent_at,                                -- UNVERIFIED on the hosted schema
       array_agg(i.provider order by i.provider) filter (where i.provider is not null) as providers,
       (select array_agg(f.factor_type::text || ' ' || f.status::text || ' ' || to_char(f.created_at, 'YYYY-MM-DD')
                         order by f.created_at)
          from auth.mfa_factors f
         where f.user_id = u.id) as mfa_factors
from auth.users u
left join auth.identities i on i.user_id = u.id
where u.email = '<EMAIL>'
group by u.id, u.email, u.email_confirmed_at, u.last_sign_in_at, u.email_change, u.email_change_sent_at;
-- Check, and stop if any answer is wrong:
--   exactly one row;
--   email_confirmed_at is not null;
--   last_sign_in_at is your own recent sign-in, made the way you will normally sign in;
--   providers lists only methods you set up yourself ('email' = password, 'google' = Google);
--   pending_email_change is empty. A new address you did not ask for means someone tried to move the account:
--   STOP, click no email-change link, and ask supabase-auth-engineer before editing auth.users.
--   mfa_factors is empty, or lists only factors you enrolled yourself, on the dates you remember.
--   A factor you did not enrol (verified or not) means someone else has held a session for this account: STOP.
--   Do not promote. Reset the password, remove that factor (see the end of this file), sign in again, then rerun STEP 1.
--   If 'email' is listed but you never chose a password for this account, someone else may have
--   signed up with your address first: use "Forgot password" to set your own password, then run STEP 1 again.

-- STEP 2: promote. Replace <USER_ID> with the id from STEP 1. Expect "1 row affected".
-- 0 rows means the id is wrong or the email is not confirmed: nothing was changed.
update public.profiles p
set role = 'super_admin'
from auth.users u
where p.id = u.id
  and u.id = '<USER_ID>'
  and u.email_confirmed_at is not null;

-- Lost authenticator, or a factor you did not enrol, BY HAND (UNVERIFIED on a real project: check the
-- auth.mfa_factors columns in the Table Editor first). Deleting the row turns two-step off for that factor;
-- sessions already at aal2 keep that level until their token refreshes. Enrol a new factor afterwards.
--   delete from auth.mfa_factors where user_id = '<USER_ID>' and id = '<FACTOR_ID>';

-- To demote later: update public.profiles set role = 'user' where id = '<USER_ID>';
-- The functions read the role on every request (no cache), so the change applies to the next call.
