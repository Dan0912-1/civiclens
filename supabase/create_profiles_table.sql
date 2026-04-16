-- User profiles table for CapitolKey (canonical source for user_profiles).
-- Stores onboarding profile data for signed-in users so it persists across sessions.
-- Run this in your Supabase SQL Editor (alongside create_cache_table.sql).
--
-- Idempotent: safe to re-run. Policies are dropped-then-created so the
-- migration doesn't error out when the table already exists on prod.

create table if not exists user_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  profile     jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- Enable Row Level Security
alter table user_profiles enable row level security;

-- Users can only read/write their own profile
drop policy if exists "Users can read own profile" on user_profiles;
create policy "Users can read own profile"
  on user_profiles for select
  using (auth.uid() = id);

drop policy if exists "Users can insert own profile" on user_profiles;
create policy "Users can insert own profile"
  on user_profiles for insert
  with check (auth.uid() = id);

drop policy if exists "Users can update own profile" on user_profiles;
create policy "Users can update own profile"
  on user_profiles for update
  using (auth.uid() = id);
