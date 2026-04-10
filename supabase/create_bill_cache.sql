-- Run this in Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- Creates the bill_cache table for persistent LegiScan getBill response caching.
-- Stores change_hash so we can skip re-fetching unchanged bills.

create table if not exists bill_cache (
  cache_key    text primary key,
  bill_data    jsonb not null default '{}',
  change_hash  text not null default '',
  session_id   integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- Index for cleanup and session-based lookups
create index if not exists idx_bill_cache_updated_at on bill_cache (updated_at);
create index if not exists idx_bill_cache_session_id on bill_cache (session_id);

-- Row Level Security: backend uses the service role key, so RLS is bypassed.
alter table bill_cache enable row level security;

-- No policies = anon/authenticated users cannot read or write.
-- Only the service_role key (used by the backend) bypasses RLS.
