-- Assignment completions: tracks that a student completed viewing an assigned bill
-- Privacy: only ever queried with aggregate functions (COUNT, AVG), never per-student
create table if not exists assignment_completions (
  id              uuid primary key default gen_random_uuid(),
  assignment_id   uuid not null references classroom_assignments(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  completed_at    timestamptz not null default now(),
  time_spent_sec  int check (time_spent_sec is null or time_spent_sec between 0 and 3600),
  unique(assignment_id, user_id)
);

create index if not exists idx_ac_assignment on assignment_completions(assignment_id);
create index if not exists idx_ac_user on assignment_completions(user_id);

alter table assignment_completions enable row level security;
