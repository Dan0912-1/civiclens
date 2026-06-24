-- Google Classroom assign + grade passback (2026-06-23, Phase 2/3).
--
-- Extends the existing classroom tables (does not duplicate them). A bill pushed
-- to Google Classroom lazily attaches to a CapitolKey classroom + assignment;
-- completion flows through the existing assignment_completions table, and grade
-- passback writes back to the linked Google coursework.
--
-- Safe to re-run: all adds are IF NOT EXISTS.

-- Link a CapitolKey classroom to a Google course (one course per classroom).
-- Lazily set the first time a teacher pushes a bill to that course.
alter table classrooms add column if not exists google_course_id   text;
alter table classrooms add column if not exists google_course_name text;
create index if not exists idx_classrooms_google_course
  on classrooms(owner_id, google_course_id) where google_course_id is not null;

-- Mark an assignment as mirrored to Google + store the handles needed for
-- grade passback (course + coursework ids) and the teacher-facing link.
alter table classroom_assignments add column if not exists google_course_id     text;
alter table classroom_assignments add column if not exists google_coursework_id text;
alter table classroom_assignments add column if not exists google_alternate_link text;
alter table classroom_assignments add column if not exists google_max_points    int;
create index if not exists idx_ca_google_coursework
  on classroom_assignments(google_coursework_id) where google_coursework_id is not null;

-- Grade-passback bookkeeping per completion so we don't double-send and the
-- teacher can see sync status.
alter table assignment_completions add column if not exists google_grade_sent_at timestamptz;
alter table assignment_completions add column if not exists google_assigned_grade numeric;
