// Shared LegiScan HTTP gate: one serial queue + one usage counter for every
// LegiScan call this process makes (server.js runtime/prewarm and billSync's
// daily catalog alike).
//
// Why: from 2026-10-01 the LegiScan Public API allows 10,000 queries/month and
// a sliding-window rate of ~2 requests/second, and keys that break the terms
// (CC BY 4.0 attribution, one key per user) are permanently banned from
// 2026-11-01. Before this module, the weekday prewarm fired six searches in
// parallel and the catalog sync paced itself separately, so bursts could
// exceed 2 req/s.
//
// ONE KEY ONLY. Every call goes out under LEGISCAN_API_KEY. Do not register or
// configure a second key for prewarm, backfills or scripts: LegiScan's one-key
// rule treats that as quota evasion and bans every key involved.

// Minimum gap between the START of two consecutive LegiScan requests. 600ms
// keeps us at ≤1.67 req/s, under the ~2 req/s window with headroom.
export const LEGISCAN_MIN_INTERVAL_MS = 600

// Monthly allowance from 2026-10-01. Used only to compute alert fractions.
export const LEGISCAN_MONTHLY_LIMIT = 10000

let _chain = Promise.resolve()
let _lastStart = 0
let _lifetime = 0

// Counts are in-memory and per process: they reset on restart/redeploy.
// `countingSince` says how much of the month they cover, so nobody mistakes a
// post-restart count for the whole month.
const PROCESS_STARTED_AT = new Date()
const _usage = {
  month: monthKey(PROCESS_STARTED_AT),
  countingSince: PROCESS_STARTED_AT.toISOString(),
  total: 0,
  byOp: {},
  errors: 0,
  http429: 0,
}

function monthKey(d) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function rollMonth(now) {
  const key = monthKey(now)
  if (key === _usage.month) return
  _usage.month = key
  _usage.countingSince = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  _usage.total = 0
  _usage.byOp = {}
  _usage.errors = 0
  _usage.http429 = 0
}

function opFromUrl(url) {
  try { return new URL(url).searchParams.get('op') || 'unknown' } catch { return 'unknown' }
}

// Reserve the next start slot. Slots are handed out strictly in call order,
// LEGISCAN_MIN_INTERVAL_MS apart. Only the START is serialized: a slow
// response (getMasterList for a big state can take 10s+) must not make a
// student's bill-detail request wait behind it, and the rate limit is on
// request starts. Callers that must be strictly one-at-a-time (prewarm)
// additionally await each call before issuing the next.
function reserveSlot() {
  const slot = _chain.then(async () => {
    const wait = _lastStart + LEGISCAN_MIN_INTERVAL_MS - Date.now()
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    _lastStart = Date.now()
  })
  _chain = slot.catch(() => {})
  return slot
}

/**
 * fetch() for api.legiscan.com, gated by the process-wide start queue
 * (≥ LEGISCAN_MIN_INTERVAL_MS between request starts) and counted toward the
 * monthly usage. Same signature and return value as fetch; callers keep their
 * own error handling.
 */
export async function legiscanFetch(url, options = {}) {
  await reserveSlot()
  rollMonth(new Date())
  const op = opFromUrl(url)
  _lifetime++
  _usage.total++
  _usage.byOp[op] = (_usage.byOp[op] || 0) + 1
  try {
    const resp = await fetch(url, options)
    if (resp.status === 429) _usage.http429++
    if (!resp.ok) _usage.errors++
    return resp
  } catch (err) {
    _usage.errors++
    throw err
  }
}

/**
 * Total LegiScan requests issued by this process since it started (monotonic,
 * unaffected by month rollover). Jobs diff this before/after a run.
 */
export function legiscanCallCount() {
  return _lifetime
}

/**
 * Month-to-date usage as counted by THIS process. `complete` is true only
 * when the process has been up since the start of the month; otherwise the
 * count is a real lower bound, not the month's total.
 */
export function legiscanMonthlyUsage() {
  rollMonth(new Date())
  const monthStart = Date.UTC(
    Number(_usage.month.slice(0, 4)), Number(_usage.month.slice(5, 7)) - 1, 1
  )
  const complete = PROCESS_STARTED_AT.getTime() <= monthStart
  const fraction = _usage.total / LEGISCAN_MONTHLY_LIMIT
  return {
    month: _usage.month,
    countingSince: _usage.countingSince,
    complete,
    count: _usage.total,
    byOp: { ..._usage.byOp },
    errors: _usage.errors,
    http429: _usage.http429,
    limit: LEGISCAN_MONTHLY_LIMIT,
    fractionOfLimit: Number(fraction.toFixed(4)),
    alert60: fraction >= 0.6,
    alert85: fraction >= 0.85,
  }
}
