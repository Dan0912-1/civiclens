-- ONE-OFF DATA FIX. Not a migration. Run manually after review, BEFORE
-- running scripts/reclassifyTopics.js for DC.
--
-- The April DC backfill (dc_backfill.mjs, LIMS API, text_version='dc_lims')
-- rebuilt every lookup as "B{council}-{NNNN}" regardless of bill_type. So a
-- proposed resolution (pr) or ceremonial resolution (cer) numbered N got the
-- text of BILL N. On 2026-09-28: 621 pr/cer rows have text, 496 of them
-- byte-identical to the b row with the same number, and the rest are also
-- "A BILL ..." documents. None of it belongs to the resolution.
--
-- These rows are harmless today only because DC has no topics (0 feed
-- eligible). Once topics are backfilled, ~534 of them would pass the ranker
-- and students would see a confirmation resolution summarized from an
-- unrelated bill. Null the text so they can't.
--
-- No personalization_cache rows exist for any DC bill (checked 2026-09-28).

-- 1. Preview (read-only)
select bill_type, count(*) as rows_to_clear
from bills
where jurisdiction = 'DC'
  and bill_type in ('pr', 'cer')
  and text_version = 'dc_lims'
  and full_text is not null
group by bill_type;

-- 2. Clear
update bills
set full_text = null,
    text_word_count = 0,
    text_version = null,
    structured_excerpt = null,
    section_topic_scores = null,
    feed_eligible = false
where jurisdiction = 'DC'
  and bill_type in ('pr', 'cer')
  and text_version = 'dc_lims'
  and full_text is not null;
