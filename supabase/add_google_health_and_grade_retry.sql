-- Google Classroom: connection health + grade-passback retry bookkeeping.
--
-- Two gaps this closes:
--
-- 1. CONNECTION HEALTH. A teacher who revokes CapitolKey at
--    myaccount.google.com leaves a stored refresh token that Google will
--    reject with invalid_grant. Nothing recorded that, so /api/google/status
--    kept reporting "Connected" and the teacher only found out when an assign
--    or a grade sync failed. We now stamp the last failure/success on the token
--    row and surface `needsReconnect` in the status endpoint.
--
-- 2. GRADE RETRY. Passback is best-effort at completion time: a student who
--    finishes before the teacher publishes the draft (or before Google has
--    created their submission) got "your grade will sync shortly" and then
--    nothing ever synced unless the teacher clicked "Sync grades" by hand.
--    A nightly sweep now retries pending completions; these columns cap the
--    retries so a permanently unmatchable student isn't retried forever.
--
-- Safe to re-run: all adds are IF NOT EXISTS.

-- ─── Connection health ───────────────────────────────────────────────────────
alter table google_oauth_tokens add column if not exists last_error      text;
alter table google_oauth_tokens add column if not exists last_error_at   timestamptz;
alter table google_oauth_tokens add column if not exists last_success_at timestamptz;

-- ─── Grade-passback retry bookkeeping ────────────────────────────────────────
alter table assignment_completions add column if not exists google_grade_attempts int not null default 0;
alter table assignment_completions add column if not exists google_grade_error    text;
alter table assignment_completions add column if not exists google_grade_error_at timestamptz;

-- The nightly sweep looks for completions that are still ungraded on a
-- Google-linked assignment. Partial index keeps that scan cheap as the
-- completions table grows (the vast majority of rows are already graded or
-- belong to non-Google assignments).
create index if not exists idx_ac_google_pending
  on assignment_completions(assignment_id)
  where google_grade_sent_at is null;
