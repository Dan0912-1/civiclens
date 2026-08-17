import { supabase } from './supabase'
import { getApiBase } from './api'
import { enqueue } from './offlineQueue'
import { normalizeStage, stagesEqual } from './billStage'

// Hard cap how long we'll wait for Supabase reads. supabase-js internally
// calls auth.getSession() to attach the JWT, and that call goes through a
// navigator.locks-based mutex that can wedge indefinitely when a prior
// session was orphaned (hot-reload, Safari tab-freeze, a sibling tab still
// holding the lock). A wedged read here shows up to the user as a blank
// /results page because Results stays in the skeleton state while profile
// is null.
//
// See src/lib/supabase.js (getSessionSafe, withAuthTimeout) for the rest of
// the pattern. We apply the same pattern to storage reads so a wedged lock
// can never hang the UI past this budget.
const PROFILE_READ_TIMEOUT_MS = 4000

function withTimeout(promise, ms, fallback = null) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(fallback), ms)),
  ])
}

// Returned when we could not determine whether a profile row exists — a
// timeout, a network blip, an RLS error. It is NOT the same as "this user has
// no profile", and any code that WRITES based on the answer has to tell them
// apart. Conflating the two is how a complete profile got overwritten with a
// bare {name, email} seed on sign-in: a slow read looked exactly like a brand
// new account.
export const PROFILE_READ_FAILED = Symbol('profile-read-failed')

/**
 * Read the stored profile. Returns the profile object, `null` when the user
 * genuinely has no row yet, or PROFILE_READ_FAILED when we couldn't find out.
 */
export async function readProfileRow(userId) {
  if (!supabase) return PROFILE_READ_FAILED
  try {
    // maybeSingle, not single: "no row" is a normal answer here and shouldn't
    // arrive as an error we'd have to pattern-match on.
    const query = supabase
      .from('user_profiles')
      .select('profile')
      .eq('id', userId)
      .maybeSingle()
    const result = await withTimeout(query, PROFILE_READ_TIMEOUT_MS, { __timeout: true })
    if (result?.__timeout) {
      console.warn('[profile] Supabase read timed out')
      return PROFILE_READ_FAILED
    }
    const { data, error } = result
    if (error) {
      console.warn('[profile] Supabase read failed:', error.message)
      return PROFILE_READ_FAILED
    }
    if (!data) return null
    return data.profile ?? null
  } catch {
    return PROFILE_READ_FAILED
  }
}

// Profile-or-null view of readProfileRow, for readers that only want the data
// and have nothing destructive to decide.
export async function loadProfile(userId) {
  const row = await readProfileRow(userId)
  return row === PROFILE_READ_FAILED ? null : row
}

/** Returns true when the write actually landed. */
export async function saveProfile(userId, profile) {
  if (!supabase) return false
  try {
    const { error } = await supabase
      .from('user_profiles')
      .upsert({ id: userId, profile, updated_at: new Date().toISOString() }, { onConflict: 'id' })
    if (error) {
      console.warn('[profile] save failed:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.warn('[profile] save threw:', err?.message)
    return false
  }
}

/**
 * Create the row only if the user doesn't have one. Insert-only on purpose: a
 * seed carries just name+email, so if a real profile is already there this has
 * to be a no-op. The database decides via the primary key rather than the
 * client deciding from a read it may have gotten wrong.
 */
export async function seedProfileIfAbsent(userId, profile) {
  if (!supabase) return false
  try {
    const { error } = await supabase
      .from('user_profiles')
      .insert({ id: userId, profile, updated_at: new Date().toISOString() })
    // 23505 = unique_violation: the row already existed, which is a success
    // for our purposes — somebody else's profile is intact.
    if (error && error.code !== '23505') {
      console.warn('[profile] seed failed:', error.message)
      return false
    }
    return true
  } catch {
    return false
  }
}

// ─── Profile resolution ───
//
// The saved profile lives in two places: sessionStorage for fast synchronous
// reads, and Supabase as the durable copy. sessionStorage is PER-TAB, so a
// signed-in student who arrives in a fresh tab — deep link, push notification,
// shared URL, cold PWA launch — has an empty cache while their real profile
// sits in Supabase. Any code that reads the cache alone and treats a miss as
// "no profile" ends up asking people to rebuild what they already have, which
// is exactly what the bill page did before #115.
//
// Read through these helpers rather than touching sessionStorage directly.

export const PROFILE_CACHE_KEY = 'civicProfile'

export function readCachedProfile() {
  try {
    return JSON.parse(sessionStorage.getItem(PROFILE_CACHE_KEY) || 'null')
  } catch {
    // sessionStorage unavailable (private mode / SSR)
    return null
  }
}

export function cacheProfile(profile) {
  try {
    sessionStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(profile))
  } catch { /* non-fatal — we just lose the fast path */ }
}

// Profiles created before the age-field migration stored the answer under
// `grade`. Read both so existing students are not forced through onboarding
// again, while all new writes carry the accurately named `age` field.
export function getProfileAge(profile) {
  const value = profile?.age ?? profile?.grade
  return value == null ? '' : String(value)
}

export function normalizeProfileAge(profile) {
  if (!profile) return profile
  const age = getProfileAge(profile)
  return { ...profile, age, grade: age }
}

// All three questionnaire answers, which is what POST /api/personalize
// requires. The Google sign-in seed carries only name+email, and a half-filled
// manual profile may have a state but no interests — neither can personalize.
export function isPersonalizable(p) {
  return Boolean(p?.state && getProfileAge(p) && p?.interests?.length)
}

function isNonEmpty(p) {
  return Boolean(p && Object.keys(p).length > 0)
}

/**
 * Resolve the user's profile: cached copy first, Supabase second, seeding the
 * cache on a cloud hit.
 *
 * `isSufficient` lets each caller state what it actually needs — RepsPanel
 * only wants a state, personalization wants the full questionnaire — so a thin
 * cached profile still falls through to the richer cloud copy.
 *
 * Returns null for anonymous users, so callers must wait for AuthContext's
 * `loading` to settle before reading a null as "this person has no profile".
 */
export async function resolveProfile(user, isSufficient = isNonEmpty) {
  const cached = readCachedProfile()
  if (isSufficient(cached)) return normalizeProfileAge(cached)
  if (!user) return null
  const cloud = await loadProfile(user.id)
  if (!isSufficient(cloud)) return null
  const normalized = normalizeProfileAge(cloud)
  cacheProfile(normalized)
  return normalized
}

export async function getBookmarks(userId) {
  if (!supabase) return []
  try {
    const { data, error } = await supabase
      .from('bookmarks')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
    if (error) return []
    const bookmarks = data || []
    if (!bookmarks.length) return bookmarks

    // Staleness detection — pull current status_stage for each bookmarked bill
    // and stamp it onto the row so the UI can render a banner when it drifts
    // from saved_status_stage.
    //
    // bookmarks.bill_id is a SYNTHETIC id (`ls-<legiscan_id>` for state bills
    // and LegiScan-backed federal bills, `<type><num>-<congress>` for
    // Congress.gov-backed federal bills). bills.id is a UUID. Previously we
    // queried bills.in('id', billIds) which never matched, so is_stale was
    // always false. We now resolve by the cross-reference columns the sync
    // job maintains: legiscan_bill_id (int) and congress_bill_id (text like
    // "119-hr-123").
    const legiscanIds = []
    const congressIds = []
    for (const b of bookmarks) {
      const id = String(b.bill_id || '')
      if (id.startsWith('ls-')) {
        const n = Number(id.slice(3))
        if (Number.isFinite(n)) legiscanIds.push(n)
      } else {
        // Lowercase form: `hr123-119`. Convert to bills.congress_bill_id
        // canonical form: `119-hr-123`.
        const m = id.match(/^([a-z]+)(\d+)-(\d+)$/i)
        if (m) congressIds.push(`${m[3]}-${m[1].toLowerCase()}-${m[2]}`)
      }
    }

    const stageByLegiscan = new Map()
    const stageByCongress = new Map()
    if (legiscanIds.length) {
      const { data } = await supabase
        .from('bills')
        .select('legiscan_bill_id, status_stage')
        .in('legiscan_bill_id', legiscanIds)
      for (const row of (data || [])) stageByLegiscan.set(row.legiscan_bill_id, row.status_stage)
    }
    if (congressIds.length) {
      const { data } = await supabase
        .from('bills')
        .select('congress_bill_id, status_stage')
        .in('congress_bill_id', congressIds)
      for (const row of (data || [])) stageByCongress.set(row.congress_bill_id, row.status_stage)
    }

    for (const bm of bookmarks) {
      const id = String(bm.bill_id || '')
      let current = null
      if (id.startsWith('ls-')) {
        current = stageByLegiscan.get(Number(id.slice(3))) || null
      } else {
        const m = id.match(/^([a-z]+)(\d+)-(\d+)$/i)
        if (m) current = stageByCongress.get(`${m[3]}-${m[1].toLowerCase()}-${m[2]}`) || null
      }
      bm.current_status_stage = current
      // Compare via the canonical vocabulary — legacy bookmarks may have
      // saved a number (1..5) while bills.status_stage is always a string,
      // so raw !== comparison was firing false-positive staleness banners.
      bm.is_stale = !!(
        bm.saved_status_stage
        && bm.current_status_stage
        && !stagesEqual(bm.saved_status_stage, bm.current_status_stage)
      )
    }
    return bookmarks
  } catch {
    return []
  }
}

export async function addBookmark(userId, billId, billData) {
  if (!supabase) return false
  try {
    // Snapshot the bill's status_stage at bookmark time so Bookmarks.jsx can
    // detect drift and render a "status changed since you saved this" banner
    // instead of silently overwriting the student's cached analysis. See
    // supabase/add_bookmark_saved_status_stage.sql for rationale.
    const savedStatusStage = normalizeStage(
      billData?.bill?.statusStage
      ?? billData?.bill?.status_stage
      ?? billData?.statusStage
    )
    const row = { user_id: userId, bill_id: billId, bill_data: billData, saved_status_stage: savedStatusStage }
    const { error } = await supabase
      .from('bookmarks')
      .upsert(row, { onConflict: 'user_id,bill_id' })
    if (error) {
      // Log the actual Supabase error so a silent "Could not save" toast can
      // be diagnosed instead of failing invisibly. Most common causes:
      // missing unique(user_id, bill_id) constraint, RLS policy rejection,
      // or a stale auth session.
      console.error('[bookmarks] upsert error:', error.code, error.message, error.details)
    }
    return !error
  } catch (err) {
    console.error('[bookmarks] network error, queueing:', err?.message)
    // Network failure — queue for retry when back online.
    // Pass the computed savedStatusStage through so the replay path can
    // stamp it too; otherwise offline-created bookmarks would lose the
    // staleness baseline and never be flagged as drifted.
    const savedStatusStage = normalizeStage(
      billData?.bill?.statusStage
      ?? billData?.bill?.status_stage
      ?? billData?.statusStage
    )
    enqueue('supabase:bookmarks', 'POST', {
      user_id: userId,
      bill_id: billId,
      bill_data: billData,
      saved_status_stage: savedStatusStage,
    })
    return false
  }
}

export async function removeBookmark(userId, billId) {
  if (!supabase) return false
  try {
    const { error } = await supabase
      .from('bookmarks')
      .delete()
      .eq('user_id', userId)
      .eq('bill_id', billId)
    if (error) {
      console.error('[bookmarks] delete error:', error.code, error.message, error.details)
    }
    return !error
  } catch (err) {
    console.error('[bookmarks] delete network error, queueing:', err?.message)
    // Network failure — queue for retry when back online
    enqueue('supabase:bookmarks', 'DELETE', { user_id: userId, bill_id: billId })
    return false
  }
}

export async function getNotificationPrefs(token) {
  try {
    const resp = await fetch(`${getApiBase()}/api/notifications/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) return { email_notifications: false, push_notifications: true }
    return resp.json()
  } catch {
    return { email_notifications: false, push_notifications: true }
  }
}

export async function setNotificationPrefs(token, prefs) {
  try {
    await fetch(`${getApiBase()}/api/notifications/preferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(prefs),
    })
  } catch {
    // non-fatal
  }
}
