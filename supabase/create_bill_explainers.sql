-- Run this in Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- Creates the bill_explainers table that the daily content engine writes to.
--
-- Populated by scripts/generate-explainers.mjs: a short, nonpartisan,
-- plain-language explainer per bill, keyed by congress_bill_id. Topic and bill
-- pages surface rows where status = 'published'; rows default to 'draft' so
-- nothing goes live until a human reviews and promotes it.

create table if not exists bill_explainers (
  bill_id        text primary key,          -- congress_bill_id, e.g. "119-hr-2847"
  title          text not null default '',   -- bill title at generation time
  summary        text not null default '',   -- 2-3 sentences: what the bill does
  why_it_matters text not null default '',   -- 1-2 sentences: who it affects, how
  key_points     text[] not null default '{}',
  topics         text[] not null default '{}',
  status         text not null default 'draft',  -- 'draft' | 'published'
  provider       text not null default '',       -- 'groq' | 'haiku'
  model          text not null default '',
  source_hash    text not null default '',       -- detects when the source changed
  generated_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Topic/bill pages filter on status; GIN index for array containment by topic.
create index if not exists idx_bill_explainers_status on bill_explainers (status);
create index if not exists idx_bill_explainers_topics on bill_explainers using gin (topics);

-- Row Level Security: backend + the generation script use the service role key,
-- which bypasses RLS. Enable it anyway so the anon key can never read/write.
alter table bill_explainers enable row level security;

-- No policies = anon/authenticated users cannot read or write.
-- Only the service_role key bypasses RLS.

-- To publish reviewed drafts (example):
--   update bill_explainers set status = 'published', updated_at = now()
--   where bill_id in ('119-hr-2847', '119-s-1234');
