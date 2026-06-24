import { getApiBase } from './api'

const API = getApiBase()
const TIMEOUT_MS = 12000

async function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

// Whether the teacher has connected Google Classroom. Returns
// { connected, configured, email?, needsReconsent? }. Never throws — the
// dashboard treats any failure as "not connected".
export async function getGoogleStatus(token) {
  try {
    const resp = await fetch(`${API}/api/google/status`, {
      headers: await authHeaders(token),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!resp.ok) return { connected: false, configured: false }
    return await resp.json()
  } catch {
    return { connected: false, configured: false }
  }
}

// Returns the Google consent URL. The caller navigates there (web) or opens it
// in the in-app browser (native). platform/returnTo are bound into the signed
// state so the callback redirects back correctly.
export async function getGoogleConnectUrl(token, { platform = 'web', returnTo = '/classroom' } = {}) {
  const params = new URLSearchParams({ platform, returnTo })
  const resp = await fetch(`${API}/api/google/oauth/start?${params}`, {
    headers: await authHeaders(token),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'Could not start Google connect')
  }
  const data = await resp.json()
  return data.url
}

export async function disconnectGoogle(token) {
  const resp = await fetch(`${API}/api/google/disconnect`, {
    method: 'POST',
    headers: await authHeaders(token),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'Could not disconnect')
  }
  return true
}

// ─── Phase 2/3: assign + grade passback ──────────────────────────────────────

// The teacher's active Google courses (for the assign picker). Throws with
// err.code='not_connected' or 'reconnect' so the caller can prompt appropriately.
export async function listGoogleCourses(token) {
  const resp = await fetch(`${API}/api/google/courses`, {
    headers: await authHeaders(token),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) { const e = new Error(data.error || 'Failed to load courses'); e.code = data.code; throw e }
  return data.courses || []
}

// Push a bill into a Google course. payload: { courseId, courseName, billId,
// billData, instructions?, dueDate?, maxPoints?, publish, classroomId? }.
// Returns { assignment, alternateLink, classroomId, state, alreadyPushed? }.
export async function createGoogleCoursework(token, payload) {
  const resp = await fetch(`${API}/api/google/coursework`, {
    method: 'POST',
    headers: await authHeaders(token),
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) { const e = new Error(data.error || 'Failed to push to Google Classroom'); e.code = data.code; throw e }
  return data
}

// Student submits a Google-linked assignment for credit. Returns
// { completed, graded, gradeReason? }.
export async function completeGoogleAssignment(token, assignmentId, timeSpentSec) {
  const resp = await fetch(`${API}/api/google/coursework/${assignmentId}/complete`, {
    method: 'POST',
    headers: await authHeaders(token),
    body: JSON.stringify({ timeSpentSec }),
    signal: AbortSignal.timeout(20000),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.error || 'Could not submit for credit')
  return data
}

// Teacher re-pushes grades for everyone who completed. Returns
// { graded, skipped, failed, total }.
export async function syncGoogleGrades(token, assignmentId) {
  const resp = await fetch(`${API}/api/google/coursework/${assignmentId}/sync-grades`, {
    method: 'POST',
    headers: await authHeaders(token),
    signal: AbortSignal.timeout(30000),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) throw new Error(data.error || 'Could not sync grades')
  return data
}

// Maps a callback ?reason= code to friendly copy.
export function googleErrorMessage(reason) {
  switch (reason) {
    case 'access_denied': return 'Google connection was cancelled.'
    case 'no_refresh_token': return 'Google did not grant offline access. Please try again and allow all permissions.'
    case 'bad_state': return 'That connection link expired. Please try connecting again.'
    case 'not_configured': return 'Google Classroom is not set up yet.'
    case 'store_failed': return 'We could not save your Google connection. Please try again.'
    default: return 'Could not connect Google Classroom. Please try again.'
  }
}
