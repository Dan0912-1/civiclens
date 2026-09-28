-- Read-only ops role for monitoring bots (2026-09-26).
--
-- Gives freshness / pipeline visibility WITHOUT handing anyone the
-- SUPABASE_SERVICE_KEY. The role can SELECT a fixed list of tables and
-- nothing else: no INSERT, UPDATE, DELETE, TRUNCATE, or DDL.
--
-- Run once in the Supabase SQL editor as the `postgres` user. Idempotent.
-- Tables in the list that do not exist in this project (e.g. a migration that
-- was never applied, like backfill_progress) are skipped with a NOTICE rather
-- than failing the whole script. Re-run this file after creating any of them.
--
-- This file creates a NOLOGIN group role. The login role that bots use
-- (ops_bot) is created by the SQL in docs/ops-warden-access.md, which also
-- covers how its password is handled. Don't write a bare
-- `create role ... password '...'` at the top level of the SQL editor: this
-- project runs with log_statement = 'ddl', so that statement, password
-- included, would land in the Postgres logs. Never hand a bot the
-- SUPABASE_SERVICE_KEY.
--
-- PII: user_profiles and feedback contain student profile fields and contact
-- details. They are included because ops triage needs them. If a bot only
-- needs pipeline freshness, remove them from the list below.
--
-- Supabase note: tables created in `public` after 2026-10-30 need an explicit
-- GRANT for every role that should see them. Any new table an ops bot must
-- read has to be added to the list below — it will NOT inherit access
-- automatically.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'capitolkey_ops_readonly') then
    create role capitolkey_ops_readonly nologin;
  end if;
end $$;

grant usage on schema public to capitolkey_ops_readonly;

-- For each table: explicit SELECT only (no `grant ... on all tables`), revoke
-- anything broader, and — because every table here has RLS enabled and a role
-- without BYPASSRLS sees zero rows unless a policy admits it — add a
-- SELECT-only policy for this role alone. Policies do not change access for
-- anon, authenticated or service_role.
do $$
declare
  t text;
begin
  foreach t in array array[
    'bills', 'curated_bills', 'backfill_progress', 'personalization_cache',
    'feedback', 'bill_explainers', 'user_profiles',
    'job_runs'   -- from supabase/create_job_runs.sql; apply that first
  ] loop
    if to_regclass(format('public.%I', t)) is null then
      raise notice 'Skipping public.% (table does not exist in this project)', t;
      continue;
    end if;

    execute format('grant select on table public.%I to capitolkey_ops_readonly', t);
    execute format(
      'revoke insert, update, delete, truncate, references, trigger on table public.%I from capitolkey_ops_readonly', t
    );

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = 'ops_readonly_select'
    ) then
      execute format(
        'create policy ops_readonly_select on public.%I for select to capitolkey_ops_readonly using (true)', t
      );
    end if;
  end loop;
end $$;

-- pg_cron: deliberately NOT granted (2026-09-28). An earlier version of this
-- file granted USAGE on schema cron plus SELECT on cron.job and
-- cron.job_run_details. That was useless and unsafe:
--   * pg_cron's own RLS policy (username = current_user) shows each role only
--     the jobs it owns. Every job here is owned by postgres, so the ops role
--     read 0 rows.
--   * USAGE on schema cron is what pg_cron checks before cron.schedule(), so
--     the "read-only" role could create its own scheduled jobs.
-- This block removes the old grants wherever they were applied. The owner reads
-- cron history as postgres (scripts/pipeline-freshness.sql, query 5).
do $$
begin
  execute 'revoke select on table cron.job, cron.job_run_details from capitolkey_ops_readonly';
  execute 'revoke usage on schema cron from capitolkey_ops_readonly';
exception when others then
  raise notice 'Could not revoke cron.* from capitolkey_ops_readonly: %', sqlerrm;
end $$;

-- Verify (should list only SELECT):
--   select table_schema, table_name, privilege_type
--   from information_schema.role_table_grants
--   where grantee = 'capitolkey_ops_readonly' order by 1, 2;
