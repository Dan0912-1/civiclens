-- Run this in Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- Creates the featured_bills table used by the "Moving this week" section on the homepage.
--
-- A scheduled job in api/server.js repopulates this table every hour by:
--   1. Fetching recently-updated federal bills from LegiScan
--   2. Scoring each bill for momentum (recent action, chamber activity, youth relevance)
--   3. Writing the top 3 back with a ranked_at timestamp
--
-- The homepage reads from this table directly via /api/featured — no LegiScan call
-- at page-load time, so the hero stays fast even for anonymous visitors.

create table if not exists featured_bills (
  slot        int primary key,              -- 1, 2, or 3 (deterministic top-N)
  bill_data   jsonb not null,               -- full bill object (id, type, number, title, etc.)
  status_label text not null,               -- "Floor Vote Wed", "In Committee", "Passed House"
  status_kind  text not null,               -- "active" | "committee" | "passed" (controls badge color)
  topic_tag    text,                        -- "Education", "Climate", etc. (optional)
  impact_line  text,                        -- one-line plain-English summary (optional, from Claude)
  civic_score  int not null default 5,      -- generic 1-10 "civic impact" score for anonymous visitors
  ranked_at    timestamptz not null default now()
);

-- Row Level Security: backend uses service role key (bypasses RLS), but enable
-- it anyway so if someone accidentally uses the anon key, they can still read.
alter table featured_bills enable row level security;

-- Public read access — featured bills are public homepage content
drop policy if exists "featured_bills_public_read" on featured_bills;
create policy "featured_bills_public_read"
  on featured_bills
  for select
  using (true);
