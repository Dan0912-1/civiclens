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
 *   2. State via Open States + legislature HTML scrape (quota: 1,000/day)
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

// ─── State (Open States + HTML scrape — 1,000/day quota) ─────────────────────
async function fillStateText(maxBills = 900) {
  if (!OPENSTATES_KEY) {
    console.log('[state] Skipping — no OPENSTATES_API_KEY')
    return
  }

  const { data: bills, error } = await supabase
    .from('bills')
    .select('id, openstates_id, jurisdiction, bill_type, bill_number, session, source, full_text')
    .eq('source', 'openstates')
    .is('full_text', null)
    .not('openstates_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(maxBills)

  if (error) { console.error('[state] query error', error.message); return }
  if (!bills?.length) { console.log('[state] No bills need text'); return }

  console.log(`[state] Fetching text for ${bills.length} bills (budget ~900/day)`)
  let filled = 0
  let attempted = 0

  for (const bill of bills) {
    attempted++
    try {
      const text = await fetchBillText(supabase, bill)
      if (text) filled++
      if (attempted % 25 === 0) {
        console.log(`[state] ${attempted}/${bills.length} attempted, ${filled} filled so far`)
      }
      await sleep(1600) // ~38/min (under 40/min limit)
    } catch (err) {
      console.error(`[state] ${bill.jurisdiction} ${bill.bill_type}${bill.bill_number}:`, err.message)
    }
  }

  console.log(`[state] Done: ${filled}/${attempted} bills filled with text`)
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
