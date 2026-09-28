-- ONE-OFF DATA FIX. Not a migration. Run manually after review.
--
-- Until this PR, fetchBillText scored a strike whenever Open States REST
-- returned 429 while GraphQL did not. 429 is our daily quota, not a broken
-- bill, but after 5 strikes backfillStateTexts shelves a bill for 14 days.
-- On 2026-09-28 11,712 textless bills (21 states, NH excluded) are shelved
-- with text_fetch_last_error = 'rest 429'.
--
-- Why 4 and not 0: every one of these rows has 9-12 attempts, and we only
-- know the LAST error was a 429. Earlier strikes may have been real. Setting
-- attempts to 4 (COOLDOWN_STRIKES - 1) gives each bill one fresh try on the
-- next run. A real failure re-shelves it, so we don't spend a week of REST
-- quota (~500/day) re-trying 11.7k bills five times each.
--
-- The error text is rewritten so the WHERE clause stops matching: re-running
-- this file is a no-op.
--
-- NH is excluded on purpose. Do not touch NH.

-- 1. Preview (read-only)
select jurisdiction, count(*) as rows_to_reset
from bills
where full_text is null
  and text_fetch_last_error = 'rest 429'
  and text_fetch_attempts >= 5
  and jurisdiction <> 'NH'
group by jurisdiction
order by rows_to_reset desc;

-- 2. Reset
update bills
set text_fetch_attempts = 4,
    text_fetch_last_error = 'rest 429 (strike reset 2026-09-28)'
where full_text is null
  and text_fetch_last_error = 'rest 429'
  and text_fetch_attempts >= 5
  and jurisdiction <> 'NH';
