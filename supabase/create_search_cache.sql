-- Run this in Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- Creates the search_cache table for persistent LegiScan search result caching.
-- Search results are cached for 6 hours to survive Railway restarts and reduce
-- the 89% search query duplication flagged by LegiScan.

create table if not exists search_cache (
  cache_key   text primary key,
  results     jsonb not null default '[]',
  created_at  timestamptz not null default now()
);

-- Index for cleanup of old entries
create index if not exists idx_search_cache_created_at on search_cache (created_at);

-- Row Level Security: backend uses the service role key, so RLS is bypassed.
alter table search_cache enable row level security;

-- No policies = anon/authenticated users cannot read or write.
-- Only the service_role key (used by the backend) bypasses RLS.
