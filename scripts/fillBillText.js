/**
 * One-shot bill text backfill.
 *
 * Usage:
 *   node scripts/fillBillText.js [--federal-only | --state-only]
 *
 * Env required: SUPABASE_URL, SUPABASE_SERVICE_KEY, CONGRESS_API_KEY, OPENSTATES_API_KEY
 *
 * Fills full_text for every bill missing it, prioritizing the cheapest source:
 *   1. Federal via Congress.gov (unlimited) — runs until done
 *   2. State via URL synthesizer (zero quota for 42 states) + Open States
 *      hybrid fallback (~500-3000/day quota for bills synth can't hit).
 *
 * State pass picks up ALL missing-text state bills regardless of source —
 * including LegiScan-only rows with no openstates_id, which the daily cron's
 * backfillStateTexts can't see. Runs 5 workers in parallel since fetchBillText
 * is stateless per-bill and synth-state scraping has no quota limit.
 *
 * Safe to re-run — it always picks up bills still missing text.
 */

import { createClient } from '@supabase/supabase-js'
import { fetchBillText } from '../api/billSync.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const CONGRESS_KEY = process.env.CONGRESS_API_KEY
const OPENSTATES_KEY = process.env.OPENSTATES_API_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY')
  process.exit(1)
}

const mode = process.argv[2] || '--all'
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ─── Federal (Congress.gov — unlimited) ──────────────────────────────────────
async function fillFederalText() {
  if (!CONGRESS_KEY) {
    console.log('[federal] Skipping — no CONGRESS_API_KEY')
    return
  }

  const BASE = 'https://api.congress.gov/v3'
  const headers = { 'X-Api-Key': CONGRESS_KEY }
  let filled = 0
  let attempted = 0
  let batchNum = 0

  while (true) {
    batchNum++
    const { data: batch, error } = await supabase
      .from('bills')
      .select('id, congress_bill_id, bill_type, bill_number, session')
      .eq('jurisdiction', 'US')
      .is('full_text', null)
      .order('updated_at', { ascending: false })
      .limit(200)

    if (error) { console.error('[federal] query error', error.message); break }
    if (!batch?.length) break

    console.log(`[federal] batch ${batchNum}: ${batch.length} bills`)

    for (const bill of batch) {
      attempted++
      try {
        const textUrl = `${BASE}/bill/${bill.session}/${bill.bill_type}/${bill.bill_number}/text?format=json`
        const resp = await fetch(textUrl, { headers })
        if (!resp.ok) {
          // Mark as attempted so we don't loop forever on a 404
          await supabase.from('bills').update({ synced_at: new Date().toISOString() }).eq('id', bill.id)
          await sleep(500)
          continue
        }
        const data = await resp.json()
        const versions = data.textVersions || []
        const latest = versions[0]

        let fullText = null
        let wordCount = 0
        let version = 'Unknown'

        if (latest) {
          const fmt = latest.formats?.find((f) => f.type === 'Formatted Text') || latest.formats?.[0]
          if (fmt?.url) {
            const txtResp = await fetch(fmt.url, { headers })
            if (txtResp.ok) {
              fullText = (await txtResp.text())
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
              wordCount = fullText.split(/\s+/).length
              version = latest.type || 'Unknown'
            }
            await sleep(500)
          }
        }

        await supabase
          .from('bills')
          .update({
            full_text: fullText,
            text_word_count: wordCount || null,
            text_version: fullText ? version : null,
            synced_at: new Date().toISOString(),
          })
          .eq('id', bill.id)

        if (fullText) filled++
        if (attempted % 25 === 0) {
          console.log(`[federal] ${attempted} attempted, ${filled} filled so far`)
        }
        await sleep(500) // 2 req/sec (well under Congress.gov's 80/min)
      } catch (err) {
        console.error(`[federal] ${bill.congress_bill_id}:`, err.message)
      }
    }

    // If we got back fewer than requested, we're done
    if (batch.length < 200) break
  }

  console.log(`[federal] Done: ${filled}/${attempted} bills filled with text`)
  return { attempted, filled }
}

// ─── State (synth + Open States hybrid) ──────────────────────────────────────
// Picks up every missing-text state bill regardless of source — LegiScan-only
// rows with no openstates_id are still fillable via URL synthesizer for the
// 42 synth-covered states. Runs 5 workers in parallel; fetchBillText is
// stateless per-bill and synth-state scraping has no quota limit.
//
// Cooldown: skips bills that have failed >= 5 times within the last 14 days
// (consistent with backfillStateTexts' shelving logic).
async function fillStateText() {
  const CONCURRENCY = 5
  const PER_WORKER_DELAY_MS = 750
  const COOLDOWN_STRIKES = 5
  const COOLDOWN_CUTOFF = new Date(Date.now() - 14 * 86400000).toISOString()

  // Paginate — Supabase caps .limit() at ~1000 rows silently.
  console.log('[state] Fetching candidate list...')
  const PAGE = 1000
  const candidates = []
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await supabase
      .from('bills')
      .select('id, openstates_id, jurisdiction, bill_type, bill_number, session, source, legiscan_bill_id, text_fetch_attempts, text_fetch_last_at')
      .neq('jurisdiction', 'US')
      .is('full_text', null)
      .range(from, from + PAGE - 1)
    if (error) { console.error('[state] query error:', error.message); return }
    if (!page?.length) break
    candidates.push(...page)
    if (page.length < PAGE) break
  }

  const eligible = candidates.filter((b) => {
    const attempts = b.text_fetch_attempts || 0
    if (attempts < COOLDOWN_STRIKES) return true
    return !b.text_fetch_last_at || b.text_fetch_last_at < COOLDOWN_CUTOFF
  })

  const shelved = candidates.length - eligible.length
  console.log(`[state] ${candidates.length} candidates, ${eligible.length} eligible (${shelved} in cooldown)`)
  if (!eligible.length) return { attempted: 0, filled: 0 }

  // Shuffle so workers don't all pile on one state (TX alone is ~11k of the gap)
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[eligible[i], eligible[j]] = [eligible[j], eligible[i]]
  }

  const startedAt = Date.now()
  let attempted = 0
  let filled = 0

  async function worker(id) {
    while (true) {
      const bill = eligible.pop()
      if (!bill) return
      attempted++
      try {
        const text = await fetchBillText(supabase, bill)
        if (text) filled++
      } catch (err) {
        console.error(`[state w${id}] ${bill.jurisdiction} ${bill.bill_type}${bill.bill_number}:`, err.message)
      }
      if (attempted % 100 === 0) {
        const elapsedMin = (Date.now() - startedAt) / 60000
        const rate = attempted / ((Date.now() - startedAt) / 1000)
        const etaMin = (eligible.length / (attempted / elapsedMin)).toFixed(1)
        const pct = (((candidates.length - shelved - eligible.length) / (candidates.length - shelved)) * 100).toFixed(1)
        console.log(`[state] ${attempted} attempted, ${filled} filled — ${rate.toFixed(1)}/s — ${elapsedMin.toFixed(1)}m elapsed, ~${etaMin}m remaining (${pct}%)`)
      }
      await sleep(PER_WORKER_DELAY_MS)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)))

  const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1)
  console.log(`[state] Done in ${elapsedMin}m: ${filled}/${attempted} bills filled`)
  return { attempted, filled }
}

// ─── Main ────────────────────────────────────────────────────────────────────
;(async () => {
  const startedAt = Date.now()
  console.log(`[fill] Starting at ${new Date().toISOString()}, mode=${mode}`)

  const { count: before } = await supabase
    .from('bills')
    .select('id', { count: 'exact', head: true })
    .not('full_text', 'is', null)
  console.log(`[fill] Bills with text before: ${before}`)

  if (mode !== '--state-only') await fillFederalText()
  if (mode !== '--federal-only') await fillStateText()

  const { count: after } = await supabase
    .from('bills')
    .select('id', { count: 'exact', head: true })
    .not('full_text', 'is', null)

  const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1)
  console.log(`[fill] Done in ${elapsed} min. Bills with text: ${before} → ${after} (+${after - before})`)
  process.exit(0)
})().catch((err) => {
  console.error('[fill] Fatal:', err)
  process.exit(1)
})
