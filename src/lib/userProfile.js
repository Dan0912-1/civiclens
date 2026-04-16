import { supabase } from './supabase'
import { getApiBase } from './api'
import { enqueue } from './offlineQueue'

export async function loadProfile(userId) {
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('profile')
      .eq('id', userId)
      .single()
    if (error || !data) return null
    return data.profile
  } catch {
    return null
  }
}

export async function saveProfile(userId, profile) {
  if (!supabase) return
  try {
    await supabase
      .from('user_profiles')
      .upsert({ id: userId, profile, updated_at: new Date().toISOString() }, { onConflict: 'id' })
  } catch {
    // non-fatal
  }
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
      bm.is_stale = !!(
        bm.saved_status_stage
        && bm.current_status_stage
        && bm.saved_status_stage !== bm.current_status_stage
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
    const savedStatusStage =
      billData?.bill?.statusStage
      || billData?.bill?.status_stage
      || billData?.statusStage
      || null
    const row = { user_id: userId, bill_id: billId, bill_data: billData, saved_status_stage: savedStatusStage }
    const { error } = await supabase
      .from('bookmarks')
      .upsert(row, { onConflict: 'user_id,bill_id' })
    return !error
  } catch {
    // Network failure — queue for retry when back online.
    // Pass the computed savedStatusStage through so the replay path can
    // stamp it too; otherwise offline-created bookmarks would lose the
    // staleness baseline and never be flagged as drifted.
    const savedStatusStage =
      billData?.bill?.statusStage
      || billData?.bill?.status_stage
      || billData?.statusStage
      || null
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
    return !error
  } catch {
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
