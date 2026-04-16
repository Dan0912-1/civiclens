-- Round-3 classroom security hardening (2026-04-16).
--
-- Issues addressed:
--
-- 1. The existing "Users can join classrooms" insert policy only checks
--    user_id = auth.uid() and does not constrain role. Any authenticated
--    user could call Supabase directly with the anon key and insert
--    { classroom_id, user_id: auth.uid(), role: 'teacher' } to escalate
--    themselves into the teacher role of a classroom whose id they got
--    from the public peek endpoint. Server-side joins already go through
--    the service key which bypasses RLS, so this policy existed purely as
--    a (too-loose) defense-in-depth fallback.
--
-- 2. The SECURITY DEFINER helpers get_teacher_classroom_ids and
--    get_member_classroom_ids were created with no REVOKE EXECUTE, so
--    any authenticated caller could invoke them and enumerate another
--    user's classroom memberships.
--
-- Fix shape:
--
--   • Drop the permissive insert policy and replace it with a role-locked
--     one that only allows self-insert of role = 'student'. Teacher rows
--     are created server-side at classroom creation time using the
--     service key, which bypasses RLS and is unaffected.
--   • REVOKE EXECUTE on both SECURITY DEFINER helpers from public/anon/
--     authenticated. They're only called from inside RLS policy bodies,
--     which run as the policy's definer context, not as the calling user.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Replace the permissive insert policy with a role-locked one
-- ─────────────────────────────────────────────────────────────────────────────

drop policy if exists "Users can join classrooms" on classroom_members;

create policy "Users can join classrooms as students"
on classroom_members for insert with check (
  user_id = auth.uid()
  and role = 'student'
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Lock down SECURITY DEFINER helpers
-- ─────────────────────────────────────────────────────────────────────────────

revoke execute on function get_teacher_classroom_ids(uuid) from public;
revoke execute on function get_teacher_classroom_ids(uuid) from anon;
revoke execute on function get_teacher_classroom_ids(uuid) from authenticated;

revoke execute on function get_member_classroom_ids(uuid) from public;
revoke execute on function get_member_classroom_ids(uuid) from anon;
revoke execute on function get_member_classroom_ids(uuid) from authenticated;

-- Note: RLS policies reference these functions directly. Policy evaluation
-- runs with the policy owner's privileges, not the caller's, so revoking
-- EXECUTE from end-user roles does NOT break the policies themselves.
