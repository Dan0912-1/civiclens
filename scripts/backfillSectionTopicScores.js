/**
 * One-shot: compute section_topic_scores for every bill that has full_text.
 *
 * computeSectionTopicScores() is a pure regex pass over bill text — no
 * network calls — so this is fast. Safe to re-run any time; it only writes
 * rows where the computed value differs from NULL. After the initial run,
 * the sync pipeline keeps it populated automatically for new bills.
 *
 * Usage:
 *   set -a && source .env && set +a
 *   node scripts/backfillSectionTopicScores.js
 */

import { createClient } from '@supabase/supabase-js'
import { computeSectionTopicScores } from '../api/billExcerpt.js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

;(async () => {
  const startedAt = Date.now()
  const PAGE = 250
  let processed = 0
  let populated = 0
  let nullScores = 0

  // Sentinel so we can re-query with .is(null) without revisiting bills
  // we've already tried and computed null for. Flipped back to NULL at the end.
  const SENTINEL = { v: 0, count: 0, scores: [] }

  while (true) {
    const { data, error } = await sb
      .from('bills')
      .select('id, full_text')
      .not('full_text', 'is', null)
      .is('section_topic_scores', null)
      .order('id')
      .limit(PAGE)
    if (error) {
      console.error('query error:', error.message)
      break
    }
    if (!data?.length) break

    for (const row of data) {
      const scores = computeSectionTopicScores(row.full_text)
      processed++
      if (scores) {
        const { error: upErr } = await sb
          .from('bills')
          .update({ section_topic_scores: scores })
          .eq('id', row.id)
        if (upErr) console.error('update error:', row.id, upErr.message)
        else populated++
      } else {
        // Write sentinel so next query doesn't fetch this row again
        await sb
          .from('bills')
          .update({ section_topic_scores: SENTINEL })
          .eq('id', row.id)
        nullScores++
      }
    }

    console.log(`[backfill:topic-scores] ${processed} processed, ${populated} populated, ${nullScores} no-sections`)
  }

  // Flip sentinels back to null so they don't interfere with request-time
  // "precomputed valid" checks (the v:0 count:0 shape would always mismatch
  // the actual split, forcing live fallback anyway — but cleaner to NULL them).
  const { count: flipped, error: delErr } = await sb
    .from('bills')
    .update({ section_topic_scores: null }, { count: 'exact' })
    .eq('section_topic_scores', SENTINEL)
  if (delErr) console.error('sentinel flip error:', delErr.message)
  console.log(`[backfill:topic-scores] cleared ${flipped || 0} sentinels back to null`)

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(
    `\n[backfill:topic-scores] DONE in ${elapsed}s: ${processed} processed, ${populated} scores written, ${nullScores} bills had no section structure`
  )
  process.exit(0)
})().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
