# Advisor: access (no secrets)

Advisor is a Grok bot that consults for CapitolKey on product, growth, outreach, funding and risk. Its standing instructions are in `docs/advisor-bot.md`. It **reads and recommends**. It never writes to the repo, the database, hosting, email or social media, and it is not in the paging chain.

Like every bot here, it gets the least access that does the job. No credential goes in this file, in the repo, in the bot's prompt, or in any chat.

## Standing decisions

| Item | Value |
|---|---|
| Reports to | Danny (founder), in Advisor's own thread. |
| Escalation | Not in the paging chain. Chief owns ops escalation. Advisor flags an unescalated RED to Danny and Chief once, and never pages. |
| Weekly brief | Sundays **22:00 UTC** (6 PM EDT; 5 PM EST after 2026-11-01). Written to `/workspace/CapitolKey/advisor/YYYY-MM-DD-brief.md` (UTC date). |
| Student data | Aggregates only, through the `advisor` views. No per-student rows, ever. |
| Email | None. Advisor never uses capitolkeyapp@gmail.com or dejacius@gmail.com. |
| Writes | Only to `/workspace/CapitolKey/advisor/`. |

## Access paths

### 1. Public (no login)

- **Code:** `github.com/Dan0912-1/civiclens` is public. Advisor reads it, including docs, open issues and PRs, through the web. **Don't give it a GitHub token**: any token that can read this repo through the API can also be scoped to write.
- **Product:** `https://capitolkey.org`, the App Store and Play Store listings, and two public endpoints:
  - `GET /api/health` (liveness only).
  - `GET /api/featured` (homepage bills). It's rate-limited to 60/min per IP, so use one request per brief.
- **Web and X search:** on. It uses them for research on civics policy, grants, competitors and school calendars.

### 2. Team workspace

- **Read:** `/workspace/CapitolKey/reports/`, where Pipeline Warden, Quota Keeper, Uptime Sentinel and Chief write their reports. Advisor uses them as context and doesn't re-run their checks.
- **Write:** `/workspace/CapitolKey/advisor/` only, for briefs and memos.

### 3. Supabase: `advisor_bot`, aggregate views only

Applied to production on **2026-10-01** from `supabase/advisor_metrics.sql`.

`advisor_bot` is a login role in the group `capitolkey_advisor_readonly`. The group can SELECT the views in schema `advisor` and nothing else: no `public.*` tables, no `auth.users`, no `cron`. The views run with their owner's rights and return counts only. Demographic breakdowns fold every group under 5 into one row.

| View | What it answers |
|---|---|
| `advisor.brief` | Everything below except `coverage`, as one JSON value: `select brief from advisor.brief;` |
| `advisor.snapshot` | Accounts (total, new and signed in over 7 and 30 days, by sign-in provider), profiles, notification opt-ins, bookmarks, interactions, and personalizations (which include anonymous use). |
| `advisor.weekly` | 26 weeks of new accounts, classrooms, assignments, completions, interactions, bookmarks, personalizations and feedback. |
| `advisor.classroom_funnel` | Teachers with a classroom, and classrooms with students, with assignments, with completions and Google-linked. |
| `advisor.profile_mix` | State, age/grade and interest counts, with groups under 5 folded together. |
| `advisor.topic_interest` | Interactions by bill topic and action over the last 90 days. |
| `advisor.coverage` | Bills, feed-eligible bills, bills with text and newest action, per jurisdiction. |

`advisor_bot` was created **without a password**, so nobody can log in as it yet. To turn it on, choose one of these:

- **A. Bot-held connection.** Use this if Advisor's runtime has its own secret store.
  1. Set a password in the Supabase SQL editor. Keep it inside the DO block: this project logs DDL, and a bare `alter role ... password` would land in the logs. Use 24+ random letters and digits. Don't save the snippet, and clear the tab afterwards.
     ```sql
     do $$ begin execute format('alter role advisor_bot password %L', 'CHANGE_ME'); end $$;
     ```
  2. Supabase dashboard → **Connect** → **Session pooler**. Build the string with user `advisor_bot.<project-ref>` and that password.
  3. Paste the string into Advisor's secret store as `ADVISOR_DB_URL`. **Only there.** It doesn't go in chat, in the prompt, in the repo, or in Railway or Vercel.
- **B. No credential.** Danny runs `select brief from advisor.brief;` in the SQL editor and pastes the result into Advisor's thread. The result is counts only, so it's safe to paste. Until either path works, Advisor writes `GAP: no metrics` and works from public sources.

The role's guard rails are:
- read-only transactions by default,
- a 20-second statement timeout,
- at most 2 connections,
- `search_path = advisor`.

**Verify** by running this on its own. Every column should be `true`:

```sql
select
  not has_table_privilege('advisor_bot', 'public.user_profiles', 'SELECT')
    and not has_table_privilege('advisor_bot', 'public.feedback', 'SELECT')
    and not has_table_privilege('advisor_bot', 'auth.users', 'SELECT')   as no_base_tables,
  has_table_privilege('advisor_bot', 'advisor.brief', 'SELECT')          as reads_brief,
  not has_schema_privilege('anon', 'advisor', 'USAGE')
    and not has_schema_privilege('authenticated', 'advisor', 'USAGE')    as app_keys_blocked,
  not pg_has_role('advisor_bot', 'capitolkey_ops_readonly', 'member')    as not_ops_role;
```

All four were `true` on 2026-10-01, and Supabase's security advisor showed no new findings after the change.

**Rollback:** `drop schema advisor cascade; drop role if exists advisor_bot; drop role if exists capitolkey_advisor_readonly;`

## What Advisor does not get, and why

| Not given | Why |
|---|---|
| `ops_bot` / `capitolkey_ops_readonly` | They can read `user_profiles`: minors' names, emails, family situation and employment. |
| `ADMIN_SECRET` | It also opens `/api/admin/feedback`, which returns names, emails and messages. The views cover what the admin stats would give. |
| `SUPABASE_SERVICE_KEY`, any Supabase dashboard seat | Full read/write on everything, including `auth.users`. |
| Railway, Vercel | Advisor doesn't operate infrastructure. Pipeline Warden and Uptime Sentinel watch it. |
| Gmail (either address) | Advisor contacts nobody. The outreach agent and Inbox own the product mailbox. |
| GitHub token | The repo is public, and a token adds write risk with no read benefit. |
| Sentry, App Store Connect, Play Console, Google Classroom | Not needed for advice. If a question needs one, Danny pulls the number. |

## Never

- Ask for, accept or repeat a password, key, token or connection string. If one is pasted in chat, tell Danny to rotate it.
- Write anywhere except `/workspace/CapitolKey/advisor/`.
- Ask for per-student rows, names or emails, or try to work out who a student is from counts.
- Email, post or message anyone outside Danny and the bot group.
- Page anyone.
