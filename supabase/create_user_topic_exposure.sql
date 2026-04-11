-- Track per-user topic exposure for diversity enforcement.
-- Incremented on each bill interaction; used by diversifiedSelect()
-- to pick from least-exposed topics.

create table if not exists user_topic_exposure (
  user_id       uuid not null references auth.users(id) on delete cascade,
  topic         text not null,
  view_count    int not null default 0,
  last_viewed_at timestamptz,
  primary key (user_id, topic)
);

create index if not exists idx_ute_user on user_topic_exposure (user_id);

-- Enable RLS (service-role only)
alter table user_topic_exposure enable row level security;
