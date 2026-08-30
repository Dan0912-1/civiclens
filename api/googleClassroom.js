// api/googleClassroom.js — Google Classroom deep integration (server-side).
//
// This is a DEDICATED Google OAuth flow, separate from Supabase Auth. Supabase's
// Google sign-in never yields an offline refresh token, but grade passback runs
// asynchronously when the teacher isn't in a live session, so we run our own
// flow with access_type=offline + prompt=consent and persist an encrypted
// refresh token per teacher (see supabase/create_google_oauth_tokens_table.sql).
//
// This module is stateless: it owns the OAuth client, token crypto, and the
// signed `state` round-trip. Token persistence lives in api/server.js using the
// shared service-key Supabase client. Everything is feature-gated on env so the
// backend boots fine when Google isn't configured.

import crypto from 'crypto'
import { google } from 'googleapis'
import { billHref } from '../src/lib/billUrl.js'
import { defaultCourseworkTitle, COURSEWORK_TITLE_MAX } from '../src/lib/courseworkTitle.js'

export { defaultCourseworkTitle, COURSEWORK_TITLE_MAX }

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET
// Must EXACTLY match an Authorized redirect URI on the GCP OAuth client.
// Falls back to the local dev callback so `npm run dev` works without extra env.
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI
  || 'http://localhost:3001/api/google/oauth/callback'

// The scopes we request. courses.readonly lists the teacher's classes;
// coursework.students creates assignments + does grade passback (sensitive).
// Grade passback matches the student by passing their verified Google email as
// the studentSubmissions `userId` filter, so no roster/profile scope is needed.
export const GOOGLE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
]

// The classroom scopes that actually gate functionality. openid/email echo back
// in inconsistent forms, so we only enforce these two when checking for a
// re-consent need.
const REQUIRED_CLASSROOM_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
]

// ─── Encryption key (AES-256-GCM) ────────────────────────────────────────────
// Accepts a 32-byte key as base64 (preferred: `openssl rand -base64 32`) or hex.
function loadEncKey() {
  const raw = process.env.GOOGLE_TOKEN_ENC_KEY
  if (!raw) return null
  const b64 = Buffer.from(raw, 'base64')
  if (b64.length === 32) return b64
  const hex = Buffer.from(raw, 'hex')
  if (hex.length === 32) return hex
  return null
}

export function googleConfigured() {
  return !!(CLIENT_ID && CLIENT_SECRET && loadEncKey())
}

// ─── Refresh/access token encryption at rest ─────────────────────────────────
export function encryptSecret(plain) {
  const key = loadEncKey()
  if (!key) throw new Error('GOOGLE_TOKEN_ENC_KEY not configured')
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return ['v1', iv.toString('base64'), tag.toString('base64'), enc.toString('base64')].join(':')
}

export function decryptSecret(blob) {
  const key = loadEncKey()
  if (!key) throw new Error('GOOGLE_TOKEN_ENC_KEY not configured')
  const [ver, ivB64, tagB64, dataB64] = String(blob).split(':')
  if (ver !== 'v1' || !ivB64 || !tagB64 || !dataB64) throw new Error('Malformed ciphertext')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivB64, 'base64'))
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8')
}

// ─── Signed OAuth `state` ────────────────────────────────────────────────────
// The callback is a top-level browser redirect from Google with no Authorization
// header, so it can't run requireAuth. We bind the initiating user's id into an
// HMAC-signed, short-lived `state` instead. The client secret doubles as the
// HMAC key — a high-entropy server-only value, no extra secret to manage.
function stateSecret() {
  return CLIENT_SECRET || 'unconfigured'
}

export function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const sig = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  return `${body}.${sig}`
}

export function verifyState(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null
  const [body, sig] = token.split('.')
  const expected = crypto.createHmac('sha256', stateSecret()).update(body).digest('base64url')
  const a = Buffer.from(sig)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  let payload
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return null }
  if (!payload || typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

// ─── OAuth client + flows ────────────────────────────────────────────────────
export function makeOAuthClient() {
  return new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI)
}

export function buildConsentUrl(state) {
  return makeOAuthClient().generateAuthUrl({
    access_type: 'offline',     // ask for a refresh token
    prompt: 'consent',          // force one every connect, even on re-link
    include_granted_scopes: true,
    scope: GOOGLE_SCOPES,
    state,
  })
}

// Exchange the authorization code for tokens. Reads the connected account's
// email straight from the id_token claims (we requested openid+email), avoiding
// an extra userinfo round-trip.
export async function exchangeCodeForTokens(code) {
  const { tokens } = await makeOAuthClient().getToken(code)
  let email = null
  if (tokens.id_token) {
    try {
      const claims = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64').toString('utf8'))
      email = claims.email || null
    } catch { /* non-fatal: email is best-effort */ }
  }
  return {
    refreshToken: tokens.refresh_token || null,
    accessToken: tokens.access_token || null,
    expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : null,
    scope: tokens.scope || '',
    email,
  }
}

// Build an authed client from a stored refresh token. googleapis auto-refreshes
// the access token as needed for each API call. Used by Phase 2/3.
export function getAuthedClient(refreshToken) {
  const client = makeOAuthClient()
  client.setCredentials({ refresh_token: refreshToken })
  return client
}

// A Google Classroom API client authed as the given teacher (Phase 2/3).
// googleapis auto-refreshes the access token from the refresh token per call.
export function getClassroomClient(refreshToken) {
  return google.classroom({ version: 'v1', auth: getAuthedClient(refreshToken) })
}

// Absolute URL to a bill on the live site, used as the Google Classroom Link
// material. Carries ?gcr=<assignmentId> so the student page knows it's a Google
// assignment and can attribute completion + grade passback. Uses the SAME
// billHref the frontend uses so the link resolves identically.
const APP_BASE = (process.env.FRONTEND_URL || 'https://capitolkey.org').replace(/\/$/, '')
export function buildBillUrl(billData, gcr) {
  const path = billHref(billData || {}, { canonical: true })
  const sep = path.includes('?') ? '&' : '?'
  return `${APP_BASE}${path}${sep}gcr=${encodeURIComponent(gcr)}`
}

export async function revokeRefreshToken(refreshToken) {
  try {
    await makeOAuthClient().revokeToken(refreshToken)
    return true
  } catch {
    return false
  }
}

export function hasRequiredScopes(grantedScopeStr) {
  const granted = new Set((grantedScopeStr || '').split(/\s+/).filter(Boolean))
  return REQUIRED_CLASSROOM_SCOPES.every((s) => granted.has(s))
}

// ─── Error classification ────────────────────────────────────────────────────
// googleapis (gaxios) surfaces HTTP failures inconsistently: sometimes
// err.response.status, sometimes err.status, sometimes a numeric err.code, and
// for token-endpoint failures only err.response.data.error ('invalid_grant').
// Reading all of them keeps a revoked token from being misread as a transient
// blip (and vice versa).
export function googleStatus(err) {
  const raw = err?.response?.status ?? err?.status ?? err?.code
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : null
}

// The teacher must re-run consent: the refresh token was revoked, expired, or
// the grant was removed at myaccount.google.com.
export function isGoogleAuthError(err) {
  const m = String(err?.message || '')
  const data = err?.response?.data
  const dataErr = String(data?.error || data?.error_description || '')
  if (/invalid_grant|invalid_token|unauthorized_client|Token has been expired or revoked/i.test(m + ' ' + dataErr)) return true
  return googleStatus(err) === 401
}

// A single reason code per failure so callers can render an ACTIONABLE message
// instead of a generic "something went wrong".
export function classifyGoogleError(err) {
  if (isGoogleAuthError(err)) return 'reconnect'
  const status = googleStatus(err)
  if (status === 404) return 'not_found'
  if (status === 403) return 'forbidden'
  if (status === 429) return 'rate_limited'
  if (status && status >= 500) return 'google_down'
  return 'error'
}

// Transient failures worth one more try. 404/403 never are — they mean the
// resource or the permission genuinely isn't there.
const RETRYABLE = new Set([429, 500, 502, 503, 504])

export async function withGoogleRetry(fn, { attempts = 3, baseDelayMs = 400 } = {}) {
  let lastErr
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const status = googleStatus(err)
      const networkBlip = !status && /ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(String(err?.message || ''))
      if (i === attempts - 1 || (!RETRYABLE.has(status) && !networkBlip)) throw err
      const backoff = baseDelayMs * 2 ** i + Math.floor(Math.random() * 150)
      await new Promise((r) => setTimeout(r, backoff))
    }
  }
  throw lastErr
}

// ─── Course listing ──────────────────────────────────────────────────────────
// courses.list is paginated. A teacher with more than one page of active
// classes would silently lose the rest from the assign picker, so walk the
// pages (bounded, so a pathological account can't spin here forever).
export async function listAllTeacherCourses(classroom, { maxPages = 5, pageSize = 100 } = {}) {
  const courses = []
  let pageToken
  for (let page = 0; page < maxPages; page++) {
    const out = await withGoogleRetry(() => classroom.courses.list({
      teacherId: 'me',
      courseStates: ['ACTIVE'],
      pageSize,
      ...(pageToken ? { pageToken } : {}),
    }))
    for (const c of (out.data.courses || [])) {
      courses.push({ id: c.id, name: c.name, section: c.section || '' })
    }
    pageToken = out.data.nextPageToken
    if (!pageToken) break
  }
  return courses
}

// Does this coursework still exist in Google? A teacher who deletes the post in
// Google Classroom leaves us holding a dead google_coursework_id; without this
// check a re-push just returns the dead alternateLink as "already assigned".
export async function courseWorkExists(classroom, courseId, courseWorkId) {
  try {
    const out = await withGoogleRetry(() => classroom.courses.courseWork.get({ courseId, id: courseWorkId }))
    return out?.data?.state !== 'DELETED'
  } catch (err) {
    if (googleStatus(err) === 404) return false
    // 403/network/etc: assume it's still there rather than duplicating a post.
    return true
  }
}

// ─── Bill link validation ────────────────────────────────────────────────────
// buildBillUrl feeds Google Classroom the ONE link students follow. billHref
// degrades gracefully on missing fields ('/bill/0//'), which would ship a dead
// assignment to a real class, so validate the shape before we push it.
// A federal bill resolves from /bill/:congress/:type/:number, so congress must
// be a real number — billHref falls back to 0, which only routes when a
// legiscan_id rides along (the state-bill fallback shape).
const FEDERAL_PATH_RE = /^\/bill\/([1-9]\d*)\/[a-z]+\/[A-Za-z0-9.-]+$/
const FEDERAL_FALLBACK_RE = /^\/bill\/0\/[a-z]+\/[A-Za-z0-9.-]+\?legiscan_id=\d+$/
const STATE_PATH_RE = /^\/states\/[a-z]{2}\/[a-z0-9-]+\/[a-z]+\/[A-Za-z0-9.-]+$/

export function isResolvableBillPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return false
  // billHref interpolates missing fields straight into the path, so a bill with
  // no number yields '/bill/0/hr/undefined' — a well-formed-looking 404.
  if (/\/(undefined|null)(\?|$)/.test(path)) return false
  return FEDERAL_PATH_RE.test(path) || FEDERAL_FALLBACK_RE.test(path) || STATE_PATH_RE.test(path)
}

// True when billData is complete enough to produce a link a student can open.
export function billLinkIsResolvable(billData) {
  if (!billData || typeof billData !== 'object') return false
  const type = String(billData.type ?? billData.bill_type ?? '').trim()
  const number = billData.number ?? billData.bill_number
  if (!type || number == null || String(number).trim() === '') return false
  return isResolvableBillPath(billHref(billData, { canonical: true }))
}

// ─── Due date ────────────────────────────────────────────────────────────────
// Classroom stores dueDate + dueTime as separate UTC fields and renders them in
// the viewer's local time. So the ONLY correct input is an absolute instant.
//
// This was live-wrong. A real assignment in a real course held
// dueDate {2026,6,24} + dueTime {23,59} — which is 23:59 UTC, i.e. 7:59 PM
// Eastern. The teacher had picked a date meaning "end of that day" and the old
// date-only path stamped 23:59 UTC onto it, shifting every US due time earlier
// by the UTC offset (and, east of UTC, onto the wrong day entirely).
//
// Takes an ISO instant. Returns null when there's no usable date, and
// { past: true } when Google would reject it — the API requires a future due
// date, and its rejection is an opaque 400 that we used to blame on the course.
export function buildDueFields(dueDateTime, { now = Date.now() } = {}) {
  if (!dueDateTime) return null
  const dt = new Date(dueDateTime)
  if (isNaN(dt.getTime())) return null
  if (dt.getTime() <= now) return { past: true }
  return {
    dueDate: { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() },
    dueTime: { hours: dt.getUTCHours(), minutes: dt.getUTCMinutes() },
  }
}

// A DRAFT courseWork has no alternateLink — Google only populates it once the
// post is PUBLISHED. Since "Save as draft" is our default, the success screen's
// "Open in Google Classroom" button was missing exactly when most teachers
// needed it. Fall back to the course page, which always exists.
export function classroomFallbackLink(course, courseId) {
  return course?.alternateLink || (courseId ? `https://classroom.google.com/c/${courseId}` : null)
}
