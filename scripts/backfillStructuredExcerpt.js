/**
 * One-shot: compute structured_excerpt for every bill that has full_text.
 *
 * extractStructuredExcerpt() is a regex pass over bill text, so this is
 * fast (no network calls). Safe to re-run any time.
 */

import { createClient } from '@supabase/supabase-js'
import { extractStructuredExcerpt } from '../api/billExcerpt.js'

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)

;(async () => {
  const startedAt = Date.now()
  const PAGE = 250
  let processed = 0
  let populated = 0
  let nullExcerpt = 0

  // Use a "sentinel" that we advance to mark bills we've tried but got null
  // excerpt for, so re-queries with .is(null) don't keep returning them.
  const SENTINEL = '__no_structured_excerpt__'

  while (true) {
    // Always fetch from the top — the set shrinks as we populate.
    const { data, error } = await sb
      .from('bills')
      .select('id, full_text')
      .not('full_text', 'is', null)
      .is('structured_excerpt', null)
      .order('id')
      .limit(PAGE)
    if (error) { console.error('query error:', error.message); break }
    if (!data?.length) break

    for (const row of data) {
      const excerpt = extractStructuredExcerpt(row.full_text)
      processed++
      if (excerpt) {
        const { error: upErr } = await sb.from('bills').update({ structured_excerpt: excerpt }).eq('id', row.id)
        if (upErr) console.error('update error:', row.id, upErr.message)
        else populated++
      } else {
        // Write the sentinel so next query doesn't fetch this row again
        await sb.from('bills').update({ structured_excerpt: SENTINEL }).eq('id', row.id)
        nullExcerpt++
      }
    }

    console.log(`[backfill] ${processed} processed, ${populated} populated, ${nullExcerpt} no-excerpt`)
  }

  // Flip sentinels back to null so they don't show up in content
  const { count: flipped } = await sb.from('bills').update({ structured_excerpt: null }, { count: 'exact' }).eq('structured_excerpt', SENTINEL)
  console.log(`[backfill] cleared ${flipped || 0} sentinels back to null`)

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(`\n[backfill] DONE in ${elapsed}s: ${processed} processed, ${populated} excerpts written, ${nullExcerpt} bills had no extractable structure`)
  process.exit(0)
})().catch(err => { console.error('fatal:', err); process.exit(1) })
