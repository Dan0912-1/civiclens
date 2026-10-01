-- Aggregate-only metrics for the Advisor bot (2026-10-01).
--
-- The Advisor is a Grok bot that consults on product, growth and strategy. It
-- needs to know how CapitolKey is doing, but it never needs a single student's
-- row: user_profiles holds minors' names, emails, family situation and
-- employment. So it gets no table grants at all. It reads the views in schema
-- `advisor`, which return counts only.
--
-- How the boundary works:
--   * The views are owned by postgres, so they read the base tables with the
--     owner's rights, which bypass RLS. The advisor role is granted SELECT on
--     the views and nothing else: no public.* tables, no auth.*, no cron.
--   * Demographic breakdowns (state, age/grade, interests) fold every group
--     smaller than 5 into one "(groups under 5, combined)" row, so a count
--     can't point at one student.
--   * Schema `advisor` is not exposed through the Data API, and anon /
--     authenticated / PUBLIC are revoked below, so the public app keys can't
--     reach these views.
--
-- This is NOT ops_bot. ops_bot (read_only_ops_role.sql) can read user_profiles
-- and is for pipeline checks. Don't grant capitolkey_ops_readonly to the
-- advisor, and don't grant these views to ops_bot.
--
-- advisor_bot is created WITHOUT a password, so nobody can log in as it until
-- the owner sets one (docs/ops-advisor-access.md). Don't add a password here:
-- this project logs DDL (log_statement = 'ddl').
--
-- Run once in the Supabase SQL editor as postgres. Idempotent: re-run it after
-- editing a view. To remove everything, see the rollback block at the bottom.

create schema if not exists advisor;
comment on schema advisor is
  'Aggregate-only views for the Advisor bot. Counts only, no per-user rows. See supabase/advisor_metrics.sql.';

-- ─── 1. One-row snapshot ────────────────────────────────────────────────────
-- personalization_cache is written on the anonymous path too, so it is the
-- only trace of signed-out use. It upserts on cache_key and rows expire after
-- 30 days: read it as a floor on activity, not a visitor count.
-- search_cache holds cached LegiScan searches. The weekday prewarm job writes
-- it as well as students, so search_cache_writes_* is load, not usage.
create or replace view advisor.snapshot as
select
  now() as as_of,
  (select count(*) from auth.users)::int                                                      as accounts_total,
  (select count(*) from auth.users where created_at > now() - interval '7 days')::int         as accounts_new_7d,
  (select count(*) from auth.users where created_at > now() - interval '30 days')::int        as accounts_new_30d,
  (select count(*) from auth.users where email_confirmed_at is not null)::int                 as accounts_confirmed,
  (select count(*) from auth.users where last_sign_in_at > now() - interval '7 days')::int    as accounts_signed_in_7d,
  (select count(*) from auth.users where last_sign_in_at > now() - interval '30 days')::int   as accounts_signed_in_30d,
  (select coalesce(jsonb_object_agg(provider, n), '{}'::jsonb)
     from (select coalesce(raw_app_meta_data->>'provider', 'unknown') as provider, count(*)::int as n
             from auth.users group by 1) p)                                                   as accounts_by_provider,
  (select count(*) from public.user_profiles)::int                                            as profiles_total,
  (select count(*) from public.user_profiles where push_notifications)::int                   as profiles_push_on,
  (select count(*) from public.user_profiles where email_notifications)::int                  as profiles_email_on,
  (select count(*) from public.push_tokens)::int                                              as push_devices,
  (select count(*) from public.bookmarks)::int                                                as bookmarks_total,
  (select count(*) from public.bill_interactions where created_at > now() - interval '7 days')::int        as interactions_7d,
  (select count(*) from public.bill_interactions where created_at > now() - interval '30 days')::int       as interactions_30d,
  (select count(distinct user_id) from public.bill_interactions where created_at > now() - interval '7 days')::int  as interacting_accounts_7d,
  (select count(distinct user_id) from public.bill_interactions where created_at > now() - interval '30 days')::int as interacting_accounts_30d,
  (select count(*) from public.personalization_cache where created_at > now() - interval '7 days')::int    as new_personalizations_7d,
  (select count(*) from public.personalization_cache where created_at > now() - interval '30 days')::int   as new_personalizations_30d,
  (select count(*) from public.search_cache where created_at > now() - interval '7 days')::int             as search_cache_writes_7d,
  (select count(*) from public.search_cache where created_at > now() - interval '30 days')::int            as search_cache_writes_30d,
  (select count(*) from public.feedback where created_at > now() - interval '30 days')::int                as feedback_30d;

-- ─── 2. Weekly series, last 26 weeks (weeks start Monday, UTC) ──────────────
create or replace view advisor.weekly as
with weeks as (
  select generate_series(date_trunc('week', now()) - interval '25 weeks',
                         date_trunc('week', now()),
                         interval '1 week') as ws
)
select
  w.ws::date as week_start,
  (select count(*) from auth.users u
     where u.created_at >= w.ws and u.created_at < w.ws + interval '1 week')::int                 as new_accounts,
  (select count(*) from public.classrooms c
     where c.created_at >= w.ws and c.created_at < w.ws + interval '1 week')::int                 as new_classrooms,
  (select count(*) from public.classroom_assignments a
     where a.created_at >= w.ws and a.created_at < w.ws + interval '1 week')::int                 as new_assignments,
  (select count(*) from public.assignment_completions ac
     where ac.completed_at >= w.ws and ac.completed_at < w.ws + interval '1 week')::int           as completions,
  (select count(*) from public.bill_interactions i
     where i.created_at >= w.ws and i.created_at < w.ws + interval '1 week')::int                 as interactions,
  (select count(distinct i.user_id) from public.bill_interactions i
     where i.created_at >= w.ws and i.created_at < w.ws + interval '1 week')::int                 as interacting_accounts,
  (select count(*) from public.bookmarks b
     where b.created_at >= w.ws and b.created_at < w.ws + interval '1 week')::int                 as new_bookmarks,
  (select count(*) from public.personalization_cache pc
     where pc.created_at >= w.ws and pc.created_at < w.ws + interval '1 week')::int               as new_personalizations,
  (select count(*) from public.search_cache sc
     where sc.created_at >= w.ws and sc.created_at < w.ws + interval '1 week')::int               as search_cache_writes,
  (select count(*) from public.feedback f
     where f.created_at >= w.ws and f.created_at < w.ws + interval '1 week')::int                 as feedback
from weeks w;

-- ─── 3. Classroom funnel ────────────────────────────────────────────────────
-- Teachers are classroom owners: user_profiles has no role field. The
-- founder's own test classrooms count here too.
create or replace view advisor.classroom_funnel as
with c as (
  select
    cl.owner_id,
    cl.archived,
    cl.google_course_id is not null as google_linked,
    exists (select 1 from public.classroom_members m
             where m.classroom_id = cl.id and m.role = 'student')              as has_students,
    exists (select 1 from public.classroom_assignments a
             where a.classroom_id = cl.id)                                       as has_assignments,
    exists (select 1 from public.classroom_assignments a
              join public.assignment_completions ac on ac.assignment_id = a.id
             where a.classroom_id = cl.id)                                       as has_completions
  from public.classrooms cl
)
select
  (select count(distinct owner_id) from c)::int                        as teachers_with_classroom,
  (select count(*) from c)::int                                        as classrooms,
  (select count(*) from c where not archived)::int                     as classrooms_active,
  (select count(*) from c where google_linked)::int                    as classrooms_google_linked,
  (select count(*) from c where has_students)::int                     as classrooms_with_students,
  (select count(*) from c where has_assignments)::int                  as classrooms_with_assignments,
  (select count(*) from c where has_completions)::int                  as classrooms_with_completions,
  (select count(*) from public.classroom_members where role = 'student')::int  as student_memberships,
  (select count(*) from public.classroom_members
     where role = 'student' and user_id is null)::int                  as student_memberships_anonymous,
  (select count(*) from public.classroom_assignments)::int             as assignments,
  (select count(*) from public.assignment_completions)::int            as completions,
  (select count(*) from public.google_oauth_tokens)::int               as google_classroom_connections;

-- ─── 4. Profile mix, small groups folded together ───────────────────────────
-- Only state, age/grade and interests. Never career, employment,
-- familySituation, additionalContext, name or email.
create or replace view advisor.profile_mix as
with raw as (
  select 'state'::text as dimension, nullif(trim(p.profile->>'state'), '') as bucket
    from public.user_profiles p
  union all
  select 'age_or_grade', nullif(trim(coalesce(p.profile->>'age', p.profile->>'grade')), '')
    from public.user_profiles p
  union all
  select 'interest', nullif(trim(i), '')
    from public.user_profiles p,
         jsonb_array_elements_text(
           case when jsonb_typeof(p.profile->'interests') = 'array'
                then p.profile->'interests' else '[]'::jsonb end) i
), counted as (
  select dimension, coalesce(bucket, '(not set)') as bucket, count(*) as n
    from raw group by 1, 2
)
select
  dimension,
  case when n >= 5 then bucket else '(groups under 5, combined)' end as bucket,
  sum(n)::int as users
from counted
group by 1, 2;

-- ─── 5. Topic interest, last 90 days ────────────────────────────────────────
create or replace view advisor.topic_interest as
select
  coalesce(nullif(topic_tag, ''), '(untagged)') as topic,
  action_type,
  count(*)::int                as interactions,
  count(distinct user_id)::int as accounts
from public.bill_interactions
where created_at > now() - interval '90 days'
group by 1, 2;

-- ─── 6. Content coverage by jurisdiction ('US' = federal) ───────────────────
-- newest_action ignores future-dated actions (effective dates, scheduled
-- hearings). NH is excluded from the product on purpose.
create or replace view advisor.coverage as
select
  jurisdiction,
  count(*)::int                                                     as bills,
  count(*) filter (where feed_eligible)::int                        as feed_eligible,
  count(*) filter (where full_text is not null)::int                as with_text,
  max(latest_action_date) filter (where latest_action_date <= current_date) as newest_action,
  max(synced_at)                                                    as last_synced_at
from public.bills
group by jurisdiction;

-- ─── 7. Everything except coverage, as one JSON value ───────────────────────
-- One query, one paste: `select brief from advisor.brief;`
create or replace view advisor.brief as
select
  now() as generated_at,
  jsonb_build_object(
    'snapshot',         (select to_jsonb(s) from advisor.snapshot s),
    'classroom_funnel', (select to_jsonb(f) from advisor.classroom_funnel f),
    'weekly',           (select jsonb_agg(to_jsonb(w) order by w.week_start) from advisor.weekly w),
    'profile_mix',      (select jsonb_agg(to_jsonb(p) order by p.dimension, p.users desc) from advisor.profile_mix p),
    'topic_interest',   (select jsonb_agg(to_jsonb(t) order by t.interactions desc) from advisor.topic_interest t)
  ) as brief;

-- ─── Roles and grants ───────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'capitolkey_advisor_readonly') then
    create role capitolkey_advisor_readonly nologin;
  end if;
  -- Login role with NO password: unusable until the owner sets one inside a
  -- DO block (docs/ops-advisor-access.md), which keeps it out of the DDL log.
  if not exists (select 1 from pg_roles where rolname = 'advisor_bot') then
    create role advisor_bot login connection limit 2;
  end if;
end $$;

-- Membership in the group is advisor_bot's only source of privileges.
grant capitolkey_advisor_readonly to advisor_bot;

-- Nobody else reaches schema advisor.
revoke all on schema advisor from public;
revoke all on all tables in schema advisor from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on schema advisor from %I', r);
      execute format('revoke all on all tables in schema advisor from %I', r);
    end if;
  end loop;
end $$;

grant usage  on schema advisor                to capitolkey_advisor_readonly;
grant select on all tables in schema advisor  to capitolkey_advisor_readonly;

-- Guard rails. The grants are the boundary; these stop accidents.
alter role advisor_bot connection limit 2;
alter role advisor_bot set default_transaction_read_only = on;
alter role advisor_bot set statement_timeout = '20s';
alter role advisor_bot set idle_in_transaction_session_timeout = '60s';
alter role advisor_bot set search_path = advisor;

-- Verify (run on its own; every column should be true):
--   select
--     not has_table_privilege('advisor_bot', 'public.user_profiles', 'SELECT')
--       and not has_table_privilege('advisor_bot', 'public.feedback', 'SELECT')
--       and not has_table_privilege('advisor_bot', 'auth.users', 'SELECT')   as no_base_tables,
--     has_table_privilege('advisor_bot', 'advisor.brief', 'SELECT')          as reads_brief,
--     not has_schema_privilege('anon', 'advisor', 'USAGE')
--       and not has_schema_privilege('authenticated', 'advisor', 'USAGE')    as app_keys_blocked,
--     not pg_has_role('advisor_bot', 'capitolkey_ops_readonly', 'member')    as not_ops_role,
--     not exists (select 1 from information_schema.role_table_grants
--                  where grantee = 'capitolkey_advisor_readonly'
--                    and (table_schema <> 'advisor' or privilege_type <> 'SELECT')) as select_on_advisor_only;

-- Rollback (removes the views and both roles):
--   drop schema advisor cascade;
--   drop role if exists advisor_bot;
--   drop role if exists capitolkey_advisor_readonly;
