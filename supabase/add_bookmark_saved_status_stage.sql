-- Bookmark staleness — store the bill's status_stage at the moment the
-- student bookmarked it so the UI can detect drift without hitting the
-- LLM or overwriting the user's cached analysis. Peer review round 6
-- rationale: silently refreshing the bookmark destroys the student's
-- "why I saved this" context, but leaving outdated present-tense copy in
-- the bookmarks tab is a pedagogy risk ("This bill would create..."
-- when the bill was actually vetoed last week).
--
-- Frontend comparison pattern:
--   if (bookmark.saved_status_stage !== bill.status_stage) {
--     showBanner(`Status changed from ${bookmark.saved_status_stage} to ${bill.status_stage}`)
--   }
-- Plus a "Regenerate analysis" CTA that spends a fresh LLM call on demand.

ALTER TABLE bookmarks
  ADD COLUMN IF NOT EXISTS saved_status_stage text;

-- Backfill from the snapshot stored in bill_data when available
UPDATE bookmarks
  SET saved_status_stage = bill_data->'bill'->>'statusStage'
  WHERE saved_status_stage IS NULL
    AND bill_data IS NOT NULL;
