-- Pre-compute topic-scores for every bill section at sync time. At 200
-- requests per minute, the live regex pass in getRelevantSections() was
-- running ~2,500 synchronous regex executions per request on the Node
-- event loop (25 topics × 100 sections) — a real blocker flagged in
-- peer review round 3. Moving the work to sync-time turns request-time
-- retrieval into an O(sections × studentTopics) JSON lookup + sum.
--
-- Shape (populated by billExcerpt.computeSectionTopicScores()):
--   {
--     "v": 1,                       -- schema version, for future migrations
--     "count": 12,                  -- number of sections the text split into
--     "scores": [
--       { "idx": 0, "wc": 45,  "hits": { "education": 3 } },
--       { "idx": 1, "wc": 220, "hits": { "environment": 2, "technology": 1 } },
--       ...
--     ]
--   }
--
-- Null for bills where the text is too short or lacks section structure.
-- Request-time falls back to live regex when:
--   (a) the column is null (bill hasn't been backfilled yet), or
--   (b) the section count doesn't match (text was edited after precompute).

ALTER TABLE bills
  ADD COLUMN IF NOT EXISTS section_topic_scores jsonb;

-- GIN index for future filters like "bills with >0 environment hits in any
-- section" — not used at request time by the app today but cheap to add now.
CREATE INDEX IF NOT EXISTS bills_section_topic_scores_gin_idx
  ON bills USING gin (section_topic_scores);
