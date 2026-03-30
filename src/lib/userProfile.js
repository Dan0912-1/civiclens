import { supabase } from './supabase'

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
  if (!supabase) return
  try {
    await supabase
      .from('bookmarks')
      .upsert({ user_id: userId, bill_id: billId, bill_data: billData }, { onConflict: 'user_id,bill_id' })
  } catch {
    // non-fatal
  }
}

export async function removeBookmark(userId, billId) {
  if (!supabase) return
  try {
    await supabase
      .from('bookmarks')
      .delete()
      .eq('user_id', userId)
      .eq('bill_id', billId)
  } catch {
    // non-fatal
  }
}

export async function getNotificationPrefs(token) {
  try {
    const resp = await fetch(`${getApiBase()}/api/notifications/preferences`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) return { email_notifications: true }
    return resp.json()
  } catch {
    return { email_notifications: true }
  }
}

export async function setNotificationPrefs(token, emailNotifications) {
  try {
    await fetch(`${getApiBase()}/api/notifications/preferences`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email_notifications: emailNotifications }),
    })
  } catch {
    // non-fatal
  }
}

function getApiBase() {
  return import.meta.env.VITE_API_BASE_URL || 'https://civiclens-production-07ed.up.railway.app'
}
