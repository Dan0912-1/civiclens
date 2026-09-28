-- Job-run ledger (2026-09-26).
--
-- Every scheduled job in api/server.js records one row per run through
-- recordJobRun(): status 'started' when it begins, then 'ok' or 'error' with
-- its stats. Before this, the only evidence that the 05:00 / 06:00 UTC crons
-- ran was a console line in the Railway logs.
--
-- job_name values written today:
--   daily_sync     0 5 * * *     runDailySync + refreshHotBillTexts + runRanker
--   curated_bills  0 6 * * *     refreshCuratedBills ("Moving this week")
--   bill_updates   0 8 * * *     checkBillUpdates (bookmark email/push)
--   prewarm        0 11 * * 1-5  prewarmFeedCache (LegiScan searches)
--
-- stats always includes durationMs and legiscanCalls (LegiScan requests the
-- process issued while the job ran).
--
-- A row stuck at status='started' with no finished_at means the process died
-- mid-run (redeploy, OOM, crash).
--
-- Read by GET /api/admin/jobs and GET /api/admin/quota (ADMIN_SECRET).
-- Run this once in the Supabase SQL editor. Idempotent.

create table if not exists job_runs (
  id           bigint generated always as identity primary key,
  job_name     text        not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text        not null default 'started'
                           check (status in ('started', 'ok', 'error')),
  stats        jsonb,
  error        text
);

create index if not exists idx_job_runs_started_at on job_runs (started_at desc);
create index if not exists idx_job_runs_job_started on job_runs (job_name, started_at desc);

-- Service role (the Railway backend) bypasses RLS. No anon/authenticated
-- policies, so the public API keys can neither read nor write this table.
alter table job_runs enable row level security;

-- Supabase: tables created in `public` after 2026-10-30 need explicit grants
-- for the API roles. The backend uses service_role, so grant it explicitly
-- (harmless if already granted).
grant select, insert, update on table job_runs to service_role;

-- Optional housekeeping: keep 180 days. Uncomment to schedule with pg_cron.
-- select cron.schedule('job_runs_retention', '17 3 * * *',
--   $$delete from job_runs where started_at < now() - interval '180 days'$$);
