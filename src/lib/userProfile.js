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
    // from saved_status_stage. Cheap single query, no JOIN needed since we
    // already have the bill_id set.
    const billIds = bookmarks.map(b => b.bill_id).filter(Boolean)
    if (billIds.length) {
      const { data: currentStates } = await supabase
        .from('bills')
        .select('id, status_stage')
        .in('id', billIds)
      const stageMap = new Map((currentStates || []).map(b => [b.id, b.status_stage]))
      for (const bm of bookmarks) {
        bm.current_status_stage = stageMap.get(bm.bill_id) || null
        bm.is_stale = !!(
          bm.saved_status_stage
          && bm.current_status_stage
          && bm.saved_status_stage !== bm.current_status_stage
        )
      }
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
    // Network failure — queue for retry when back online
    enqueue('supabase:bookmarks', 'POST', { user_id: userId, bill_id: billId, bill_data: billData })
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
