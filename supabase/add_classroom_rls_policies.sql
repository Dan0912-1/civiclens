-- Defense-in-depth RLS policies for classroom tables.
-- Primary authorization is handled by Express middleware (requireClassroomTeacher,
-- requireClassroomMember), but if someone bypasses Express and calls Supabase
-- directly with an anon/authenticated key, these policies kick in.
--
-- RLS is already enabled on all four tables but no policies were defined,
-- meaning authenticated users get default-deny (no rows returned).
-- These policies explicitly grant the correct access patterns.
--
-- SECURITY DEFINER functions are used for cross-table lookups on RLS-enabled
-- tables to avoid self-join recursion and query planner confusion. They run
-- with the definer's privileges (bypassing RLS for the lookup) and are marked
-- STABLE so Postgres can cache them within a transaction.

-- ═══════════════════════════════════════════════════════════════════════════════
-- Helper functions (SECURITY DEFINER — bypass RLS for role lookups)
-- ═══════════════════════════════════════════════════════════════════════════════

-- Returns classroom IDs where the given user is a teacher.
-- Used by RLS policies on classroom_members, classroom_assignments, and
-- assignment_completions to avoid self-joins on RLS-protected tables.
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

-- Returns classroom IDs where the given user is any member (student or teacher).
-- Used by RLS policies on classrooms and classroom_assignments for member checks.
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

-- ═══════════════════════════════════════════════════════════════════════════════
-- classrooms
-- ═══════════════════════════════════════════════════════════════════════════════

-- Members can read classrooms they belong to
create policy "Members can view their classrooms"
on classrooms for select using (
  id in (select get_member_classroom_ids(auth.uid()))
);

-- Only the owner can create classrooms (owner_id must match auth user)
create policy "Users can create own classrooms"
on classrooms for insert with check (
  owner_id = auth.uid()
);

-- Only the owner can update their classrooms
create policy "Owners can update own classrooms"
on classrooms for update using (
  owner_id = auth.uid()
);

-- Only the owner can delete their classrooms
create policy "Owners can delete own classrooms"
on classrooms for delete using (
  owner_id = auth.uid()
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- classroom_members
-- ═══════════════════════════════════════════════════════════════════════════════

-- Users can see their own memberships
create policy "Users can view own memberships"
on classroom_members for select using (
  user_id = auth.uid()
);

-- Teachers can see all members in their classrooms (via Security Definer to
-- avoid infinite self-join recursion on this RLS-protected table)
create policy "Teachers can view classroom members"
on classroom_members for select using (
  classroom_id in (select get_teacher_classroom_ids(auth.uid()))
);

-- Users can join classrooms (insert their own membership)
create policy "Users can join classrooms"
on classroom_members for insert with check (
  user_id = auth.uid()
);

-- Users can leave classrooms (delete their own membership)
create policy "Users can leave classrooms"
on classroom_members for delete using (
  user_id = auth.uid()
);

-- Teachers can remove students from their classrooms
create policy "Teachers can remove members"
on classroom_members for delete using (
  classroom_id in (select get_teacher_classroom_ids(auth.uid()))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- classroom_assignments
-- ═══════════════════════════════════════════════════════════════════════════════

-- Members can view assignments in their classrooms
create policy "Members can view assignments"
on classroom_assignments for select using (
  classroom_id in (select get_member_classroom_ids(auth.uid()))
);

-- Teachers can create assignments in their classrooms
create policy "Teachers can create assignments"
on classroom_assignments for insert with check (
  assigned_by = auth.uid()
  and classroom_id in (select get_teacher_classroom_ids(auth.uid()))
);

-- Teachers can delete assignments in their classrooms
create policy "Teachers can delete assignments"
on classroom_assignments for delete using (
  classroom_id in (select get_teacher_classroom_ids(auth.uid()))
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- assignment_completions
-- ═══════════════════════════════════════════════════════════════════════════════

-- Users can view their own completions
create policy "Users can view own completions"
on assignment_completions for select using (
  user_id = auth.uid()
);

-- Teachers can view completions in their classrooms (for aggregate stats).
-- Uses a subquery through classroom_assignments to reach the classroom_id,
-- then checks teacher role via Security Definer.
create policy "Teachers can view classroom completions"
on assignment_completions for select using (
  assignment_id in (
    select ca.id from classroom_assignments ca
    where ca.classroom_id in (select get_teacher_classroom_ids(auth.uid()))
  )
);

-- Users can mark their own assignments complete
create policy "Users can complete assignments"
on assignment_completions for insert with check (
  user_id = auth.uid()
);
