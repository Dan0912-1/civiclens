-- Google Classroom OAuth tokens (2026-06-23).
--
-- One row per teacher who connects their Google account for the Google
-- Classroom integration. This is a SEPARATE OAuth flow from Supabase Auth:
-- Supabase's Google sign-in is implicit/PKCE and never yields an offline
-- refresh token, but grade passback happens asynchronously when the teacher
-- is not in a live session, so we run our own server-side flow with
-- access_type=offline + prompt=consent and persist the refresh token here.
--
-- SECURITY: refresh_token grants ongoing access to the teacher's Google
-- Classroom (roster emails, coursework, grades). It is stored ENCRYPTED at
-- rest (AES-256-GCM, key in env GOOGLE_TOKEN_ENC_KEY) — see api/googleClassroom.js.
-- Every code path that touches this table uses the Supabase service key
-- (server-side). RLS is enabled with NO policies so the anon/authenticated
-- keys default-deny: even a future client-side query can never read a token.

create table if not exists google_oauth_tokens (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null unique references auth.users(id) on delete cascade,
  google_email             text,                       -- the connected Google account (may differ from CapitolKey login)
  refresh_token_enc        text not null,              -- AES-256-GCM ciphertext, never plaintext
  access_token_enc         text,                       -- cached short-lived token (encrypted), optional
  access_token_expires_at  timestamptz,                -- expiry of the cached access token
  scopes                   text,                       -- space-delimited scopes Google actually granted
  connected_at             timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists idx_google_oauth_user on google_oauth_tokens(user_id);

-- Default-deny: enable RLS but intentionally add NO policies. Tokens are
-- secrets; only the service key (which bypasses RLS) may read or write them.
alter table google_oauth_tokens enable row level security;
