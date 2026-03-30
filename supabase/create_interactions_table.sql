-- Bill interaction tracking for interest refinement
create table if not exists bill_interactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  bill_id     text not null,
  action_type text not null check (action_type in ('view_detail', 'expand_card', 'bookmark')),
  topic_tag   text,
  created_at  timestamptz not null default now()
);

create index if not exists idx_bi_user on bill_interactions (user_id);
create index if not exists idx_bi_user_topic on bill_interactions (user_id, topic_tag);

alter table bill_interactions enable row level security;
-- Backend uses service role key, no anon policies needed.
