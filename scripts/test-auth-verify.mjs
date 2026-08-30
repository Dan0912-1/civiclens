// Verifies local Supabase access-token validation: accepts a well-formed
// token, and rejects every tampering / expiry / confusion case we care about.
import crypto from 'crypto'
import assert from 'assert'
import { verifyAccessToken, __setJwksCacheForTest } from '../api/authVerify.js'

const SUPABASE_URL = 'https://example.supabase.co'
const ISS = `${SUPABASE_URL}/auth/v1`
const KID = 'test-kid-1'

const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
const { privateKey: otherPriv } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })

__setJwksCacheForTest(new Map([[KID, { key: publicKey, alg: 'ES256' }]]))

const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url')

function sign(payload, { kid = KID, alg = 'ES256', key = privateKey, tamper = false } = {}) {
  const input = `${b64({ alg, typ: 'JWT', kid })}.${b64(payload)}`
  let sig = crypto.sign('sha256', Buffer.from(input), { key, dsaEncoding: 'ieee-p1363' })
  if (tamper) sig = Buffer.concat([sig.subarray(0, sig.length - 1), Buffer.from([sig[sig.length - 1] ^ 0xff])])
  return `${input}.${sig.toString('base64url')}`
}

const now = Math.floor(Date.now() / 1000)
const base = {
  sub: '11111111-2222-4333-8444-555555555555',
  aud: 'authenticated',
  role: 'authenticated',
  iss: ISS,
  iat: now - 60,
  exp: now + 3600,
  email: 'teacher@school.edu',
  user_metadata: { full_name: 'A Teacher' },
}

let passed = 0
async function check(name, token, expect) {
  const res = await verifyAccessToken(token, SUPABASE_URL)
  const got = res.ok ? 'ok' : res.reason
  assert.strictEqual(got, expect, `${name}: expected ${expect}, got ${got}`)
  console.log(`  ok  ${name} -> ${got}`)
  passed++
  return res
}

console.log('local access-token verification')

const good = await check('valid token', sign(base), 'ok')
assert.strictEqual(good.user.id, base.sub)
assert.strictEqual(good.user.email, 'teacher@school.edu')
assert.strictEqual(good.user.user_metadata.full_name, 'A Teacher')
console.log('  ok  claims mapped to user shape')
passed++

await check('tampered signature', sign(base, { tamper: true }), 'invalid')
await check('signed by a different key', sign(base, { key: otherPriv }), 'invalid')
await check('expired', sign({ ...base, exp: now - 120 }), 'invalid')
await check('not yet valid', sign({ ...base, nbf: now + 600 }), 'invalid')
await check('wrong issuer', sign({ ...base, iss: 'https://evil.supabase.co/auth/v1' }), 'invalid')
await check('wrong audience', sign({ ...base, aud: 'anon' }), 'invalid')
await check('service_role escalation', sign({ ...base, role: 'service_role' }), 'invalid')
await check('missing sub', sign({ ...base, sub: undefined }), 'invalid')
await check('malformed token', 'not.a.jwt', 'invalid')
await check('two segments', 'aaa.bbb', 'invalid')

// alg:none — the classic JWT bypass. Must never verify.
const noneTok = `${b64({ alg: 'none', typ: 'JWT', kid: KID })}.${b64(base)}.`
await check('alg:none bypass', noneTok, 'invalid')

// HS256 forged with the public key as the HMAC secret — the algorithm-confusion
// attack. We must not treat it as verifiable locally.
const hsInput = `${b64({ alg: 'HS256', typ: 'JWT', kid: KID })}.${b64(base)}`
const hsSig = crypto.createHmac('sha256', publicKey.export({ type: 'spki', format: 'pem' }))
  .update(hsInput).digest('base64url')
await check('HS256 algorithm confusion', `${hsInput}.${hsSig}`, 'unsupported')

// Unknown kid must defer to the network, not hard-reject (key rotation).
await check('unknown kid defers to network', sign(base, { kid: 'rotated-kid' }), 'unsupported')

await check('no token', '', 'unsupported')

console.log(`\n${passed} checks passed`)
