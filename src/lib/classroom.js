import { getApiBase } from './api'
import { enqueue } from './offlineQueue'

const API = getApiBase()
const DEFAULT_TIMEOUT_MS = 15000

async function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

// Fetch with a hard timeout so a hung socket on flaky classroom wifi doesn't
// leave the UI spinning forever.
async function apiFetch(url, opts = {}) {
  const timeoutMs = opts.timeoutMs || DEFAULT_TIMEOUT_MS
  return fetch(url, {
    ...opts,
    signal: AbortSignal.timeout(timeoutMs),
  })
}

// Typed error so callers can distinguish auth failure (redirect to sign-in)
// from generic 5xx / network problems.
export class AuthError extends Error {
  constructor(msg) { super(msg); this.name = 'AuthError'; this.isAuthError = true }
}

async function readError(resp, fallback) {
  const err = await resp.json().catch(() => ({}))
  if (resp.status === 401 || resp.status === 403) {
    throw new AuthError(err.error || 'Please sign in again')
  }
  throw new Error(err.error || fallback)
}

export async function getMyClassrooms(token) {
  try {
    const resp = await apiFetch(`${API}/api/classroom`, { headers: await authHeaders(token) })
    if (!resp.ok) return []
    const data = await resp.json()
    return data.classrooms || []
  } catch { return [] }
}

export async function createClassroom(token, name, requireName = false) {
  const resp = await apiFetch(`${API}/api/classroom`, {
    method: 'POST',
    headers: await authHeaders(token),
    body: JSON.stringify({ name, requireName }),
  })
  if (!resp.ok) await readError(resp, 'Failed to create classroom')
  const data = await resp.json()
  return data.classroom
}

export async function joinClassroom(token, code) {
  const url = `${API}/api/classroom/join`
  const body = JSON.stringify({ code })
  try {
    const resp = await apiFetch(url, {
      method: 'POST',
      headers: await authHeaders(token),
      body,
    })
    if (!resp.ok) {
      // Server replied — do NOT enqueue. Client errors like invalid/dup codes
      // would retry endlessly; let the caller surface the real reason.
      await readError(resp, 'Failed to join classroom')
    }
    const data = await resp.json()
    return data.classroom
  } catch (err) {
    if (err.isAuthError) throw err
    // AbortError / TypeError = network failure. Queue for replay so the join
    // isn't silently lost when classroom wifi drops mid-request.
    if (err.name === 'AbortError' || err.name === 'TypeError') {
      enqueue(url, 'POST', body)
      throw new Error('You appear offline. Your join request will retry when you reconnect.')
    }
    throw err
  }
}

export async function getClassroomDetail(token, id) {
  try {
    const resp = await apiFetch(`${API}/api/classroom/${id}`, { headers: await authHeaders(token) })
    if (!resp.ok) {
      if (resp.status === 401 || resp.status === 403) {
        throw new AuthError('Please sign in again')
      }
      return null
    }
    const data = await resp.json()
    return data.classroom
  } catch (err) {
    if (err.isAuthError) throw err
    throw new Error('Could not load classroom. Check your connection.')
  }
}

export async function updateClassroom(token, id, updates) {
  const resp = await apiFetch(`${API}/api/classroom/${id}`, {
    method: 'PUT',
    headers: await authHeaders(token),
    body: JSON.stringify(updates),
  })
  if (!resp.ok) await readError(resp, 'Failed to update classroom')
  return (await resp.json()).classroom
}

export async function deleteClassroom(token, id) {
  const resp = await apiFetch(`${API}/api/classroom/${id}`, {
    method: 'DELETE',
    headers: await authHeaders(token),
  })
  if (!resp.ok) await readError(resp, 'Failed to delete classroom')
}

export async function regenerateCode(token, id) {
  const resp = await apiFetch(`${API}/api/classroom/${id}/regenerate-code`, {
    method: 'POST',
    headers: await authHeaders(token),
  })
  if (!resp.ok) await readError(resp, 'Failed to regenerate code')
  return (await resp.json()).join_code
}

export async function leaveClassroom(token, id) {
  const resp = await apiFetch(`${API}/api/classroom/${id}/leave`, {
    method: 'DELETE',
    headers: await authHeaders(token),
  })
  if (!resp.ok) await readError(resp, 'Failed to leave classroom')
}

export async function getMembers(token, id) {
  try {
    const resp = await apiFetch(`${API}/api/classroom/${id}/members`, { headers: await authHeaders(token) })
    if (!resp.ok) return []
    return (await resp.json()).members || []
  } catch { return [] }
}

// Throws on network / 5xx so the caller can show "couldn't load" instead of
// "no assignments yet" for a silent fetch failure. Only the 200 empty case
// returns [].
export async function getAssignments(token, id) {
  const resp = await apiFetch(`${API}/api/classroom/${id}/assignments`, { headers: await authHeaders(token) })
  if (!resp.ok) await readError(resp, 'Could not load assignments')
  return (await resp.json()).assignments || []
}

export async function createAssignment(token, classroomId, { billId, billData, instructions, dueDate }) {
  const resp = await apiFetch(`${API}/api/classroom/${classroomId}/assignments`, {
    method: 'POST',
    headers: await authHeaders(token),
    body: JSON.stringify({ billId, billData, instructions, dueDate }),
  })
  if (!resp.ok) await readError(resp, 'Failed to assign bill')
  return (await resp.json()).assignment
}

export async function removeAssignment(token, classroomId, assignmentId) {
  const resp = await apiFetch(`${API}/api/classroom/${classroomId}/assignments/${assignmentId}`, {
    method: 'DELETE',
    headers: await authHeaders(token),
  })
  if (!resp.ok) await readError(resp, 'Failed to remove assignment')
}

export async function markComplete(token, classroomId, assignmentId, timeSpentSec) {
  const url = `${API}/api/classroom/${classroomId}/assignments/${assignmentId}/complete`
  const body = JSON.stringify({ timeSpentSec })
  try {
    const resp = await apiFetch(url, {
      method: 'POST',
      headers: await authHeaders(token),
      body,
    })
    if (!resp.ok) await readError(resp, 'Could not mark as read')
  } catch (err) {
    if (err.isAuthError) throw err
    if (err.name === 'AbortError' || err.name === 'TypeError') {
      // Queue so the student's completion isn't silently dropped on a flaky
      // school network.
      enqueue(url, 'POST', body)
      throw new Error('You appear offline. Your completion will retry when you reconnect.')
    }
    throw err
  }
}

export async function getCompletions(token, id) {
  const resp = await apiFetch(`${API}/api/classroom/${id}/completions`, { headers: await authHeaders(token) })
  if (!resp.ok) return null
  return resp.json()
}

export async function getClassroomStats(token, id, signal) {
  const opts = { headers: await authHeaders(token) }
  if (signal) opts.signal = signal
  const resp = await fetch(`${API}/api/classroom/${id}/stats`, opts)
  if (!resp.ok) return null
  return resp.json()
}

export async function exportClassroomCsv(token, id) {
  const resp = await apiFetch(`${API}/api/classroom/${id}/export`, { headers: await authHeaders(token) })
  if (!resp.ok) throw new Error('Failed to export')
  return resp.blob()
}

function normalizeCode(code) {
  return (code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

// Public (no auth) — peek at classroom by code
export async function peekClassroom(code, signal) {
  const normalized = normalizeCode(code)
  const opts = signal ? { signal } : {}
  const resp = await fetch(`${API}/api/classroom/peek/${encodeURIComponent(normalized)}`, opts)
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'Invalid code')
  }
  return resp.json()
}

// Session storage helpers for anonymous classroom access
const JOINED_KEY = 'ck_joined_classrooms'

export function getJoinedClassrooms() {
  try {
    return JSON.parse(sessionStorage.getItem(JOINED_KEY) || '[]')
  } catch { return [] }
}

export function addJoinedClassroom(code, name, classroomId, studentName) {
  const joined = getJoinedClassrooms().filter(c => c.code !== code)
  const entry = { code, name, classroomId, joinedAt: new Date().toISOString() }
  if (studentName) entry.studentName = studentName
  joined.push(entry)
  sessionStorage.setItem(JOINED_KEY, JSON.stringify(joined))
}

export function removeJoinedClassroom(code) {
  const joined = getJoinedClassrooms().filter(c => c.code !== code)
  sessionStorage.setItem(JOINED_KEY, JSON.stringify(joined))
}
