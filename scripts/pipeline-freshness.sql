-- Pipeline freshness checks. READ-ONLY: every statement is a SELECT.
--
-- Run in the Supabase SQL editor, or as the capitolkey_ops_readonly role
-- (supabase/read_only_ops_role.sql). Nothing here writes.
--
-- Context: the daily sync runs at 0 5 * * * UTC (api/server.js →
-- runDailySync in api/billSync.js). New Hampshire is intentionally excluded
-- from the product (gc.nh.gov serves a JS challenge instead of bill text), so
-- NH rows are expected to be textless.

-- 1. Freshness per jurisdiction ('US' = federal).
--    stale_48h = no row in this jurisdiction was synced in the last 48 hours.
select
  jurisdiction,
  count(*)                                            as bills,
  count(*) filter (where full_text is null)           as textless,
  count(*) filter (where feed_eligible)               as feed_eligible,
  max(synced_at)                                      as last_synced_at,
  max(updated_at)                                     as last_updated_at,
  max(latest_action_date)                             as newest_action,
  max(synced_at) < now() - interval '48 hours'        as stale_48h,
  count(*) filter (where text_fetch_attempts >= 5)    as text_fetch_shelved
from bills
group by jurisdiction
order by last_synced_at nulls first, jurisdiction;

-- 2. Homepage "Moving this week" source (0 6 * * * UTC, refreshCuratedBills).
--    /api/featured only shows rows whose latest_action_date is within 14 days.
--    latest_action_date is TEXT ('YYYY-MM-DD', default ''), so compare as a
--    string exactly like buildFeaturedBills() does — no ::date cast.
select
  max(fetched_at)                                                                         as last_fetched_at,
  count(*)                                                                                as rows_total,
  count(*) filter (where latest_action_date >= to_char(current_date - 14, 'YYYY-MM-DD'))  as rows_within_14d
from curated_bills;

-- 3. Historical backfill queue (supabase/create_backfill_tracking.sql).
select state_code, status, bills_synced, api_calls_used, started_at, completed_at, error, updated_at
from backfill_progress
order by status, state_code;

-- 4. App job ledger (supabase/create_job_runs.sql). Last 48 hours.
--    status='started' with no finished_at = the process died mid-run.
select job_name, started_at, finished_at, status,
       finished_at - started_at as duration,
       stats->>'legiscanCalls'   as legiscan_calls,
       error
from job_runs
where started_at > now() - interval '48 hours'
order by started_at desc;

-- 5. pg_cron history for the DB-side retention jobs
--    (supabase/schedule_retention_cron.sql: 7 3 * * *).
--    Fails with "permission denied" if the cron grant in
--    read_only_ops_role.sql could not be applied — run as postgres instead.
select j.jobname, d.status, d.start_time, d.end_time, d.return_message
from cron.job_run_details d
join cron.job j on j.jobid = d.jobid
where d.start_time > now() - interval '7 days'
order by d.start_time desc
limit 50;
