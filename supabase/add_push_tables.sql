-- Push notification token storage
create table if not exists push_tokens (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  token      text not null,
  platform   text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  unique (user_id, token)
);

create index if not exists idx_push_tokens_user on push_tokens (user_id);
alter table push_tokens enable row level security;

-- Add push_notifications preference (default on)
alter table user_profiles
  add column if not exists push_notifications boolean not null default true;

-- Flip email_notifications default to off (push is now primary)
alter table user_profiles
  alter column email_notifications set default false;
