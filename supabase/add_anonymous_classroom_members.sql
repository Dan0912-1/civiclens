-- Allow no-account ("anonymous") students to be tracked in classroom_members
-- and assignment_completions so teacher analytics reflect their joins and
-- completions. Before this migration, anonymous joins were client-side only
-- (sessionStorage) and never reached the database, leaving teacher stats
-- stuck at zero students.
--
-- Identity model: each row has exactly one identifier. `user_id` points at
-- an auth.users row for signed-in students; `anonymous_id` is a
-- client-generated UUID persisted in localStorage on the student's browser.
-- `display_name` is optional and is only populated when the classroom has
-- `require_name = true`.
--
-- Backwards compatible: every existing row has `user_id not null` and will
-- continue to satisfy the new CHECK constraint unchanged.
--
-- Safe to re-run: all operations guard against existing objects.

-- classroom_members --------------------------------------------------------

alter table classroom_members
  alter column user_id drop not null;

alter table classroom_members
  add column if not exists anonymous_id text,
  add column if not exists display_name text;

-- Replace the global unique (classroom_id, user_id) with two partial unique
-- indexes so the same classroom can hold both a user_id-keyed row and an
-- anonymous_id-keyed row without either blocking the other. The original
-- constraint name is the Postgres default for unique(classroom_id, user_id).
alter table classroom_members
  drop constraint if exists classroom_members_classroom_id_user_id_key;

create unique index if not exists classroom_members_user_unique
  on classroom_members(classroom_id, user_id)
  where user_id is not null;

create unique index if not exists classroom_members_anon_unique
  on classroom_members(classroom_id, anonymous_id)
  where anonymous_id is not null;

create index if not exists idx_cm_anonymous on classroom_members(anonymous_id)
  where anonymous_id is not null;

alter table classroom_members
  drop constraint if exists classroom_members_identity_check;
alter table classroom_members
  add constraint classroom_members_identity_check check (
    (user_id is not null and anonymous_id is null) or
    (user_id is null and anonymous_id is not null)
  );

-- assignment_completions ---------------------------------------------------

alter table assignment_completions
  alter column user_id drop not null;

alter table assignment_completions
  add column if not exists anonymous_id text;

alter table assignment_completions
  drop constraint if exists assignment_completions_assignment_id_user_id_key;

create unique index if not exists assignment_completions_user_unique
  on assignment_completions(assignment_id, user_id)
  where user_id is not null;

create unique index if not exists assignment_completions_anon_unique
  on assignment_completions(assignment_id, anonymous_id)
  where anonymous_id is not null;

create index if not exists idx_ac_anonymous on assignment_completions(anonymous_id)
  where anonymous_id is not null;

alter table assignment_completions
  drop constraint if exists assignment_completions_identity_check;
alter table assignment_completions
  add constraint assignment_completions_identity_check check (
    (user_id is not null and anonymous_id is null) or
    (user_id is null and anonymous_id is not null)
  );
