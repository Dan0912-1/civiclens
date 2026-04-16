-- Classroom RLS bootstrap + hardening (2026-04-16).
--
-- This supersedes the earlier add_classroom_rls_policies.sql, which was
-- written assuming those policies would be installed with the permissive
-- "user_id = auth.uid()" insert policy and then hardened later. The base
-- policies never made it to prod (pg_policies returns zero rows on all
-- four classroom tables), so we install the correct shape from scratch.
--
-- Current prod state, verified via pg_class and pg_policies:
--   • RLS is enabled on classrooms / classroom_members /
--     classroom_assignments / assignment_completions.
--   • No policies exist on any of them.
--   • The helper functions don't exist.
--   • Every client path that touches these tables uses the service key
--     (server-side), so default-deny has been fine. These policies are
--     defense-in-depth for any future anon-key code path.
--
-- Safe to re-run: all creates guard against existing objects.

-- ═══════════════════════════════════════════════════════════════════════════════
-- 1. Helper functions (SECURITY DEFINER — bypass RLS for role lookups)
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- Returns classroom IDs where the given user is a teacher / any member.
-- Used by policies on classroom_members, classroom_assignments, and
-- assignment_completions to avoid self-join recursion and planner quirks.

create or replace function get_teacher_classroom_ids(target_user_id uuid)
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select classroom_id from classroom_members
  where user_id = target_user_id and role = 'teacher';
$$;

create or replace function get_member_classroom_ids(target_user_id uuid)
returns setof uuid
language sql
security definer
set search_path = public
stable
as $$
  select classroom_id from classroom_members
  where user_id = target_user_id;
$$;

-- Revoke public EXECUTE so anon / authenticated cannot call the helpers
-- directly to enumerate another user's memberships. Policies reference
-- these functions in their bodies, which run with the definer's
-- privileges — so policy evaluation is unaffected by this revoke.
revoke execute on function get_teacher_classroom_ids(uuid) from public;
revoke execute on function get_teacher_classroom_ids(uuid) from anon;
revoke execute on function get_teacher_classroom_ids(uuid) from authenticated;

revoke execute on function get_member_classroom_ids(uuid) from public;
revoke execute on function get_member_classroom_ids(uuid) from anon;
revoke execute on function get_member_classroom_ids(uuid) from authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 2. classrooms
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists "Members can view their classrooms" on classrooms;
create policy "Members can view their classrooms"
on classrooms for select using (
  id in (select get_member_classroom_ids(auth.uid()))
);

drop policy if exists "Users can create own classrooms" on classrooms;
create policy "Users can create own classrooms"
on classrooms for insert with check (
  owner_id = auth.uid()
);

drop policy if exists "Owners can update own classrooms" on classrooms;
create policy "Owners can update own classrooms"
on classrooms for update using (
  owner_id = auth.uid()
);

drop policy if exists "Owners can delete own classrooms" on classrooms;
create policy "Owners can delete own classrooms"
on classrooms for delete using (
  owner_id = auth.uid()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 3. classroom_members
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists "Users can view own memberships" on classroom_members;
create policy "Users can view own memberships"
on classroom_members for select using (
  user_id = auth.uid()
);

drop policy if exists "Teachers can view classroom members" on classroom_members;
create policy "Teachers can view classroom members"
on classroom_members for select using (
  classroom_id in (select get_teacher_classroom_ids(auth.uid()))
);

-- IMPORTANT: role-locked self-insert. Originally this policy was written
-- as a bare user_id = auth.uid() check, which would have let any
-- authenticated user insert { role: 'teacher' } on a classroom whose id
-- they got via the public peek endpoint. Teacher rows are created
-- server-side with the service key, so this policy only needs to allow
-- the student self-insert fallback.
drop policy if exists "Users can join classrooms" on classroom_members;
drop policy if exists "Users can join classrooms as students" on classroom_members;
create policy "Users can join classrooms as students"
on classroom_members for insert with check (
  user_id = auth.uid()
  and role = 'student'
);

drop policy if exists "Users can leave classrooms" on classroom_members;
create policy "Users can leave classrooms"
on classroom_members for delete using (
  user_id = auth.uid()
);

drop policy if exists "Teachers can remove members" on classroom_members;
create policy "Teachers can remove members"
on classroom_members for delete using (
  classroom_id in (select get_teacher_classroom_ids(auth.uid()))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 4. classroom_assignments
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists "Members can view assignments" on classroom_assignments;
create policy "Members can view assignments"
on classroom_assignments for select using (
  classroom_id in (select get_member_classroom_ids(auth.uid()))
);

drop policy if exists "Teachers can create assignments" on classroom_assignments;
create policy "Teachers can create assignments"
on classroom_assignments for insert with check (
  assigned_by = auth.uid()
  and classroom_id in (select get_teacher_classroom_ids(auth.uid()))
);

drop policy if exists "Teachers can delete assignments" on classroom_assignments;
create policy "Teachers can delete assignments"
on classroom_assignments for delete using (
  classroom_id in (select get_teacher_classroom_ids(auth.uid()))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- 5. assignment_completions
-- ═══════════════════════════════════════════════════════════════════════════════

drop policy if exists "Users can view own completions" on assignment_completions;
create policy "Users can view own completions"
on assignment_completions for select using (
  user_id = auth.uid()
);

drop policy if exists "Teachers can view classroom completions" on assignment_completions;
create policy "Teachers can view classroom completions"
on assignment_completions for select using (
  assignment_id in (
    select ca.id from classroom_assignments ca
    where ca.classroom_id in (select get_teacher_classroom_ids(auth.uid()))
  )
);

drop policy if exists "Users can complete assignments" on assignment_completions;
create policy "Users can complete assignments"
on assignment_completions for insert with check (
  user_id = auth.uid()
);
