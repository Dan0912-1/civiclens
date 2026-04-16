-- Add `on delete cascade` to classroom_assignments.assigned_by so deleting a
-- teacher's auth user removes their assignments automatically. Before this,
-- a teacher who had ever posted an assignment could not be deleted via
-- supabase.auth.admin.deleteUser() — the FK constraint blocked cascade and
-- /api/account returned 500 "Failed to delete account".
--
-- The backend also clears these rows explicitly in the Promise.allSettled
-- block in api/server.js (account-delete endpoint), so this migration is
-- defense-in-depth: ensures direct Supabase admin deletes also succeed.
--
-- Idempotent: uses `information_schema` to check for the constraint before
-- touching it, so re-running is safe.

do $$
declare
  constraint_name_var text;
begin
  -- Find the current FK constraint on assigned_by → auth.users
  select tc.constraint_name into constraint_name_var
  from information_schema.table_constraints tc
  join information_schema.key_column_usage kcu
    on tc.constraint_name = kcu.constraint_name
   and tc.table_schema = kcu.table_schema
  where tc.table_schema = 'public'
    and tc.table_name = 'classroom_assignments'
    and tc.constraint_type = 'FOREIGN KEY'
    and kcu.column_name = 'assigned_by'
  limit 1;

  if constraint_name_var is not null then
    execute format('alter table public.classroom_assignments drop constraint %I', constraint_name_var);
  end if;

  alter table public.classroom_assignments
    add constraint classroom_assignments_assigned_by_fkey
    foreign key (assigned_by) references auth.users(id) on delete cascade;
end $$;
