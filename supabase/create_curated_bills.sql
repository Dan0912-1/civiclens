-- Run this in Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- Creates the curated_bills table for the daily Congress.gov bill curation cron.
-- Populated automatically by the refreshCuratedBills() cron job in api/server.js.

create table if not exists curated_bills (
  id                 bigint generated always as identity primary key,
  congress           integer not null,
  bill_type          text not null,
  bill_number        text not null,
  title              text not null default '',
  origin_chamber     text not null default '',
  latest_action      text not null default '',
  latest_action_date text not null default '',
  update_date        text not null default '',
  interest_category  text not null default '',
  source             text not null default 'congress.gov',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  unique (congress, bill_type, bill_number)
);

create index if not exists idx_curated_bills_update_date on curated_bills (update_date desc);
create index if not exists idx_curated_bills_category on curated_bills (interest_category);

-- Row Level Security: backend uses the service role key, so RLS is bypassed.
alter table curated_bills enable row level security;

-- No policies = anon/authenticated users cannot read or write.
-- Only the service_role key (used by the backend) bypasses RLS.
