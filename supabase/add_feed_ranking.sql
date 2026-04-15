-- Feed ranking: columns for the curated "hot" pool of bills that feed
-- personalization chooses from. A daily job scores every bill and flips
-- feed_eligible on the top ~15K, so the feed query only touches high-quality
-- bills with cached full_text.

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS feed_eligible        boolean    DEFAULT false,
  ADD COLUMN IF NOT EXISTS feed_priority_score  int        DEFAULT 0,
  ADD COLUMN IF NOT EXISTS feed_ranked_at       timestamptz,
  -- Classroom pinning: bills a teacher has assigned stay in the feed pool
  -- regardless of score, so the 30 students in their class all get cached
  -- personalization. NULL = not pinned; non-null = number of classrooms
  -- that have assigned this bill (so removing one assignment doesn't un-pin
  -- if another class still has it assigned).
  ADD COLUMN IF NOT EXISTS pinned_classroom_count int      DEFAULT 0,
  -- Tracks when we last re-pulled text for amendment-aware refresh.
  -- The daily refresh job skips bills refreshed within 24h.
  ADD COLUMN IF NOT EXISTS text_refreshed_at    timestamptz;

-- The hot-path query: feed selection by jurisdiction + topic + eligibility,
-- sorted by priority score. This replaces the old updated_at-based sort.
CREATE INDEX IF NOT EXISTS idx_bills_feed_eligible_score
  ON bills(jurisdiction, feed_priority_score DESC)
  WHERE feed_eligible = true;

-- Pinned bills — never evicted regardless of score
CREATE INDEX IF NOT EXISTS idx_bills_pinned
  ON bills(pinned_classroom_count)
  WHERE pinned_classroom_count > 0;
