-- Run this in Supabase SQL Editor (https://supabase.com/dashboard → SQL Editor)
-- Adds change_hash column to bookmarks table for efficient bill update detection.
-- Used by the daily checkBillUpdates cron to skip unchanged bills via LegiScan's
-- change_hash instead of re-fetching every bookmarked bill.

alter table bookmarks add column if not exists change_hash text;
