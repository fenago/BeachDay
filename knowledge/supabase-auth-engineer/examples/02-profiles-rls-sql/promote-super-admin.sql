-- Promote ONE user to super_admin. Dr. Lee runs this BY HAND in the Supabase SQL editor (as the table owner).
-- No app code, function or API role can run it: anon and authenticated hold no UPDATE privilege on profiles.
-- Run STEP 1, read the result, then run STEP 2 with the id from STEP 1.

-- STEP 1: look before you promote. Replace <EMAIL> with the address you sign in with.
select u.id,
       u.email,
       u.email_confirmed_at,
       u.last_sign_in_at,
       array_agg(i.provider order by i.provider) filter (where i.provider is not null) as providers
from auth.users u
left join auth.identities i on i.user_id = u.id
where u.email = '<EMAIL>'
group by u.id, u.email, u.email_confirmed_at, u.last_sign_in_at;
-- Check, and stop if any answer is wrong:
--   exactly one row;
--   email_confirmed_at is not null;
--   last_sign_in_at is your own recent sign-in, made the way you will normally sign in;
--   providers lists only methods you set up yourself ('email' = password, 'google' = Google).
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

-- To demote later: update public.profiles set role = 'user' where id = '<USER_ID>';
-- The functions read the role on every request (no cache), so the change applies to the next call.
