-- Dumb, ruthless TTL on personalization_cache. No smart state-match logic —
-- just a wall clock. If a bill is still relevant 30 days later, the next
-- student who requests it re-generates from fresh LLM. Bounds the table so
-- index lookups stay cheap as the corpus grows.
--
-- Rationale: peer review round 6 flagged that stage-transition invalidation
-- leaves orphan rows (v8 legacy keys, stale buckets, deleted interests)
-- that grow unbounded. A nightly cron running the DELETE below is cheaper
-- and more robust than a state-reconciliation job that can stall on a bad
-- JOIN.

ALTER TABLE personalization_cache
  ADD COLUMN IF NOT EXISTS expires_at timestamptz
    DEFAULT (NOW() + INTERVAL '30 days');

-- Backfill existing rows so the first cleanup pass doesn't nuke them all
UPDATE personalization_cache
  SET expires_at = created_at + INTERVAL '30 days'
  WHERE expires_at IS NULL AND created_at IS NOT NULL;

UPDATE personalization_cache
  SET expires_at = NOW() + INTERVAL '30 days'
  WHERE expires_at IS NULL;

-- Index on expires_at so the nightly DELETE is an index scan, not a seq scan
CREATE INDEX IF NOT EXISTS personalization_cache_expires_at_idx
  ON personalization_cache (expires_at);

-- Run this as a daily cron (Supabase → Database → Cron, or external):
--   DELETE FROM personalization_cache WHERE expires_at < NOW();
-- Expected rate: roughly 1/30th of the table per day at steady state.
