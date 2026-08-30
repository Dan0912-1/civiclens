// Local verification of Supabase access tokens.
//
// requireAuth used to call supabase.auth.getUser(token) on every request — a
// network round trip to the Supabase Auth API (~150-300ms measured from
// Railway) just to validate a signature we can check ourselves. Supabase signs
// access tokens with an asymmetric key and publishes the public half at
// /auth/v1/.well-known/jwks.json, so verification is pure local crypto.
//
// Falls back to the network check for anything we can't verify locally (legacy
// HS256 project keys, a kid we don't recognize after a JWKS refresh). The
// fallback is always to the AUTHORITATIVE check, never to "allow".

import crypto from 'crypto'

const JWKS_TTL_MS = 10 * 60 * 1000
// Floor between JWKS refetches. Without this, a caller sending random `kid`
// values would make us hammer the JWKS endpoint once per request.
const JWKS_REFETCH_FLOOR_MS = 30 * 1000
// Absolute cap on clock skew between us and the Auth server.
const CLOCK_SKEW_SEC = 10

let jwksCache = { keys: new Map(), fetchedAt: 0, inflight: null }

function b64urlToBuffer(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function decodeJson(segment) {
  return JSON.parse(b64urlToBuffer(segment).toString('utf8'))
}

async function fetchJwks(supabaseUrl) {
  const resp = await fetch(`${supabaseUrl}/auth/v1/.well-known/jwks.json`, {
    signal: AbortSignal.timeout(5000),
  })
  if (!resp.ok) throw new Error(`JWKS fetch failed: ${resp.status}`)
  const body = await resp.json()
  const keys = new Map()
  for (const jwk of (body.keys || [])) {
    if (!jwk.kid) continue
    try {
      keys.set(jwk.kid, {
        key: crypto.createPublicKey({ key: jwk, format: 'jwk' }),
        alg: jwk.alg,
      })
    } catch {
      // A key type Node can't import (or a malformed entry) shouldn't poison
      // the whole set — skip it and keep the others.
    }
  }
  return keys
}

// Returns the cached JWKS, refetching when stale or when `wantKid` is absent
// (key rotation). Concurrent callers share one in-flight request.
async function getKeys(supabaseUrl, wantKid) {
  const now = Date.now()
  const stale = now - jwksCache.fetchedAt > JWKS_TTL_MS
  const missingKid = wantKid && !jwksCache.keys.has(wantKid)
  const canRefetch = now - jwksCache.fetchedAt > JWKS_REFETCH_FLOOR_MS

  if (jwksCache.keys.size > 0 && !stale && !missingKid) return jwksCache.keys
  if ((stale || missingKid) && !canRefetch && jwksCache.keys.size > 0) return jwksCache.keys

  if (!jwksCache.inflight) {
    jwksCache.inflight = fetchJwks(supabaseUrl)
      .then(keys => {
        // Only replace a populated cache with a populated result, so a
        // transient empty response can't lock everyone out.
        if (keys.size > 0) jwksCache = { keys, fetchedAt: Date.now(), inflight: null }
        else jwksCache = { ...jwksCache, fetchedAt: Date.now(), inflight: null }
        return jwksCache.keys
      })
      .catch(err => {
        // Keep serving the old keys on a fetch failure; stamp fetchedAt so we
        // back off instead of retrying on every request.
        jwksCache = { ...jwksCache, fetchedAt: Date.now(), inflight: null }
        throw err
      })
  }
  return jwksCache.inflight
}

function verifySignature(alg, keyObject, signingInput, signature) {
  const data = Buffer.from(signingInput, 'utf8')
  switch (alg) {
    case 'ES256':
      // JWS carries a raw R||S signature; Node defaults to DER for ECDSA.
      return crypto.verify('sha256', data, { key: keyObject, dsaEncoding: 'ieee-p1363' }, signature)
    case 'RS256':
      return crypto.verify('sha256', data, keyObject, signature)
    default:
      return false
  }
}

// { ok: true, user } on success.
// { ok: false, reason: 'invalid' } when the token is definitively bad — reject
//   without a network call.
// { ok: false, reason: 'unsupported' } when we can't judge it locally — the
//   caller must fall back to supabase.auth.getUser.
export async function verifyAccessToken(token, supabaseUrl) {
  if (!token || !supabaseUrl) return { ok: false, reason: 'unsupported' }

  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'invalid' }

  let header, payload
  try {
    header = decodeJson(parts[0])
    payload = decodeJson(parts[1])
  } catch {
    return { ok: false, reason: 'invalid' }
  }

  // alg:none is never legitimate — reject outright rather than spending a
  // network call on it.
  if (!header.alg || header.alg === 'none') return { ok: false, reason: 'invalid' }
  // HS256 means the project still uses the legacy shared secret, which we
  // don't hold. Let the network path handle it.
  if (header.alg !== 'ES256' && header.alg !== 'RS256') {
    return { ok: false, reason: 'unsupported' }
  }
  if (!header.kid) return { ok: false, reason: 'unsupported' }

  let keys
  try {
    keys = await getKeys(supabaseUrl, header.kid)
  } catch {
    return { ok: false, reason: 'unsupported' }
  }

  const entry = keys.get(header.kid)
  // Unknown kid after a refresh attempt: don't call it invalid, because a key
  // we failed to import would then lock the user out. Defer to the network.
  if (!entry) return { ok: false, reason: 'unsupported' }
  if (entry.alg && entry.alg !== header.alg) return { ok: false, reason: 'invalid' }

  let valid = false
  try {
    valid = verifySignature(header.alg, entry.key, `${parts[0]}.${parts[1]}`, b64urlToBuffer(parts[2]))
  } catch {
    return { ok: false, reason: 'invalid' }
  }
  if (!valid) return { ok: false, reason: 'invalid' }

  // Signature is good — now the claims.
  const nowSec = Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || nowSec > payload.exp + CLOCK_SKEW_SEC) {
    return { ok: false, reason: 'invalid' }
  }
  if (typeof payload.nbf === 'number' && nowSec < payload.nbf - CLOCK_SKEW_SEC) {
    return { ok: false, reason: 'invalid' }
  }
  if (payload.iss !== `${supabaseUrl}/auth/v1`) return { ok: false, reason: 'invalid' }

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!aud.includes('authenticated')) return { ok: false, reason: 'invalid' }
  if (payload.role && payload.role !== 'authenticated') return { ok: false, reason: 'invalid' }
  if (!payload.sub) return { ok: false, reason: 'invalid' }

  // Shape matches the fields server.js reads off supabase.auth.getUser's user.
  return {
    ok: true,
    user: {
      id: payload.sub,
      email: payload.email || null,
      phone: payload.phone || null,
      app_metadata: payload.app_metadata || {},
      user_metadata: payload.user_metadata || {},
      role: payload.role || 'authenticated',
      aud: payload.aud,
      is_anonymous: !!payload.is_anonymous,
    },
  }
}

// Test seam — lets the unit test install a known key set and assert on
// rotation behaviour without hitting the network.
export function __setJwksCacheForTest(keys, fetchedAt = Date.now()) {
  jwksCache = { keys, fetchedAt, inflight: null }
}
