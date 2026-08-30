-- Google Classroom: teacher-controlled coursework options.
--
-- Three things the teacher could not control before:
--
-- 1. TITLE. We posted the bill's official title verbatim, so a Classwork list
--    read "To amend the Servicemembers Civil Relief Act to provide relief for
--    members of the uniformed services who homeschool their dependent
--    children, and for other purposes." The teacher now edits it, and the
--    prefilled default is a readable "HR 9351: ..." instead.
--
-- 2. AUTO-SUBMIT. Credit was always awarded automatically once the bill
--    finished loading. Some teachers want that; others want the student to
--    deliberately click Submit, so that "done" means the student says they're
--    done rather than that a page rendered. Either way the student must be
--    signed in — an anonymous reader has no identity to attach a grade to —
--    which is why this is stored per assignment and surfaced in the modal.
--
-- 3. DUE TIME. due_date holds only a calendar day, so nothing recorded the
--    time of day the teacher chose. We now keep the absolute instant we sent
--    to Google, which is also what lets us show the same due time the student
--    sees in Classroom.
--
-- Safe to re-run: all adds are IF NOT EXISTS.

alter table classroom_assignments add column if not exists google_title       text;
alter table classroom_assignments add column if not exists google_auto_submit boolean not null default true;
alter table classroom_assignments add column if not exists due_at             timestamptz;

comment on column classroom_assignments.google_title is
  'Teacher-facing coursework title as posted to Google Classroom. Null means the bill title was used (pre-2026-08 assignments).';
comment on column classroom_assignments.google_auto_submit is
  'true = credit is recorded as soon as the student finishes reading; false = the student must click Submit for credit.';
comment on column classroom_assignments.due_at is
  'Absolute due instant. due_date keeps only the calendar day, which cannot express "11:59 PM in the teacher timezone".';
