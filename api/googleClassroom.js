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

const CLIENT_ID = process.env.GOOGLE_OAUTH_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_OAUTH_CLIENT_SECRET
// Must EXACTLY match an Authorized redirect URI on the GCP OAuth client.
// Falls back to the local dev callback so `npm run dev` works without extra env.
const REDIRECT_URI = process.env.GOOGLE_OAUTH_REDIRECT_URI
  || 'http://localhost:3001/api/google/oauth/callback'

// The five scopes approved in the architecture. courses.readonly lists the
// teacher's classes; coursework.students creates assignments + does grade
// passback (sensitive); profile.emails resolves a Google submission's userId to
// an email so we can match it to the CapitolKey student who completed.
export const GOOGLE_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.profile.emails',
]

// The classroom scopes that actually gate functionality. openid/email echo back
// in inconsistent forms, so we only enforce these three when checking for a
// re-consent need.
const REQUIRED_CLASSROOM_SCOPES = [
  'https://www.googleapis.com/auth/classroom.courses.readonly',
  'https://www.googleapis.com/auth/classroom.coursework.students',
  'https://www.googleapis.com/auth/classroom.profile.emails',
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
