-- Bill-level topic cache (profile-independent)
-- Populated from Congress.gov policyArea and refined by Claude personalization.
-- Enables topic-based scoring before personalization runs.

create table if not exists bill_topics (
  bill_id     text primary key,
  topic_tags  text[] not null default '{}',
  policy_area text default '',
  source      text not null default 'congress_gov',
  created_at  timestamptz not null default now()
);

-- GIN index for array containment queries (e.g., bills with topic 'Education')
create index if not exists idx_bill_topics_tags
  on bill_topics using gin (topic_tags);

-- Enable RLS (service-role only — backend writes, no direct user access)
alter table bill_topics enable row level security;
