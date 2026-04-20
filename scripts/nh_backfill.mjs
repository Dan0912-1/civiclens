// NH bill-text backfill via session-year + ID enumeration.
//
// NH's billText.aspx takes (sy, id) where sy is a 4-digit session year and
// id is session-scoped. A single NH biennium covers two session years
// (2025 + 2026), so we iterate both. IDs within a session are small —
// usually under 2,000 — so an upper bound of 3,000 covers everything.
//
// URL shape: /bill_status/legacy/bs2016/billText.aspx?sy=YYYY&id=N&txtFormat=html
// Capital T in billText and F in txtFormat — IIS is case-insensitive but
// mirror the canonical casing so future maintainers match existing logs.
//
// Usage: node nh_backfill.mjs [max_id_per_session]

import { createClient } from '@supabase/supabase-js'

const MAX_ID = parseInt(process.argv[2], 10) || 3000
const SESSION_YEARS = [2025, 2026]
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY)
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const CONCURRENCY = 6
const SLEEP_MS = 150

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// Build a lookup of all missing NH bills. An entry's value is an array of
// candidate rows (same type+number across different sessions) so we can
// write to all of them when a match is found — NH often keeps the same
// bill number across biennia with different content, but our textless rows
// all belong to the currently-active biennium anyway.
console.log(`[NH] loading textless bills from DB...`)
let pending = []
for (let off = 0; ; off += 1000) {
  const { data } = await sb.from('bills')
    .select('id,bill_type,bill_number,session')
    .eq('jurisdiction', 'NH')
    .is('full_text', null)
    .order('id', { ascending: true })
    .range(off, off + 999)
  if (!data?.length) break
  pending = pending.concat(data)
  if (data.length < 1000) break
}
const want = new Map()
for (const b of pending) {
  const key = `${(b.bill_type||'').toLowerCase()}${b.bill_number}`
  if (!want.has(key)) want.set(key, [])
  want.get(key).push(b)
}
console.log(`[NH] ${pending.length} textless bills to resolve`)
console.log(`[NH] scanning sy=${SESSION_YEARS.join(',')} × id=1..${MAX_ID}`)

async function fetchId(sy, id) {
  // The legacy/bs2016 subpath is the canonical billText endpoint — the
  // WebSearch-indexed URLs all use this path, and the root /bill_status/
  // path returns a generic search landing page with no bill content.
  const url = `https://www.gencourt.state.nh.us/bill_status/legacy/bs2016/billText.aspx?sy=${sy}&id=${id}&txtFormat=html`
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })
    if (!resp.ok) return null
    const html = await resp.text()
    if (html.length < 2000) return null
    return html
  } catch { return null }
}

function parseBill(html) {
  // Find the bill header. Format varies: "HB 112-FN" or "HB 54" or "SB 180".
  // Match the FIRST chamber-label occurrence, strip -FN/-LOCAL/-A suffixes
  // down to the bare number (our DB stores bare numbers).
  const m = html.match(/\b(HB|SB|HR|SR|HCR|SCR|HJR|SJR|CACR)\s*(\d+)/)
  if (!m) return null
  return `${m[1].toLowerCase()}${m[2]}`
}

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#[0-9]+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const startedAt = Date.now()
let tested = 0, matched = 0, saved = 0

async function worker(pairs) {
  for (const [sy, id] of pairs) {
    tested++
    const html = await fetchId(sy, id)
    if (html) {
      const key = parseBill(html)
      if (key && want.has(key)) {
        const candidates = want.get(key)
        const text = extractText(html)
        if (text.length >= 200) {
          matched++
          const words = text.split(/\s+/).length
          for (const bill of candidates) {
            const { error } = await sb.from('bills').update({
              full_text: text,
              text_word_count: words,
              text_version: `nh_sy${sy}_id${id}`,
              synced_at: new Date().toISOString(),
            }).eq('id', bill.id)
            if (!error) saved++
          }
          want.delete(key)
        }
      }
    }
    if (tested % 100 === 0) {
      const elapsed = (Date.now() - startedAt) / 1000
      console.log(`[NH] sy=${sy} id=${id} · tested=${tested} matched=${matched} saved=${saved} (${elapsed.toFixed(0)}s · ${want.size} remaining)`)
    }
    await sleep(SLEEP_MS)
  }
}

// Interleave session years so progress is visible on both — if 2025 IDs
// are denser than 2026, we still see 2026 hits early rather than waiting
// through the whole 2025 range first.
const pairs = []
for (let id = 1; id <= MAX_ID; id++) {
  for (const sy of SESSION_YEARS) pairs.push([sy, id])
}
const chunks = Array.from({ length: CONCURRENCY }, (_, i) => pairs.filter((_, j) => j % CONCURRENCY === i))
await Promise.all(chunks.map(worker))

const elapsed = ((Date.now() - startedAt) / 1000 / 60).toFixed(1)
console.log(`\n[NH] FINAL: ${saved} texted / ${matched} matched / ${tested} ids tested in ${elapsed}m. ${want.size} bills unresolved.`)
process.exit(0)
