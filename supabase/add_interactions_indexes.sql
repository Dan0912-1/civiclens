-- Performance indexes for bill_interactions queries used by cron and feed scoring
-- The cron scans interactions by created_at range, and scoring queries filter by user_id + created_at

CREATE INDEX IF NOT EXISTS idx_bill_interactions_created_at
  ON bill_interactions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bill_interactions_user_created
  ON bill_interactions (user_id, created_at DESC);
