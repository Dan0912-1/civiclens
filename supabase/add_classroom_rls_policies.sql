-- Defense-in-depth RLS policies for classroom tables.
-- Primary authorization is handled by Express middleware (requireClassroomTeacher,
-- requireClassroomMember), but if someone bypasses Express and calls Supabase
-- directly with an anon/authenticated key, these policies kick in.
--
-- RLS is already enabled on all four tables but no policies were defined,
-- meaning authenticated users get default-deny (no rows returned).
-- These policies explicitly grant the correct access patterns.

-- ═══════════════════════════════════════════════════════════════════════════════
-- classrooms
-- ═══════════════════════════════════════════════════════════════════════════════

-- Members can read classrooms they belong to
create policy "Members can view their classrooms"
on classrooms for select using (
  exists (
    select 1 from classroom_members
    where classroom_members.classroom_id = classrooms.id
      and classroom_members.user_id = auth.uid()
  )
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

-- Teachers can see all members in their classrooms
create policy "Teachers can view classroom members"
on classroom_members for select using (
  exists (
    select 1 from classroom_members as cm
    where cm.classroom_id = classroom_members.classroom_id
      and cm.user_id = auth.uid()
      and cm.role = 'teacher'
  )
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
  exists (
    select 1 from classroom_members as cm
    where cm.classroom_id = classroom_members.classroom_id
      and cm.user_id = auth.uid()
      and cm.role = 'teacher'
  )
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- classroom_assignments
-- ═══════════════════════════════════════════════════════════════════════════════

-- Members can view assignments in their classrooms
create policy "Members can view assignments"
on classroom_assignments for select using (
  exists (
    select 1 from classroom_members
    where classroom_members.classroom_id = classroom_assignments.classroom_id
      and classroom_members.user_id = auth.uid()
  )
);

-- Teachers can create assignments in their classrooms
create policy "Teachers can create assignments"
on classroom_assignments for insert with check (
  assigned_by = auth.uid()
  and exists (
    select 1 from classroom_members
    where classroom_members.classroom_id = classroom_assignments.classroom_id
      and classroom_members.user_id = auth.uid()
      and classroom_members.role = 'teacher'
  )
);

-- Teachers can delete assignments in their classrooms
create policy "Teachers can delete assignments"
on classroom_assignments for delete using (
  exists (
    select 1 from classroom_members
    where classroom_members.classroom_id = classroom_assignments.classroom_id
      and classroom_members.user_id = auth.uid()
      and classroom_members.role = 'teacher'
  )
);

-- ═══════════════════════════════════════════════════════════════════════════════
-- assignment_completions
-- ═══════════════════════════════════════════════════════════════════════════════

-- Users can view their own completions
create policy "Users can view own completions"
on assignment_completions for select using (
  user_id = auth.uid()
);

-- Teachers can view completions in their classrooms (for aggregate stats)
create policy "Teachers can view classroom completions"
on assignment_completions for select using (
  exists (
    select 1 from classroom_assignments ca
    join classroom_members cm on cm.classroom_id = ca.classroom_id
    where ca.id = assignment_completions.assignment_id
      and cm.user_id = auth.uid()
      and cm.role = 'teacher'
  )
);

-- Users can mark their own assignments complete
create policy "Users can complete assignments"
on assignment_completions for insert with check (
  user_id = auth.uid()
);
