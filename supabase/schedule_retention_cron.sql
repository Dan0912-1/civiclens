-- Nightly retention cron (2026-04-16).
--
-- Supersedes the "run this DELETE manually" footnotes in add_cache_ttl.sql
-- and add_classroom_retention.sql. Previously I documented the queries and
-- left scheduling as a manual Dashboard task; that meant the Privacy promise
-- of "classroom data removed within 30 days of archival" was only as
-- reliable as whoever remembered to click around in Supabase. Now the
-- deletion is a scheduled pg_cron job committed to source.
--
-- Requires the pg_cron extension. Supabase projects have it available but
-- not always enabled — CREATE EXTENSION is idempotent so this is safe to
-- re-run.
--
-- Jobs (both at 03:07 UTC, picked to dodge the top-of-hour stampede):
--   1. personalization_cache_cleanup
--        DELETE FROM personalization_cache WHERE expires_at < NOW();
--        Drops expired Claude/Groq cache rows (30-day TTL from add_cache_ttl.sql).
--
--   2. classrooms_retention_cleanup
--        DELETE FROM classrooms
--          WHERE archived = true
--            AND archived_at IS NOT NULL
--            AND archived_at < NOW() - INTERVAL '30 days';
--        Enforces the 30-day post-archival deletion promise. Cascades
--        through classroom_members / classroom_assignments /
--        assignment_completions via on-delete-cascade FKs.
--
-- Idempotent via cron.unschedule guarded by exists checks.

create extension if not exists pg_cron;

-- Schedule in the cron schema (Supabase convention). Unschedule any prior
-- job with the same name so repeated runs of this migration converge on
-- the latest schedule + command rather than stacking duplicates.

do $$
begin
  if exists (select 1 from cron.job where jobname = 'personalization_cache_cleanup') then
    perform cron.unschedule('personalization_cache_cleanup');
  end if;
end $$;

select cron.schedule(
  'personalization_cache_cleanup',
  '7 3 * * *',
  $cron$delete from personalization_cache where expires_at < now();$cron$
);

do $$
begin
  if exists (select 1 from cron.job where jobname = 'classrooms_retention_cleanup') then
    perform cron.unschedule('classrooms_retention_cleanup');
  end if;
end $$;

select cron.schedule(
  'classrooms_retention_cleanup',
  '7 3 * * *',
  $cron$
    delete from classrooms
      where archived = true
        and archived_at is not null
        and archived_at < now() - interval '30 days';
  $cron$
);
