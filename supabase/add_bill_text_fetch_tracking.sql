-- Text-fetch attempt tracking.
--
-- Before this change, backfillStateTexts retried the same ~600 textless bills
-- every day regardless of whether prior attempts had failed — burning Open
-- States quota on bills whose version URLs were permanently dead (scanned
-- PDFs, 404s, withdrawn drafts). After N strikes we shelf the bill for a
-- cooldown window and come back later.
--
-- text_fetch_attempts   — running count of failed attempts (reset on success)
-- text_fetch_last_at    — timestamp of last attempt (success OR failure)
-- text_fetch_last_error — short error string from the last failed attempt
ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS text_fetch_attempts   int         DEFAULT 0,
  ADD COLUMN IF NOT EXISTS text_fetch_last_at    timestamptz,
  ADD COLUMN IF NOT EXISTS text_fetch_last_error text;

-- Hot-path index for the backfill query: surfaces textless Open States bills
-- that aren't currently in cooldown. Partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_bills_text_backfill_candidates
  ON bills(text_fetch_attempts, text_fetch_last_at, updated_at DESC)
  WHERE full_text IS NULL AND source = 'openstates';
