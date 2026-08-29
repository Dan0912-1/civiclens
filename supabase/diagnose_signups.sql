-- ─────────────────────────────────────────────────────────────────────────────
-- CapitolKey — "did anyone sign up, and where did the data go?"
-- Paste into Supabase → SQL Editor. Read-only; nothing here mutates.
--
-- Why this file exists: user_profiles has NO created_at column. Its only
-- timestamp is updated_at, written by the client on save (see
-- src/lib/userProfile.js). So "newest profile" in the table editor is really
-- "most recent profile WRITE", and it says nothing about when the account was
-- created. Account creation lives in auth.users, which is a different table.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Accounts. This is the real signup ledger.
select
  count(*)                                                     as total_accounts,
  count(*) filter (where created_at > now() - interval '7 days')  as last_7d,
  count(*) filter (where created_at > now() - interval '14 days') as last_14d,
  count(*) filter (where created_at > now() - interval '30 days') as last_30d,
  max(created_at)                                              as newest_account
from auth.users;

-- 2. Who, specifically. confirmed_at null = signed up but never confirmed the
--    email, which means they never signed in, which means no profile row was
--    ever written for them.
select
  email,
  created_at,
  confirmed_at,
  last_sign_in_at,
  raw_app_meta_data->>'provider' as provider
from auth.users
order by created_at desc
limit 50;

-- 3. Profiles vs accounts. A large gap is the symptom of signups that never
--    reach the client's SIGNED_IN handler (the only writer of user_profiles).
select
  (select count(*) from auth.users)          as accounts,
  (select count(*) from public.user_profiles) as profiles,
  (select max(updated_at) from public.user_profiles) as newest_profile_write;

-- 4. Accounts with no profile row at all, newest first.
select u.email, u.created_at, u.confirmed_at, u.last_sign_in_at
from auth.users u
left join public.user_profiles p on p.id = u.id
where p.id is null
order by u.created_at desc
limit 50;

-- 5. Is anything else still being written? If these are live but profiles are
--    not, the problem is specific to the profile write path, not to traffic.
select 'bookmarks' as t, count(*) as rows, max(created_at) as newest from public.bookmarks
union all
select 'bill_interactions', count(*), max(created_at) from public.bill_interactions
union all
select 'push_tokens', count(*), max(created_at) from public.push_tokens
union all
select 'feedback', count(*), max(created_at) from public.feedback;
