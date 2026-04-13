-- Local bills database: eliminates runtime LegiScan/Congress.gov API calls.
-- Populated by daily sync cron from Congress.gov (federal), Open States (state),
-- and LegiScan (text gap-fill only).

CREATE TABLE IF NOT EXISTS bills (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Cross-reference IDs (at least one will be set)
  legiscan_bill_id    int UNIQUE,
  openstates_id       text UNIQUE,
  congress_bill_id    text UNIQUE,         -- e.g. "119-s-4242"

  -- Core metadata (matches the shape scoring logic expects)
  jurisdiction        text NOT NULL,        -- "US" or state code ("CA", "TX")
  session             text,                 -- "119" or "2025-2026"
  bill_type           text NOT NULL,        -- "hr", "s", "sb", "ab", "hb"
  bill_number         int NOT NULL,
  title               text NOT NULL,
  description         text,

  -- Status fields
  status              text,                 -- raw status from source
  status_stage        text,                 -- normalized: "introduced", "in_committee", "passed_one", "passed_both", "enacted", "vetoed"
  latest_action       text,
  latest_action_date  date,
  origin_chamber      text,                 -- "House" or "Senate"
  url                 text,

  -- Full content for Claude personalization
  full_text           text,
  crs_summary         text,                 -- CRS summary (federal only)
  text_word_count     int DEFAULT 0,
  text_version        text,                 -- "Introduced", "Enrolled", etc.

  -- Classification
  topics              text[] DEFAULT '{}',  -- App interest keys: ["education", "technology"]
  subjects            text[] DEFAULT '{}',  -- Raw subject tags from source API
  sponsors            text[] DEFAULT '{}',  -- Sponsor names (for state relevance scoring)

  -- Sync metadata
  source              text NOT NULL,        -- "congress_gov", "openstates", "legiscan"
  change_hash         text,                 -- For detecting updates without re-fetching
  synced_at           timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),

  -- Uniqueness constraint (no duplicate bills)
  UNIQUE(jurisdiction, session, bill_type, bill_number)
);

-- Performance indexes for the queries we'll run at runtime
CREATE INDEX IF NOT EXISTS idx_bills_jurisdiction
  ON bills(jurisdiction);

CREATE INDEX IF NOT EXISTS idx_bills_topics
  ON bills USING GIN(topics);

CREATE INDEX IF NOT EXISTS idx_bills_updated
  ON bills(updated_at DESC);

-- The main runtime query: bills for a jurisdiction with certain topics, sorted by recency
CREATE INDEX IF NOT EXISTS idx_bills_jurisdiction_updated
  ON bills(jurisdiction, updated_at DESC);

-- For sync: find bills missing text
CREATE INDEX IF NOT EXISTS idx_bills_missing_text
  ON bills(source, synced_at) WHERE full_text IS NULL;

-- Row Level Security: public read, service-role only write
ALTER TABLE bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read access" ON bills FOR SELECT USING (true);

-- For sync: find bills by source ID
CREATE INDEX IF NOT EXISTS idx_bills_legiscan_id
  ON bills(legiscan_bill_id) WHERE legiscan_bill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bills_openstates_id
  ON bills(openstates_id) WHERE openstates_id IS NOT NULL;
