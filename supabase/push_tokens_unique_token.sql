-- ─────────────────────────────────────────────────────────────────────────────
-- CapitolKey — Push token uniqueness migration (audit C4)
-- Run this in Supabase SQL Editor.
--
-- The original push_tokens schema has `unique (user_id, token)` which permits
-- the SAME FCM device token to be associated with multiple users — once a
-- shared device (school iPad, hand-me-down phone) gets signed in by user B
-- after user A, both rows survive and both users receive notifications meant
-- for the other. The runtime fix in /api/push/register deletes other rows on
-- registration, but a hard DB constraint closes the race.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Collapse any existing duplicates so the new constraint can apply.
delete from push_tokens p
using push_tokens p2
where p.token = p2.token
  and p.created_at < p2.created_at;

-- 2. Drop the old per-(user,token) constraint if present.
alter table push_tokens
  drop constraint if exists push_tokens_user_id_token_key;

-- 3. Add the stricter per-token constraint.
alter table push_tokens
  add constraint push_tokens_token_key unique (token);
