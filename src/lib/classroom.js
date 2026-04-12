import { getApiBase } from './api'

const API = getApiBase()

async function authHeaders(token) {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  }
}

export async function getMyClassrooms(token) {
  try {
    const resp = await fetch(`${API}/api/classroom`, { headers: await authHeaders(token) })
    if (!resp.ok) return []
    const data = await resp.json()
    return data.classrooms || []
  } catch { return [] }
}

export async function createClassroom(token, name, requireName = false) {
  const resp = await fetch(`${API}/api/classroom`, {
    method: 'POST',
    headers: await authHeaders(token),
    body: JSON.stringify({ name, requireName }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to create classroom')
  }
  const data = await resp.json()
  return data.classroom
}

export async function joinClassroom(token, code) {
  const resp = await fetch(`${API}/api/classroom/join`, {
    method: 'POST',
    headers: await authHeaders(token),
    body: JSON.stringify({ code }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to join classroom')
  }
  const data = await resp.json()
  return data.classroom
}

export async function getClassroomDetail(token, id) {
  const resp = await fetch(`${API}/api/classroom/${id}`, { headers: await authHeaders(token) })
  if (!resp.ok) return null
  const data = await resp.json()
  return data.classroom
}

export async function updateClassroom(token, id, updates) {
  const resp = await fetch(`${API}/api/classroom/${id}`, {
    method: 'PUT',
    headers: await authHeaders(token),
    body: JSON.stringify(updates),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to update classroom')
  }
  return (await resp.json()).classroom
}

export async function deleteClassroom(token, id) {
  const resp = await fetch(`${API}/api/classroom/${id}`, {
    method: 'DELETE',
    headers: await authHeaders(token),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to delete classroom')
  }
}

export async function regenerateCode(token, id) {
  const resp = await fetch(`${API}/api/classroom/${id}/regenerate-code`, {
    method: 'POST',
    headers: await authHeaders(token),
  })
  if (!resp.ok) throw new Error('Failed to regenerate code')
  return (await resp.json()).join_code
}

export async function leaveClassroom(token, id) {
  await fetch(`${API}/api/classroom/${id}/leave`, {
    method: 'DELETE',
    headers: await authHeaders(token),
  })
}

export async function getMembers(token, id) {
  const resp = await fetch(`${API}/api/classroom/${id}/members`, { headers: await authHeaders(token) })
  if (!resp.ok) return []
  return (await resp.json()).members || []
}

export async function getAssignments(token, id) {
  const resp = await fetch(`${API}/api/classroom/${id}/assignments`, { headers: await authHeaders(token) })
  if (!resp.ok) return []
  return (await resp.json()).assignments || []
}

export async function createAssignment(token, classroomId, { billId, billData, instructions, dueDate }) {
  const resp = await fetch(`${API}/api/classroom/${classroomId}/assignments`, {
    method: 'POST',
    headers: await authHeaders(token),
    body: JSON.stringify({ billId, billData, instructions, dueDate }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(err.error || 'Failed to assign bill')
  }
  return (await resp.json()).assignment
}

export async function removeAssignment(token, classroomId, assignmentId) {
  await fetch(`${API}/api/classroom/${classroomId}/assignments/${assignmentId}`, {
    method: 'DELETE',
    headers: await authHeaders(token),
  })
}

export async function markComplete(token, classroomId, assignmentId, timeSpentSec) {
  await fetch(`${API}/api/classroom/${classroomId}/assignments/${assignmentId}/complete`, {
    method: 'POST',
    headers: await authHeaders(token),
    body: JSON.stringify({ timeSpentSec }),
  })
}

export async function getClassroomStats(token, id) {
  const resp = await fetch(`${API}/api/classroom/${id}/stats`, { headers: await authHeaders(token) })
  if (!resp.ok) return null
  return resp.json()
}

export async function exportClassroomCsv(token, id) {
  const resp = await fetch(`${API}/api/classroom/${id}/export`, { headers: await authHeaders(token) })
  if (!resp.ok) throw new Error('Failed to export')
  return resp.blob()
}

// Public (no auth) — peek at classroom by code
export async function peekClassroom(code) {
  const resp = await fetch(`${API}/api/classroom/peek/${encodeURIComponent(code.toUpperCase())}`)
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
