-- ─────────────────────────────────────────────────────────────────────────────
-- GovDecoded — Notification Columns Migration
-- Run this in Supabase SQL Editor AFTER create_auth_tables.sql
--
-- Adds columns needed for bill-update email notifications:
--   bookmarks.last_known_action   — tracks the most recent latestAction text
--   user_profiles.email_notifications — opt-in/out for email alerts (default: true)
-- ─────────────────────────────────────────────────────────────────────────────

-- Track last known Congress.gov action per bookmarked bill
alter table bookmarks
  add column if not exists last_known_action text;

-- User preference for receiving email notifications
alter table user_profiles
  add column if not exists email_notifications boolean not null default true;
