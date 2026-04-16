-- ─────────────────────────────────────────────────────────────────────────────
-- CapitolKey — Auth-adjacent tables (bookmarks)
-- Run this once in your Supabase project via: Dashboard → SQL Editor → New query
--
-- user_profiles has been moved to create_profiles_table.sql — running both
-- files on a fresh DB used to error on the duplicate CREATE and duplicate
-- policy names. create_profiles_table.sql is now the canonical source.
--
-- Prerequisites:
--   1. Enable Google OAuth:  Auth → Providers → Google → toggle on
--      (needs a Google Cloud OAuth client ID + secret)
--   2. Set redirect URLs:    Auth → URL Configuration → Redirect URLs
--      Add:  https://capitolkey.vercel.app
--      Add:  http://localhost:5173
--   3. Set frontend env vars (Vercel project settings + local .env):
--      VITE_SUPABASE_URL      = https://your-project.supabase.co
--      VITE_SUPABASE_ANON_KEY = your-anon-key   (Settings → API → anon/public)
-- ─────────────────────────────────────────────────────────────────────────────

-- Bookmarks (stores saved bills for logged-in users)
create table bookmarks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  bill_id    text not null,
  bill_data  jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (user_id, bill_id)
);

create index idx_bookmarks_user_id on bookmarks (user_id);

alter table bookmarks enable row level security;

create policy "Users can read own bookmarks"
  on bookmarks for select
  using (auth.uid() = user_id);

create policy "Users can insert own bookmarks"
  on bookmarks for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own bookmarks"
  on bookmarks for delete
  using (auth.uid() = user_id);
