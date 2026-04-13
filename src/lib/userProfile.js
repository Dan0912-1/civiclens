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
    return data || []
  } catch {
    return []
  }
}

export async function addBookmark(userId, billId, billData) {
  if (!supabase) return false
  try {
    const { error } = await supabase
      .from('bookmarks')
      .upsert({ user_id: userId, bill_id: billId, bill_data: billData }, { onConflict: 'user_id,bill_id' })
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
