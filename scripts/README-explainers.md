# Daily explainer engine

`scripts/generate-explainers.mjs` generates short, nonpartisan, plain-language
explainers for a small batch of trending + student-relevant federal bills and
stores them in the `bill_explainers` table. Topic pages (`/topics/:slug`) and the
sitemap surface explainers whose `status = 'published'`.

It reuses the app's LLM path: **Groq Qwen3-32B primary, Claude Haiku 4.5
fallback** (same models as `api/server.js`). No new provider.

## Guardrail: nothing auto-publishes

Generated rows are written as **`status = 'draft'`**. A draft is stored but is
NOT shown anywhere on the site. Content only goes live when a human publishes it.
This is deliberate: the engine never auto-publishes unreviewed content at scale.

## One-time setup

Apply the table once in the Supabase SQL Editor (same as every other table in
`supabase/`):

```
supabase/create_bill_explainers.sql
```

Until it exists, the script still runs and prints generated explainers, but skips
the database write (it tells you so).

## Run it manually

From the repo root (`/Users/danieljacius/Downloads/civiclens`):

```bash
# Preview only — reads live data, generates, prints, writes nothing:
node --env-file=.env scripts/generate-explainers.mjs --dry-run --limit=3

# Generate 3 DRAFTS and store them (safe; drafts are not live):
node --env-file=.env scripts/generate-explainers.mjs --limit=3

# Regenerate even if the source text is unchanged:
node --env-file=.env scripts/generate-explainers.mjs --force --limit=3

# Only a specific topic tag:
node --env-file=.env scripts/generate-explainers.mjs --topic=education

# Generate and publish in one step (use only for content you trust):
node --env-file=.env scripts/generate-explainers.mjs --publish --limit=3
```

Flags: `--limit=N` (1-25, default 3), `--dry-run`, `--force`, `--topic=<tag>`,
`--publish`.

## Idempotent / safe to re-run

- Skips any bill whose stored explainer was built from the same source text
  (`source_hash` match), so re-runs don't waste LLM calls.
- Upserts on `bill_id`, so a re-run updates in place instead of duplicating.

## Review and publish drafts

After a run, review the drafts and promote the good ones:

```sql
-- See the latest drafts:
select bill_id, title, summary, why_it_matters, generated_at
from bill_explainers
where status = 'draft'
order by generated_at desc
limit 20;

-- Publish the ones you approve:
update bill_explainers
set status = 'published', updated_at = now()
where bill_id in ('119-hr-2847', '119-s-1234');

-- Unpublish if needed:
update bill_explainers set status = 'draft', updated_at = now()
where bill_id = '119-hr-2847';
```

## The daily schedule (paused by default)

A daily scheduled task drives this script through Claude Code's scheduling
tooling. It is created **disabled** so it never runs until Daniel turns it on.

- **Task id:** `capitolkey-daily-explainers`
- **Default schedule:** 7:00 AM local, daily
- **What it does each run:** generates a small batch of **drafts** (does NOT
  publish) and reports them so Daniel can review and publish.

Manage it from Claude Code:

- **Enable (start daily runs):** "Enable the `capitolkey-daily-explainers`
  scheduled task." (or set `enabled: true` via the scheduled-tasks tool)
- **Pause:** "Pause the `capitolkey-daily-explainers` scheduled task."
  (`enabled: false`)
- **Review output:** each run prints the generated drafts; then use the SQL above
  to publish. Scheduled tasks run while the Claude Code app is open; if it was
  closed when the task was due, it runs on next launch.

> Note: the task runs the script from `/Users/danieljacius/Downloads/civiclens`
> (the main checkout), so it picks up `scripts/generate-explainers.mjs` after
> this PR merges to `main`.
