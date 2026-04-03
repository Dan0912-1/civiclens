-- Run this in Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- Creates the bill_text_cache table for persistent Congress.gov bill text caching.
-- Bill text is immutable per version, so cached indefinitely.

create table if not exists bill_text_cache (
  cache_key    text primary key,
  bill_text    text not null default '',
  word_count   integer not null default 0,
  version      text not null default '',
  crs_summary  text not null default '',
  crs_version  text not null default '',
  created_at   timestamptz not null default now()
);

-- Index for cleanup of old entries
create index if not exists idx_btc_created_at on bill_text_cache (created_at);

-- Row Level Security: backend uses the service role key, so RLS is bypassed.
alter table bill_text_cache enable row level security;

-- No policies = anon/authenticated users cannot read or write.
-- Only the service_role key (used by the backend) bypasses RLS.
