-- Read-only ops role for monitoring bots (2026-09-26).
--
-- Gives freshness / pipeline visibility WITHOUT handing anyone the
-- SUPABASE_SERVICE_KEY. The role can SELECT a fixed list of tables and
-- nothing else: no INSERT, UPDATE, DELETE, TRUNCATE, or DDL.
--
-- Run once in the Supabase SQL editor as the `postgres` user. Idempotent.
--
-- This file creates a NOLOGIN group role. To let a bot connect, a human
-- creates a separate login role and adds it to the group, choosing the
-- password in the SQL editor (never commit it):
--
--   create role ops_bot login password '<choose in SQL editor>' in role capitolkey_ops_readonly;
--
-- and gives the bot the Postgres connection string for that login (Supabase
-- dashboard → Connect → session pooler), NOT the service key.
--
-- PII: user_profiles and feedback contain student profile fields and contact
-- details. They are included because ops triage needs them. If a bot only
-- needs pipeline freshness, drop those two grants/policies.
--
-- Supabase note: tables created in `public` after 2026-10-30 need an explicit
-- GRANT for every role that should see them. Any new table an ops bot must
-- read has to be added to this file (grant + policy) — it will NOT inherit
-- access automatically.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'capitolkey_ops_readonly') then
    create role capitolkey_ops_readonly nologin;
  end if;
end $$;

grant usage on schema public to capitolkey_ops_readonly;

-- Explicit SELECT only, table by table. No `grant ... on all tables`.
grant select on table
  public.bills,
  public.curated_bills,
  public.backfill_progress,
  public.personalization_cache,
  public.feedback,
  public.bill_explainers,
  public.user_profiles,
  public.job_runs            -- from supabase/create_job_runs.sql; apply that first
to capitolkey_ops_readonly;

-- Belt and braces: make sure nothing broader is held.
revoke insert, update, delete, truncate, references, trigger
  on table
    public.bills,
    public.curated_bills,
    public.backfill_progress,
    public.personalization_cache,
    public.feedback,
    public.bill_explainers,
    public.user_profiles,
    public.job_runs
  from capitolkey_ops_readonly;

-- Every table above has RLS enabled, and a role without BYPASSRLS sees zero
-- rows unless a policy admits it. These policies admit SELECT for this role
-- only; they do not change access for anon, authenticated or service_role.
do $$
declare
  t text;
begin
  foreach t in array array[
    'bills', 'curated_bills', 'backfill_progress', 'personalization_cache',
    'feedback', 'bill_explainers', 'user_profiles', 'job_runs'
  ] loop
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

-- pg_cron run history (cron.job_run_details) for the retention jobs in
-- supabase/schedule_retention_cron.sql. On some Supabase projects the cron
-- schema is owned by supabase_admin and `postgres` cannot re-grant it; in that
-- case this block prints a notice and the rest of the file still applies.
do $$
begin
  execute 'grant usage on schema cron to capitolkey_ops_readonly';
  execute 'grant select on table cron.job, cron.job_run_details to capitolkey_ops_readonly';
exception when others then
  raise notice 'Could not grant cron.* to capitolkey_ops_readonly: %', sqlerrm;
end $$;

-- Verify (should list only SELECT):
--   select table_schema, table_name, privilege_type
--   from information_schema.role_table_grants
--   where grantee = 'capitolkey_ops_readonly' order by 1, 2;
