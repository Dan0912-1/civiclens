-- Classroom archival retention (2026-04-16).
--
-- The Privacy policy promises that classroom data is permanently removed
-- within 30 days of archival. Previously archiving just flipped a boolean
-- and no deletion job existed anywhere in the stack. This migration adds
-- the column we need to make that promise enforceable and documents the
-- nightly job that actually deletes the data.

alter table classrooms
  add column if not exists archived_at timestamptz;

-- Backfill: any already-archived classroom is treated as having been
-- archived right now so the 30-day window starts from migration time
-- rather than retroactively deleting older archives immediately.
update classrooms
  set archived_at = now()
  where archived = true and archived_at is null;

create index if not exists classrooms_archived_at_idx
  on classrooms (archived_at)
  where archived = true;

-- Nightly cron (Supabase Dashboard → Database → Cron, or an external
-- scheduler). The CASCADE comes for free via the foreign keys from
-- classroom_members, classroom_assignments, and assignment_completions
-- all defining on delete cascade against classrooms.id.
--
--   delete from classrooms
--     where archived = true
--       and archived_at is not null
--       and archived_at < now() - interval '30 days';
