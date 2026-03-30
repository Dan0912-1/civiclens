-- Run this in Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- Creates the personalization_cache table for persistent Claude response caching.

create table if not exists personalization_cache (
  cache_key  text primary key,
  bill_id    text not null,
  grade      text not null,
  interests  text[] not null default '{}',
  response   jsonb not null,
  created_at timestamptz not null default now()
);

-- Index for querying by bill (useful for analytics / cache inspection)
create index if not exists idx_cache_bill_id on personalization_cache (bill_id);

-- Row Level Security: backend uses the service role key, so RLS is bypassed.
-- Enable RLS anyway as a safety net if someone accidentally uses the anon key.
alter table personalization_cache enable row level security;

-- No policies = anon/authenticated users cannot read or write.
-- Only the service_role key (used by the backend) bypasses RLS.
