# Pipeline Warden: access and nightly check (no secrets)

Pipeline Warden is an ops bot that checks, once a night, whether the bill ingest pipeline ran and whether the data it feeds is fresh. It is **read-only**. It is not Quota Keeper and never uses `ADMIN_SECRET`.

No credential belongs in this file, in the repo, or in any chat. Every access path below is either a sign-in the owner grants in a dashboard, a secret the owner puts directly into the bot's own runtime, or a public endpoint.

## Standing decisions

| Item | Value |
|---|---|
| Chief (escalation) | The Chief Grok bot in the CapitolKey ops group. Until that bot joins the thread, the human in the chat is Chief. |
| Report path | `/workspace/CapitolKey/reports/YYYY-MM-DD-pipeline.md` (UTC date) |
| Schedule | **06:20 UTC** daily. That is 2:20 AM EDT until 2026-11-01, then 1:20 AM EST. Keep the schedule in UTC; the crons it follows are UTC. |
| Email | Warden sends no email and never uses capitolkeyapp@gmail.com or dejacius@gmail.com. |
| Paging | Page Chief **only on RED**. Everything else goes in the report. |

The 06:20 UTC slot follows `daily_sync` (`0 5 * * *`) and `curated_bills` / `refreshCuratedBills` (`0 6 * * *`) in `api/server.js`. It does **not** mean `daily_sync` has finished. See "What normal looks like".

## Access paths

### 1. Supabase: `ops_bot`, SELECT only

`ops_bot` is a Postgres **login role** in the group `capitolkey_ops_readonly` (`supabase/read_only_ops_role.sql`). The group can SELECT `bills`, `curated_bills`, `job_runs`, `personalization_cache`, `bill_explainers` and `user_profiles`, and nothing else.

A Supabase **dashboard** sign-in can't run SQL as `ops_bot`. The dashboard SQL editor runs as `postgres` for Owner, Administrator and Developer seats, which is full write access. The Read-Only seat is Team-plan only (this project is on Pro). It runs as `supabase_read_only_user`, which reads every table including `auth.users`, and that seat can also view Edge Function secrets. **So Warden gets no Supabase dashboard seat.** There are two ways to use `ops_bot` instead:

- **A. Bot-held connection.** If Warden's runtime has its own secret store, the owner puts the `ops_bot` connection string there directly, for example as `OPS_DB_URL`, and never in chat. Use Supabase dashboard → Connect → **Session pooler**, with user `ops_bot.<project-ref>` and the `ops_bot` password. Warden then runs `scripts/pipeline-freshness.sql` queries 1, 2 and 4, one at a time.
- **B. No credential at all.** Chief runs queries 1, 2 and 4 from `scripts/pipeline-freshness.sql` in the SQL editor and pastes the result rows into the thread. These rows hold pipeline stats only, no user data. Until then, Warden reports `GAP: no DB`.

Query 5 (pg_cron history) is owner-only. As `ops_bot` it fails with `permission denied for schema cron`, and that is expected.

#### Owner SQL: create or repair `ops_bot` (idempotent)

Run it in the Supabase SQL editor as the project owner. If the editor asks you to confirm a potentially destructive operation, that is because of the REVOKE statements. Confirm it.

```sql
-- ops_bot: SELECT-only login for Pipeline Warden. Idempotent. Run as postgres.
-- Prerequisite: supabase/read_only_ops_role.sql (creates capitolkey_ops_readonly).
--
-- Password: used ONLY if ops_bot does not exist yet. Replace CHANGE_ME in the
-- editor, run, then delete it from the editor and don't save the snippet. The
-- CREATE is inside a DO block on purpose: this project logs DDL
-- (log_statement = 'ddl'), and a top-level CREATE ROLE would be logged with
-- its password. If ops_bot already exists, its password is not touched.
do $$
declare
  pw constant text := 'CHANGE_ME';
begin
  if not exists (select 1 from pg_roles where rolname = 'capitolkey_ops_readonly') then
    raise exception 'capitolkey_ops_readonly is missing. Run supabase/read_only_ops_role.sql first, then re-run this.';
  end if;

  if exists (select 1 from pg_roles where rolname = 'ops_bot') then
    raise notice 'ops_bot already exists; password left unchanged.';
  elsif pw = 'CHANGE' || '_ME' or length(pw) < 24 then
    raise exception 'ops_bot does not exist yet. Replace CHANGE_ME with a random password of 24+ characters, then run again.';
  else
    execute format('create role ops_bot login connection limit 3 password %L in role capitolkey_ops_readonly', pw);
    raise notice 'Created ops_bot.';
  end if;
end $$;

-- Membership in the read-only group is the ONLY source of privileges.
-- (Prints a notice if ops_bot is already a member.)
grant capitolkey_ops_readonly to ops_bot;

-- Guard rails. The grants are the real boundary; these stop accidents and runaway queries.
alter role ops_bot connection limit 3;
alter role ops_bot set default_transaction_read_only = on;
alter role ops_bot set statement_timeout = '30s';
alter role ops_bot set idle_in_transaction_session_timeout = '60s';

-- No direct table grants on ops_bot itself.
revoke all on all tables in schema public from ops_bot;

-- pg_cron: removes the cron grants that older copies of read_only_ops_role.sql
-- gave the group. They returned 0 rows (pg_cron RLS) and allowed cron.schedule().
do $$
begin
  execute 'revoke select on table cron.job, cron.job_run_details from capitolkey_ops_readonly';
  execute 'revoke usage on schema cron from capitolkey_ops_readonly';
exception when others then
  raise notice 'Could not revoke cron.*: %', sqlerrm;
end $$;
```

**Verify.** Run this on its own. Every column should be `true`:

```sql
select r.rolcanlogin and not r.rolsuper and not r.rolbypassrls and not r.rolcreaterole and not r.rolcreatedb as login_not_elevated,
       pg_has_role('ops_bot', 'capitolkey_ops_readonly', 'member') as in_readonly_group,
       not exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace, unnest(array['INSERT','UPDATE','DELETE','TRUNCATE']) p where n.nspname = 'public' and c.relkind in ('r','p','v','m','f') and has_table_privilege('ops_bot', c.oid, p)) as no_writes_in_public,
       not has_schema_privilege('ops_bot', 'cron', 'USAGE') and not has_schema_privilege('ops_bot', 'public', 'CREATE') as no_cron_no_ddl,
       exists (select 1 from pg_db_role_setting s, unnest(s.setconfig) c where s.setrole = r.oid and c = 'default_transaction_read_only=on') as read_only_default from pg_roles r where r.rolname = 'ops_bot';
```

**Rotating the password** (only needed if nobody holds the current one for path A). Keep it inside a DO block so the password stays out of the DDL log, and don't save the snippet:

```sql
do $$ begin execute format('alter role ops_bot password %L', 'CHANGE_ME'); end $$;
```

### 2. Railway: project Viewer, logs only

Railway has no logs-only **workspace** role. Workspace Member can view logs but can also create, edit and read Variables (`SUPABASE_SERVICE_KEY`, `ADMIN_SECRET`, `LEGISCAN_API_KEY`), and Deployer can't see logs at all. The fit is the **project-level Viewer** role, which Railway documents as read-only access to the project, with no deploys and no view of environment variables.

Owner checklist:

1. Warden needs its own Railway account, under an email address that is **not** capitolkeyapp@gmail.com or dejacius@gmail.com. No Railway API token is created or shared.
2. Railway → project **civiclens-backend** → Settings → **Members** → invite that account as **Viewer**. Never Editor, and never a workspace member.
3. Don't open or share **Variables**. Don't make the project public: public projects expose deploy logs to anyone.
4. Replicas must be **1**. Service **civiclens** → Settings → Deploy → Regions: `europe-west4`, 1 replica (verified 2026-09-28). Every replica runs every cron.
5. On Warden's first sign-in, confirm that Viewer can open the deploy logs of the active deployment. If it can't, or if there is no seat, **skip Railway**. Warden then works from `job_runs` (path A or B) plus the public endpoints.

Names: project `civiclens-backend`, service `civiclens`, environment `production`, public domain `civiclens-production-07ed.up.railway.app`.

Log lines to search in the deploy logs:

| Search | Meaning |
|---|---|
| `[sync] Complete in` | One `daily_sync` run finished. The JSON holds `congress`, `openstates`, `legiscanCatalog` and `stateTexts` counts. `stateTexts.rateLimited: true` means the OpenStates daily quota was hit. |
| `[legiscan-catalog]` | Per-state LegiScan catalog. `skipping ... closed` is normal. `HTTP 429` or `fatal` is a finding (flag it for Quota Keeper; don't compute quota). |
| `[ranker]` | Feed re-rank after each sync. `FINAL selected: N` is the healthy end. `Query error` is a finding. |
| `[job-runs]` | Printed **only** when the `job_runs` ledger write failed or was skipped. Any hit is a finding. No hits is normal. |

### 3. Public fallback (no login)

Use this until path A or B and a Railway seat are working:

- `GET https://capitolkey.org/api/health` returns `{"status":"ok","timestamp":...}`. It proves the web process answers through Vercel. It says **nothing** about crons or data freshness. If capitolkey.org blocks the bot, use `https://civiclens-production-07ed.up.railway.app/api/health`.
- `GET https://capitolkey.org/api/featured` returns up to 3 `bills` plus `rankedAt`. **`rankedAt` is when this response was built** (cached for 15 minutes). It is not a sync or refresh time, so never report it as one. Report the newest `bills[].bill_data.latestActionDate`. Within 14 days means `curated_bills` has recent rows. An empty `bills` list can be a congressional recess.
- One request to each per run. `/api/featured` is rate-limited to 60/min per IP.

Report `GAP: no DB` and/or `GAP: no Railway logs`, and write `synced_at: unknown`. **Never infer or invent `synced_at`, run times or durations.**

## What normal looks like (measured 2026-09-28)

- **`daily_sync` runs for 10 to 55 hours**, not minutes. The last seven `[sync] Complete` lines reported 35,979s to 199,188s, so consecutive runs overlap, and every deploy kills whatever is in flight. At 06:20 UTC, today's `daily_sync` row is normally `status = 'started'`. That is not an incident.
- **`curated_bills` takes about 20 seconds.** At 06:20 UTC today's row should be `ok`.
- **`job_runs` started on 2026-09-28.** PR #136 deployed at 03:13 UTC that day, so the table is empty until the 05:00 UTC run. The "no `ok` daily_sync in 72h" rule below applies from **2026-10-01 05:00 UTC**.
- **Most states look stale off-season.** On 2026-09-28, 33 of 52 jurisdictions had `stale_48h = true` because most legislatures have adjourned. Per-state staleness alone is never RED. Compare each night's count with the previous report instead.
- **NH is excluded on purpose** (gc.nh.gov serves a JS challenge instead of bill text). NH rows being textless or stale is never an incident.
- Ingest is APIs first. PDF and HTML are used only for bill text.
- Two `[sync] Complete` lines a few seconds apart, or two `job_runs` rows of the same job started within 60 seconds of each other, mean two processes are running the crons (a second replica or a stuck old deploy). Overlapping runs from one process start about 24 hours apart, not seconds.

## Status rules

**RED (page Chief):**

1. No `daily_sync` row started between 05:00 and 05:10 UTC today, so the cron didn't fire. Applies from 2026-09-28.
2. Two rows of the same `job_name` started within 60 seconds of each other, or two `[sync] Complete` lines seconds apart. Replica suspicion: the crons, LegiScan traffic and bookmark emails are all doubled.
3. A `daily_sync` row with `status = 'error'`.
4. `US` (federal) `last_synced_at` is older than 48 hours, or no jurisdiction synced in the last 48 hours.
5. No `daily_sync` row reached `ok` in the last 72 hours. Applies from 2026-10-01 05:00 UTC.
6. `curated_bills` `max(fetched_at)` is older than 48 hours.
7. `/api/health` is non-200 or unreachable on two tries 5 minutes apart, on both capitolkey.org and the Railway domain.

**AMBER (report only):** a `curated_bills` error or no row today. `rows_within_14d = 0`. The count of fresh jurisdictions (excluding NH) dropped by 5 or more since the last report. A `daily_sync` stuck at `started` for over 60 hours. Three or more `daily_sync` rows `started` at once. LegiScan `HTTP 429`. `stateTexts.rateLimited: true`. Any `[job-runs]` line. `[ranker] Query error`. `/api/featured` returned an empty list or a 5xx once. Any GAP.

**GREEN:** none of the above.

## Report template

```markdown
# Pipeline YYYY-MM-DD (06:20 UTC)
Status: GREEN | AMBER | RED
Sources: DB (ops_bot | Chief-run | GAP: no DB), Railway logs (yes | GAP: no Railway logs), public endpoints (yes)

## Jobs (job_runs, last 48h)
daily_sync: <started_at> <status> <duration or "running">  (or: unknown, GAP)
curated_bills: ...

## Freshness (query 1)
US last_synced_at: <value or unknown>
Fresh jurisdictions (<48h, excl. NH): N (prev: M)

## Homepage (query 2 or /api/featured)
curated last_fetched_at: <value or unknown>; rows_within_14d: N
/api/featured: <count> bills, newest latestActionDate <date>

## Logs
[sync] Complete: <latest line summary or GAP>
Findings: <429s, [job-runs], ranker errors, or "none">

## Findings and actions for Chief
- ...
```

## Never

- Change env vars, open Railway Variables, redeploy, restart, or scale.
- Use or ask for `SUPABASE_SERVICE_KEY`, `ADMIN_SECRET`, LegiScan keys, Railway API tokens, or database passwords in chat.
- Write to any table, or run anything other than SELECT.
- Email anyone.
- Treat NH textlessness, per-state off-season staleness, or a still-running `daily_sync` at 06:20 as incidents.
