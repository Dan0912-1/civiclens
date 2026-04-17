/**
 * Bill Feed Ranker
 *
 * Computes a priority score for every bill in the database and flips
 * `feed_eligible = true` on a curated ~15K "hot pool" that the feed uses for
 * personalization. Goals:
 *
 *   1. Every feed-eligible bill has full_text → personalization never falls
 *      back to LegiScan for feed views.
 *   2. Every (state × topic) cell has enough bills → a student in Montana
 *      interested in immigration still gets real material.
 *   3. Bills are substantive (not post-office naming) and recent.
 *   4. Classroom-pinned bills are always eligible regardless of score.
 *
 * Run this daily from the sync cron, after text backfill is done.
 */

// ─── Hard filter ─────────────────────────────────────────────────────────────
// Bills that fail these are never eligible regardless of score.

const CEREMONIAL_TITLE_PATTERNS = [
  /^to designate /i,
  /^to name /i,
  /^to rename /i,
  /^honoring /i,
  /^recognizing /i,
  /^commemorating /i,
  /^celebrating /i,
  /^congratulating /i,
  /^expressing (?:the sense|gratitude|sympathy|condolences|thanks|appreciation)/i,
  /^a resolution honoring /i,
  /^a resolution recognizing /i,
  /^a resolution commemorating /i,
  /^a resolution expressing /i,
  /^resolution of sympathy/i,
  /^in memoriam/i,
  /^in memory of /i,
  /^mourning (?:the death|the passing)/i,
  /post office/i,
  /^naming /i,
  /^renaming /i,
  /national .* (?:day|week|month) (?:of|for|awareness)/i,
  /designating .* (?:highway|bridge|building|post office|federal building)/i,
  /^a concurrent resolution honoring/i,
  /^a concurrent resolution recognizing/i,
  /^a concurrent resolution commemorating/i,
]

function passesHardFilter(bill) {
  if (!bill.full_text) return false
  if ((bill.text_word_count || 0) < 150) return false
  if (!bill.topics || !bill.topics.length) return false

  const title = bill.title || ''
  if (CEREMONIAL_TITLE_PATTERNS.some((p) => p.test(title))) return false

  return true
}

// ─── Score components ────────────────────────────────────────────────────────

// Stage: how far through the legislative process (out of 25).
// Actionable in-progress bills rank highest — students can still influence them
// by contacting reps. Enacted bills are kept eligible for civic-education value
// but ranked below passed_one so the feed doesn't flood with already-signed laws
// (especially right after an appropriations bundle signing).
const STAGE_SCORES = {
  passed_both: 22,
  passed_one: 18,
  in_committee: 12,
  enacted: 10,
  vetoed: 10,
  introduced: 6,
}

function scoreStage(bill) {
  return STAGE_SCORES[bill.status_stage] ?? 6
}

// Recency: days since last legislative action (out of 25)
// Enacted bills never drop below 8 points regardless of age — a landmark law
// from last year is still civically important for a high schooler learning how
// their government works. Without this floor, a newly introduced doomed-to-fail
// bill (score 6 + 25 = 31) outranks an actually-passed law from 400 days ago
// (score 25 + 0 = 25), which is exactly backwards for civic education.
function scoreRecency(bill) {
  const actionDate = bill.latest_action_date || bill.updated_at
  const isEnacted = bill.status_stage === 'enacted'
  if (!actionDate) return isEnacted ? 8 : 0
  const days = (Date.now() - new Date(actionDate).getTime()) / 86400000
  if (days <= 30) return 25
  if (days <= 90) return 18
  if (days <= 180) return 10
  if (days <= 365) return 4
  return isEnacted ? 8 : 0
}

// Text depth: longer bills have more substantive content (out of 15)
function scoreTextDepth(bill) {
  const wc = bill.text_word_count || 0
  if (wc >= 2000) return 15
  if (wc >= 500) return 10
  if (wc >= 150) return 5
  return 0
}

// Topic count: multi-topic bills appeal to more students (out of 10)
function scoreTopicCount(bill) {
  const n = bill.topics?.length || 0
  if (n >= 3) return 10
  if (n === 2) return 8
  if (n === 1) return 5
  return 0
}

// Bill type: substantive legislation scores higher than resolutions (out of 10)
// Federal "hr" = House BILL (substantive). State "hr" = House RESOLUTION.
// Distinguish by jurisdiction.
function scoreBillType(bill) {
  const bt = (bill.bill_type || '').toLowerCase()
  const isFederal = bill.jurisdiction === 'US'

  if (isFederal) {
    if (bt === 'hr' || bt === 's') return 10 // Primary legislation
    if (bt === 'hjres' || bt === 'sjres') return 6 // Joint res (can be substantive)
    return 3 // hres/sres/hconres/sconres — usually ceremonial
  }

  // State jurisdictions vary in naming, but these patterns are consistent:
  // "b" suffix = bill, "r" suffix = resolution, "m" = memorial
  if (['hb', 'sb', 'h', 'a', 'ab', 'as'].includes(bt)) return 10
  if (['hjr', 'sjr', 'hjres', 'sjres'].includes(bt)) return 6
  return 3
}

// Interaction boost: bills with real student engagement (out of 10)
// Computed from bill_interactions counts in the database.
function scoreInteractions(viewCount) {
  if (!viewCount) return 0
  if (viewCount >= 20) return 10
  if (viewCount >= 10) return 7
  if (viewCount >= 5) return 5
  if (viewCount >= 1) return 2
  return 0
}

// Total max: 25 + 25 + 15 + 10 + 10 + 10 = 95

function computeScore(bill, interactionCount = 0) {
  if (!passesHardFilter(bill)) return -1
  return (
    scoreStage(bill) +
    scoreRecency(bill) +
    scoreTextDepth(bill) +
    scoreTopicCount(bill) +
    scoreBillType(bill) +
    scoreInteractions(interactionCount)
  )
}

// ─── Daily tie-break jitter ──────────────────────────────────────────────────
// Hundreds of bills tie at the same integer score. Without a tie-breaker the
// same bills always win based on insertion order, so students see the exact
// same cohort day after day. A deterministic hash of (bill id + today's date)
// produces a stable-for-24h but rotating-daily fractional jitter in [0,1)
// that naturally rotates tied bills in and out of the hot pool across days.
// This also solves the "no discovery decay" concern without needing
// per-user view tracking.
function dailyJitter(billId, dateStr) {
  // Simple FNV-1a hash — fast, deterministic, no deps
  const s = `${billId}|${dateStr}`
  let h = 2166136261 >>> 0
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  // Normalize to [0, 1)
  return h / 4294967296
}

// ─── Stratified selection ────────────────────────────────────────────────────
// Goals:
//  - Federal quota: top 2,000 (shared across all students)
//  - Per state: top 250, with a min of 10 per topic where available
//  - Pinned bills: always selected
//  - Remaining slots filled by overall top-scoring bills

const APP_TOPICS = [
  'education', 'environment', 'economy', 'healthcare', 'technology',
  'housing', 'immigration', 'civil_rights', 'community',
]

const FEDERAL_QUOTA = 2000
const STATE_QUOTA = 250
const PER_TOPIC_MIN = 10
const TOTAL_TARGET = 15000

function selectTopBillsForState(bills, quota) {
  // Greedy per-topic fill, then top-score fill the remainder
  const selected = new Set()

  // Pass 1: fill per-topic minimum
  for (const topic of APP_TOPICS) {
    const topicBills = bills
      .filter((b) => b.topics?.includes(topic))
      .filter((b) => !selected.has(b.id))
      .sort((a, b) => b._effective - a._effective)
      .slice(0, PER_TOPIC_MIN)
    for (const b of topicBills) selected.add(b.id)
  }

  // Pass 2: fill remainder with top-scored bills not yet selected
  const remaining = quota - selected.size
  if (remaining > 0) {
    const fillers = bills
      .filter((b) => !selected.has(b.id))
      .sort((a, b) => b._effective - a._effective)
      .slice(0, remaining)
    for (const b of fillers) selected.add(b.id)
  }

  return selected
}

// ─── Main ranker entrypoint ──────────────────────────────────────────────────

async function runRanker(supabase, options = {}) {
  const { verbose = true } = options
  const startTime = Date.now()

  if (verbose) console.log('[ranker] ═══════════════════════════════════════')
  if (verbose) console.log('[ranker] Starting feed ranker at', new Date().toISOString())

  // Fetch all bills that could possibly be eligible (has text, has topics).
  // PostgREST caps single responses at 1000 rows, so paginate with ranges.
  // Skip full_text from the select (huge field; we only need word_count for scoring
  // and the hard filter)
  const PAGE = 1000
  let candidates = []
  let from = 0
  while (true) {
    const { data, error } = await supabase
      .from('bills')
      .select('id, jurisdiction, bill_type, bill_number, title, topics, status_stage, latest_action_date, updated_at, text_word_count, pinned_classroom_count')
      .not('full_text', 'is', null)
      .gte('text_word_count', 150)
      .order('id') // stable ordering for pagination
      .range(from, from + PAGE - 1)
    if (error) {
      console.error('[ranker] Query error:', error.message)
      return { error: error.message }
    }
    if (!data?.length) break
    candidates = candidates.concat(data)
    if (data.length < PAGE) break
    from += PAGE
  }
  // Post-query: treat full_text presence as true since we filtered on it
  for (const b of candidates) b.full_text = true

  if (verbose) console.log(`[ranker] Pulled ${candidates.length} candidates with text`)

  // Interaction counts — federal only (state bills get too few views to matter)
  const { data: interactions } = await supabase
    .from('bill_interactions')
    .select('bill_id')
    .eq('action_type', 'view')

  const viewCounts = new Map()
  for (const row of interactions || []) {
    viewCounts.set(row.bill_id, (viewCounts.get(row.bill_id) || 0) + 1)
  }
  if (verbose) console.log(`[ranker] ${viewCounts.size} bills have view history`)

  // Score every candidate. Add a daily tie-breaker jitter so bills at the same
  // integer score rotate in/out of the hot pool across days instead of being
  // arbitrarily locked in by insertion order. The jitter is deterministic for
  // the full 24h period so within a single run all ordering is stable.
  const todayIso = new Date().toISOString().slice(0, 10)
  const scored = []
  for (const bill of candidates) {
    const billId = makeBillIdKey(bill)
    const views = viewCounts.get(billId) || 0
    const score = computeScore(bill, views)
    if (score < 0) continue // failed hard filter
    scored.push({
      id: bill.id,
      jurisdiction: bill.jurisdiction,
      topics: bill.topics,
      pinned_classroom_count: bill.pinned_classroom_count || 0,
      _score: score,
      _jitter: dailyJitter(bill.id, todayIso),
      // Effective score used for ordering: integer score + fractional jitter.
      // Stored as a real number for sort comparisons; only the integer part
      // is persisted to feed_priority_score so the DB column stays an int.
      _effective: score + dailyJitter(bill.id, todayIso),
    })
  }

  if (verbose) console.log(`[ranker] ${scored.length} bills passed hard filter`)

  // ── Federal selection ──
  const federal = scored
    .filter((b) => b.jurisdiction === 'US')
    .sort((a, b) => b._effective - a._effective)

  const federalSelected = new Set(federal.slice(0, FEDERAL_QUOTA).map((b) => b.id))
  if (verbose) console.log(`[ranker] Federal: ${federalSelected.size} / ${federal.length} selected`)

  // ── State selection (per-state stratified with per-topic min) ──
  const stateByJurisdiction = new Map()
  for (const b of scored) {
    if (b.jurisdiction === 'US') continue
    if (!stateByJurisdiction.has(b.jurisdiction)) stateByJurisdiction.set(b.jurisdiction, [])
    stateByJurisdiction.get(b.jurisdiction).push(b)
  }

  const stateSelected = new Set()
  let stateCoverage = {}
  for (const [state, bills] of stateByJurisdiction.entries()) {
    const picked = selectTopBillsForState(bills, STATE_QUOTA)
    for (const id of picked) stateSelected.add(id)
    stateCoverage[state] = picked.size
  }
  if (verbose) {
    console.log(`[ranker] State: ${stateSelected.size} selected across ${stateByJurisdiction.size} states`)
    const underserved = Object.entries(stateCoverage).filter(([, c]) => c < 50).map(([s, c]) => `${s}(${c})`)
    if (underserved.length) console.log(`[ranker]   Underserved states: ${underserved.join(', ')}`)
  }

  // ── Pinned bills (classroom assignments) ──
  const pinnedIds = new Set(
    scored.filter((b) => (b.pinned_classroom_count || 0) > 0).map((b) => b.id)
  )
  if (verbose) console.log(`[ranker] Pinned: ${pinnedIds.size} bills protected from eviction`)

  // ── Union ──
  const finalEligible = new Set([...federalSelected, ...stateSelected, ...pinnedIds])

  // ── Overflow: if we're under 15K, pull in top-scoring leftovers ──
  if (finalEligible.size < TOTAL_TARGET) {
    const leftover = scored
      .filter((b) => !finalEligible.has(b.id))
      .sort((a, b) => b._effective - a._effective)
      .slice(0, TOTAL_TARGET - finalEligible.size)
    for (const b of leftover) finalEligible.add(b.id)
    if (verbose) console.log(`[ranker] Added ${leftover.length} overflow bills`)
  }

  if (verbose) console.log(`[ranker] FINAL selected: ${finalEligible.size}`)

  // ── Blue/green write: no outage window ──
  // Old approach (set all to false, then flip winners) had a 10-15s window
  // where feed_eligible was empty. Instead:
  //   1. Promote new winners with a fresh feed_ranked_at timestamp
  //   2. Only after all winners are written, demote anything eligible whose
  //      feed_ranked_at is older than the new timestamp
  // During the promote phase, old and new winners coexist — users see valid
  // results the whole time, and the old set is only cleared after the new set
  // is guaranteed in place.
  const scoreById = new Map(scored.map((b) => [b.id, b._score]))
  const newRankedAt = new Date().toISOString()
  const selectedIds = [...finalEligible]

  const BATCH = 500
  let written = 0
  const failedIds = []
  for (let i = 0; i < selectedIds.length; i += BATCH) {
    const batch = selectedIds.slice(i, i + BATCH)
    // Group by score so we can do one UPDATE per unique score value
    const scoreBuckets = new Map()
    for (const id of batch) {
      const s = scoreById.get(id) || 0
      if (!scoreBuckets.has(s)) scoreBuckets.set(s, [])
      scoreBuckets.get(s).push(id)
    }
    for (const [score, ids] of scoreBuckets.entries()) {
      try {
        const { error: upErr } = await supabase
          .from('bills')
          .update({
            feed_eligible: true,
            feed_priority_score: score,
            feed_ranked_at: newRankedAt,
          })
          .in('id', ids)
        if (upErr) {
          console.error(`[ranker] Promote error (score=${score}, ${ids.length} ids):`, upErr.message)
          failedIds.push(...ids)
        } else {
          written += ids.length
        }
      } catch (err) {
        // Network/proxy exceptions bubble up as thrown — catch so a transient
        // mid-run blip doesn't skip every remaining batch. Retry pass below.
        console.error(`[ranker] Promote exception (score=${score}, ${ids.length} ids):`, err.message)
        failedIds.push(...ids)
      }
    }
  }

  // One retry pass, smaller chunks. An earlier production run silently wrote
  // only 2,022 of 3,708 winners — state bills in later batches were lost —
  // and because errors were only console.logged the cron reported success.
  // A smaller chunk size also sidesteps any proxy URL-length edge case.
  if (failedIds.length) {
    console.error(`[ranker] ${failedIds.length} winners failed first pass, retrying in chunks of 100`)
    const RETRY = 100
    for (let i = 0; i < failedIds.length; i += RETRY) {
      const chunk = failedIds.slice(i, i + RETRY)
      const buckets = new Map()
      for (const id of chunk) {
        const s = scoreById.get(id) || 0
        if (!buckets.has(s)) buckets.set(s, [])
        buckets.get(s).push(id)
      }
      for (const [score, ids] of buckets.entries()) {
        try {
          const { error } = await supabase
            .from('bills')
            .update({ feed_eligible: true, feed_priority_score: score, feed_ranked_at: newRankedAt })
            .in('id', ids)
          if (!error) written += ids.length
          else console.error(`[ranker] Retry still failing (score=${score}, ${ids.length} ids):`, error.message)
        } catch (err) {
          console.error(`[ranker] Retry exception (score=${score}, ${ids.length} ids):`, err.message)
        }
      }
    }
  }

  if (written < selectedIds.length) {
    console.error(`[ranker] WARNING: promoted ${written}/${selectedIds.length} — demote pass skipped to preserve old winners`)
    // Skip demote when we didn't fully promote the new set. Otherwise we'd
    // strip feed_eligible from bills that WERE valid winners, just ones whose
    // re-promotion got lost to a transient error.
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
    return {
      candidates: candidates.length,
      scored: scored.length,
      federal: federalSelected.size,
      state: stateSelected.size,
      pinned: pinnedIds.size,
      total: finalEligible.size,
      promoted: written,
      promote_incomplete: true,
      elapsed_s: parseFloat(elapsed),
      stateCoverage,
    }
  }

  // Demote: anything currently eligible but not in the new winners set.
  // Identified by feed_ranked_at < newRankedAt (winners were just timestamped).
  const { error: demoteErr, count: demoted } = await supabase
    .from('bills')
    .update({ feed_eligible: false }, { count: 'exact' })
    .eq('feed_eligible', true)
    .lt('feed_ranked_at', newRankedAt)

  if (demoteErr) console.error('[ranker] Demote error:', demoteErr.message)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  if (verbose) {
    console.log(`[ranker] Promoted ${written} winners, demoted ${demoted || 0} previous in ${elapsed}s`)
    console.log('[ranker] ═══════════════════════════════════════')
  }

  return {
    candidates: candidates.length,
    scored: scored.length,
    federal: federalSelected.size,
    state: stateSelected.size,
    pinned: pinnedIds.size,
    total: finalEligible.size,
    elapsed_s: parseFloat(elapsed),
    stateCoverage,
  }
}

// Helper: map a bills.id (UUID) to the bill_id string used in bill_interactions
// The interactions table uses a synthetic key like "ls-12345" or "hr-123-119".
// We don't have a direct mapping, so this returns the UUID for now. A proper
// implementation would reconcile based on the legiscan_bill_id or
// congress_bill_id. For initial rollout, interaction boost is a nice-to-have.
function makeBillIdKey(bill) {
  return bill.id
}

export {
  runRanker,
  computeScore,
  passesHardFilter,
  CEREMONIAL_TITLE_PATTERNS,
  APP_TOPICS,
  FEDERAL_QUOTA,
  STATE_QUOTA,
  PER_TOPIC_MIN,
  TOTAL_TARGET,
}
