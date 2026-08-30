// End-to-end timing of the authenticated classroom load path.
//
// Boots the real Express app against the real database and drives the real
// route handlers. Auth is exercised for real too: we install a test key into
// the JWKS cache and mint tokens signed with its private half, so no account
// is created and no production auth state is touched. Every request is a GET.
//
// Needs SUPABASE_URL + SUPABASE_SERVICE_KEY; skips cleanly without them.
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { __setJwksCacheForTest } from '../api/authVerify.js'

const URL_ = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_KEY
if (!URL_ || !KEY) {
  console.log('· skipped (SUPABASE_URL / SUPABASE_SERVICE_KEY not set)')
  process.exit(0)
}

const KID = 'perf-test-key'
const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
__setJwksCacheForTest(new Map([[KID, { key: publicKey, alg: 'ES256' }]]))

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
function mint(sub) {
  const now = Math.floor(Date.now() / 1000)
  const input = `${b64({ alg: 'ES256', typ: 'JWT', kid: KID })}.${b64({
    sub, aud: 'authenticated', role: 'authenticated', iss: `${URL_}/auth/v1`,
    iat: now - 10, exp: now + 3600, email: 'perf@test.local',
  })}`
  const sig = crypto.sign('sha256', Buffer.from(input), { key: privateKey, dsaEncoding: 'ieee-p1363' })
  return `${input}.${sig.toString('base64url')}`
}

const sb = createClient(URL_, KEY)
const { data: rooms } = await sb.from('classrooms').select('id, owner_id').limit(1)
if (!rooms?.length) { console.log('· skipped (no classroom rows to measure)'); process.exit(0) }
const { id: classroomId, owner_id: ownerId } = rooms[0]
const token = mint(ownerId)

process.env.PORT = process.env.PERF_PORT || '3021'
await import('../api/server.js')
await new Promise(r => setTimeout(r, 2500))
const base = `http://localhost:${process.env.PORT}`
const H = { Authorization: `Bearer ${token}` }

const med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
async function time(path, n = 9) {
  const first = await fetch(`${base}${path}`, { headers: H })
  if (!first.ok) return { status: first.status, ms: null, body: await first.text() }
  const t = []
  for (let i = 0; i < n; i++) {
    const s = performance.now()
    const r = await fetch(`${base}${path}`, { headers: H })
    await r.arrayBuffer()
    t.push(performance.now() - s)
  }
  return { status: 200, ms: med(t) }
}

console.log('authenticated classroom load path (real handlers, real DB)\n')
const detail = await time(`/api/classroom/${classroomId}`)
const assigns = await time(`/api/classroom/${classroomId}/assignments`)
const stats = await time(`/api/classroom/${classroomId}/stats`)
const list = await time('/api/classroom')

for (const [name, r] of [
  ['GET /api/classroom', list],
  ['GET /api/classroom/:id', detail],
  ['GET /api/classroom/:id/assignments', assigns],
  ['GET /api/classroom/:id/stats', stats],
]) {
  console.log(`  ${name.padEnd(38)} ${r.status}  ${r.ms == null ? r.body?.slice(0, 80) : r.ms.toFixed(0) + 'ms'}`)
}

// The page blocks on detail + assignments together; stats streams in after.
if (detail.ms != null && assigns.ms != null) {
  console.log(`\n  blocking first load (detail ∥ assignments): ${Math.max(detail.ms, assigns.ms).toFixed(0)}ms`)
  console.log(`  stats (background, after paint):             ${stats.ms?.toFixed(0) ?? 'n/a'}ms`)
}
process.exit(0)
