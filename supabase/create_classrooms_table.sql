-- Classrooms: teacher-created classes with join codes
create table if not exists classrooms (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 100),
  join_code   text not null unique check (char_length(join_code) = 6),
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_classrooms_owner on classrooms(owner_id);
create index if not exists idx_classrooms_join_code on classrooms(join_code);

alter table classrooms enable row level security;
