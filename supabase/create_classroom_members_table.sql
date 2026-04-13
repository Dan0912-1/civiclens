-- Classroom members: links users to classrooms with a role
create table if not exists classroom_members (
  id            uuid primary key default gen_random_uuid(),
  classroom_id  uuid not null references classrooms(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  role          text not null default 'student' check (role in ('student', 'teacher')),
  joined_at     timestamptz not null default now(),
  unique(classroom_id, user_id)
);

create index if not exists idx_cm_classroom on classroom_members(classroom_id);
create index if not exists idx_cm_user on classroom_members(user_id);

alter table classroom_members enable row level security;
