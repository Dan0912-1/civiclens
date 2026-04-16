-- Classroom assignments: bills assigned by teachers
create table if not exists classroom_assignments (
  id            uuid primary key default gen_random_uuid(),
  classroom_id  uuid not null references classrooms(id) on delete cascade,
  bill_id       text not null,
  bill_data     jsonb not null default '{}',
  assigned_by   uuid not null references auth.users(id) on delete cascade,
  instructions  text check (instructions is null or char_length(instructions) <= 500),
  due_date      date,
  created_at    timestamptz not null default now()
);

create index if not exists idx_ca_classroom on classroom_assignments(classroom_id);
create index if not exists idx_ca_classroom_bill on classroom_assignments(classroom_id, bill_id);

alter table classroom_assignments enable row level security;
