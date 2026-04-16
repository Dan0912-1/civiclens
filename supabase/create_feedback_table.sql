-- Feedback submissions (2026-04-16).
--
-- POST /api/feedback writes here (api/server.js). A GET endpoint and the
-- weekly summary job both read from it. Previously there was no migration
-- for this table — prod has been carrying it as an undocumented side
-- effect of an ad-hoc dashboard create. Committing the schema so fresh
-- environments build the same table.

create table if not exists feedback (
  id         uuid primary key default gen_random_uuid(),
  name       text,
  email      text,
  type       text not null,
  message    text not null,
  created_at timestamptz not null default now()
);

create index if not exists feedback_created_at_idx
  on feedback (created_at desc);

create index if not exists feedback_type_idx
  on feedback (type);

-- RLS: feedback is written and read exclusively by the backend using the
-- service key. Lock everything else out so a leaked anon key can't
-- scrape user feedback or spam the table.
alter table feedback enable row level security;

-- No policies = default-deny for anon / authenticated. Service key
-- bypasses RLS regardless.
