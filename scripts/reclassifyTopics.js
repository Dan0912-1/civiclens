/**
 * One-shot: re-run topic classification on every bill that has full_text.
 *
 * Needed because Congress.gov's bill LIST endpoint doesn't return subject tags,
 * so bills synced from that endpoint arrived with empty topics. Now that we
 * have full_text for them, we can classify from the text itself, which is a
 * much stronger signal than the title alone.
 *
 * Safe to re-run any time. Idempotent: sets topics based on current full_text.
 */

import { createClient } from '@supabase/supabase-js'
import { classifyTopics } from '../api/billSync.js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

;(async () => {
  const startedAt = Date.now()
  // Pull bills with text in pages of 500
  let processed = 0
  let changed = 0
  let newlyClassified = 0
  const PAGE = 500
  let offset = 0

  while (true) {
    const { data, error } = await sb
      .from('bills')
      .select('id, title, full_text, subjects, topics')
      .not('full_text', 'is', null)
      .order('id')
      .range(offset, offset + PAGE - 1)
    if (error) { console.error('query error:', error.message); break }
    if (!data?.length) break

    for (const row of data) {
      const before = (row.topics || []).slice().sort()
      const after = classifyTopics(row.subjects || [], row.title, row.full_text).sort()
      processed++
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        if (!before.length) newlyClassified++
        changed++
        const { error: upErr } = await sb.from('bills').update({ topics: after }).eq('id', row.id)
        if (upErr) console.error('update error:', row.id, upErr.message)
      }
    }

    if (data.length < PAGE) break
    offset += PAGE
    if (processed % 1000 === 0) {
      console.log(`[reclassify] ${processed} processed, ${changed} changed (${newlyClassified} newly classified)`)
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`\n[reclassify] DONE in ${elapsed}s: ${processed} processed, ${changed} changed, ${newlyClassified} newly classified`)
  process.exit(0)
})().catch(err => { console.error('fatal:', err); process.exit(1) })
