#!/usr/bin/env node
// Unit tests for the Google Classroom integration's pure logic.
//
// The parts of this feature that touch Google can only be exercised with a real
// teacher, a real course, and a real student — so the pieces that CAN be tested
// in isolation are the ones most worth pinning down, because a silent
// regression in any of them corrupts a live classroom:
//
//   • signed `state`   — the only thing binding an OAuth callback to a user.
//     A verify() that accepts a forged or expired state hands one teacher's
//     Google account to another teacher's CapitolKey login.
//   • token crypto     — a round-trip bug bricks every stored refresh token,
//     and a missing auth-tag check would let a tampered ciphertext through.
//   • bill link build  — the one link students follow out of Google Classroom.
//   • error mapping    — decides "reconnect" vs "try again", i.e. whether the
//     teacher is told to do something or told to wait.
//   • due-date math    — a UTC conversion bug shifts every due date by hours.
//
// Env is set BEFORE the dynamic import because the module reads config at eval.

process.env.GOOGLE_OAUTH_CLIENT_ID = 'test-client-id.apps.googleusercontent.com'
process.env.GOOGLE_OAUTH_CLIENT_SECRET = 'test-client-secret-value'
process.env.GOOGLE_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64')
process.env.FRONTEND_URL = 'https://capitolkey.org'

const gc = await import('../api/googleClassroom.js')

let passed = 0
const failures = []

function check(name, fn) {
  try {
    fn()
    passed++
  } catch (err) {
    failures.push(`${name}: ${err.message}`)
  }
}
function eq(actual, expected, what = '') {
  if (actual !== expected) {
    throw new Error(`${what}expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'expected truthy') }

console.log('\n=== Google Classroom logic tests ===\n')

// ─── Configuration gate ──────────────────────────────────────────────────────
check('googleConfigured() true with full env', () => {
  ok(gc.googleConfigured(), 'should be configured')
})

check('scope set is exactly the four non-sensitive scopes', () => {
  eq(gc.GOOGLE_SCOPES.length, 4, 'scope count: ')
  ok(!gc.GOOGLE_SCOPES.some(s => s.includes('profile.emails')), 'profile.emails is sensitive and was deliberately dropped')
  ok(!gc.GOOGLE_SCOPES.some(s => s.includes('rosters')), 'rosters would re-trigger Google verification')
})

// ─── Token encryption ────────────────────────────────────────────────────────
check('encrypt/decrypt round-trips a refresh token', () => {
  const secret = '1//0abcDEF-refresh-token_value.with~chars'
  eq(gc.decryptSecret(gc.encryptSecret(secret)), secret)
})

check('ciphertext is not the plaintext and is versioned', () => {
  const blob = gc.encryptSecret('hunter2')
  ok(!blob.includes('hunter2'), 'plaintext leaked into ciphertext')
  eq(blob.split(':')[0], 'v1', 'version prefix: ')
})

check('encryption is randomized (fresh IV per call)', () => {
  ok(gc.encryptSecret('same') !== gc.encryptSecret('same'), 'identical ciphertexts means a reused IV')
})

check('tampered ciphertext is rejected by the GCM auth tag', () => {
  const parts = gc.encryptSecret('original-token').split(':')
  const data = Buffer.from(parts[3], 'base64')
  data[0] ^= 0xff
  parts[3] = data.toString('base64')
  let threw = false
  try { gc.decryptSecret(parts.join(':')) } catch { threw = true }
  ok(threw, 'tampered ciphertext decrypted without error')
})

check('malformed ciphertext is rejected', () => {
  let threw = false
  try { gc.decryptSecret('not-a-real-blob') } catch { threw = true }
  ok(threw, 'malformed blob should throw')
})

// ─── Signed OAuth state ──────────────────────────────────────────────────────
const future = () => Math.floor(Date.now() / 1000) + 600

check('state round-trips the payload', () => {
  const payload = { uid: 'user-123', platform: 'web', returnTo: '/classroom', nonce: 'abc', exp: future() }
  const out = gc.verifyState(gc.signState(payload))
  ok(out, 'verify returned null for a valid state')
  eq(out.uid, 'user-123', 'uid: ')
  eq(out.returnTo, '/classroom', 'returnTo: ')
})

check('state with a forged signature is rejected', () => {
  const token = gc.signState({ uid: 'a', exp: future() })
  const [body] = token.split('.')
  eq(gc.verifyState(`${body}.deadbeefdeadbeef`), null)
})

check('state with a swapped-in payload is rejected', () => {
  const mine = gc.signState({ uid: 'attacker', exp: future() })
  const theirs = gc.signState({ uid: 'victim', exp: future() })
  // Attacker keeps the victim's body but their own signature.
  eq(gc.verifyState(`${theirs.split('.')[0]}.${mine.split('.')[1]}`), null)
})

check('expired state is rejected', () => {
  eq(gc.verifyState(gc.signState({ uid: 'a', exp: Math.floor(Date.now() / 1000) - 1 })), null)
})

check('state with no expiry is rejected', () => {
  eq(gc.verifyState(gc.signState({ uid: 'a' })), null)
})

check('garbage state inputs are rejected without throwing', () => {
  for (const bad of ['', null, undefined, 'nodot', '.', 'a.b.c', 42, {}]) {
    eq(gc.verifyState(bad), null, `input ${JSON.stringify(bad)}: `)
  }
})

// ─── Scope checking ──────────────────────────────────────────────────────────
check('hasRequiredScopes accepts a full grant', () => {
  ok(gc.hasRequiredScopes(gc.GOOGLE_SCOPES.join(' ')))
})

check('hasRequiredScopes rejects a partial grant', () => {
  ok(!gc.hasRequiredScopes('openid https://www.googleapis.com/auth/classroom.courses.readonly'),
    'missing coursework.students should fail')
})

check('hasRequiredScopes rejects empty/missing input', () => {
  ok(!gc.hasRequiredScopes(''))
  ok(!gc.hasRequiredScopes(null))
})

// ─── Bill link building ──────────────────────────────────────────────────────
check('federal bill link is absolute and carries ?gcr=', () => {
  const url = gc.buildBillUrl({ type: 'hr', number: '1234', congress: 119 }, 'assign-abc')
  eq(url, 'https://capitolkey.org/bill/119/hr/1234?gcr=assign-abc')
})

check('state bill link uses the /states path', () => {
  const url = gc.buildBillUrl(
    { type: 'hb', number: '5001', state: 'ct', session: '2026 Regular Session', jurisdiction: 'ct' },
    'assign-xyz',
  )
  ok(url.startsWith('https://capitolkey.org/states/ct/'), `unexpected state path: ${url}`)
  ok(url.includes('gcr=assign-xyz'), 'gcr param missing')
})

check('gcr value is URL-encoded', () => {
  const url = gc.buildBillUrl({ type: 'hr', number: '1', congress: 119 }, 'a b&c')
  ok(url.includes('gcr=a%20b%26c'), `not encoded: ${url}`)
})

check('link validation accepts complete federal + state bills', () => {
  ok(gc.billLinkIsResolvable({ type: 'hr', number: '1234', congress: 119 }), 'federal')
  ok(gc.billLinkIsResolvable({ type: 'hb', number: '5001', state: 'ct', session: '2026 Regular Session' }), 'state')
})

check('link validation rejects bills that would build a dead link', () => {
  // These are the shapes that produced '/bill/0//' — an unroutable link posted
  // into a real Google class with no way for a student to recover.
  ok(!gc.billLinkIsResolvable(null), 'null')
  ok(!gc.billLinkIsResolvable({}), 'empty object')
  ok(!gc.billLinkIsResolvable({ type: 'hr' }), 'no number')
  ok(!gc.billLinkIsResolvable({ number: '1234' }), 'no type')
  ok(!gc.billLinkIsResolvable({ type: '', number: '', congress: 119 }), 'blank fields')
})

check('a bill with no congress is rejected unless it carries a legiscan_id', () => {
  // billHref defaults congress to 0, and /bill/0/... only routes when the
  // legacy legiscan_id is present. Without this check the teacher would post a
  // link that 404s for every student in the class.
  ok(!gc.billLinkIsResolvable({ type: 'hr', number: '1234' }), 'no congress, no legiscan_id')
  ok(gc.billLinkIsResolvable({ type: 'hb', number: '5001', state: 'ct', legiscan_bill_id: 1899231 }),
    'state bill with no session falls back to the legiscan_id path')
})

check('isResolvableBillPath rejects non-bill paths', () => {
  ok(!gc.isResolvableBillPath('/'), 'root')
  ok(!gc.isResolvableBillPath('https://evil.example/bill/119/hr/1'), 'absolute URL')
  ok(!gc.isResolvableBillPath(''), 'empty')
})

// ─── Error classification ────────────────────────────────────────────────────
// Shapes taken from how gaxios/googleapis actually surface each failure.
check('revoked refresh token classifies as reconnect', () => {
  const err = new Error('invalid_grant')
  err.response = { data: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }
  ok(gc.isGoogleAuthError(err), 'isGoogleAuthError')
  eq(gc.classifyGoogleError(err), 'reconnect')
})

check('bare 401 classifies as reconnect', () => {
  const err = new Error('Request had invalid authentication credentials.')
  err.response = { status: 401 }
  eq(gc.classifyGoogleError(err), 'reconnect')
})

check('404 classifies as not_found, not as an auth failure', () => {
  const err = new Error('Requested entity was not found.')
  err.response = { status: 404 }
  ok(!gc.isGoogleAuthError(err), 'a missing student must not read as a dead token')
  eq(gc.classifyGoogleError(err), 'not_found')
})

check('403 / 429 / 5xx each get their own reason', () => {
  const mk = (status) => Object.assign(new Error('x'), { response: { status } })
  eq(gc.classifyGoogleError(mk(403)), 'forbidden')
  eq(gc.classifyGoogleError(mk(429)), 'rate_limited')
  eq(gc.classifyGoogleError(mk(503)), 'google_down')
})

check('unknown errors fall back to error', () => {
  eq(gc.classifyGoogleError(new Error('something odd')), 'error')
  eq(gc.classifyGoogleError(null), 'error')
})

check('googleStatus reads status from every shape googleapis uses', () => {
  eq(gc.googleStatus({ response: { status: 404 } }), 404)
  eq(gc.googleStatus({ status: 429 }), 429)
  eq(gc.googleStatus({ code: 401 }), 401)
  eq(gc.googleStatus({ code: 'ECONNRESET' }), null, 'network codes are not HTTP statuses: ')
  eq(gc.googleStatus(new Error('plain')), null)
})

// ─── Retry policy ────────────────────────────────────────────────────────────
const asyncChecks = []
function checkAsync(name, fn) { asyncChecks.push([name, fn]) }

checkAsync('withGoogleRetry retries a 503 and then succeeds', async () => {
  let calls = 0
  const out = await gc.withGoogleRetry(async () => {
    calls++
    if (calls < 3) throw Object.assign(new Error('backend error'), { response: { status: 503 } })
    return 'ok'
  }, { baseDelayMs: 1 })
  eq(out, 'ok')
  eq(calls, 3, 'call count: ')
})

checkAsync('withGoogleRetry does NOT retry a 404', async () => {
  let calls = 0
  let threw = false
  try {
    await gc.withGoogleRetry(async () => {
      calls++
      throw Object.assign(new Error('not found'), { response: { status: 404 } })
    }, { baseDelayMs: 1 })
  } catch { threw = true }
  ok(threw, 'should rethrow')
  eq(calls, 1, 'a 404 must not be retried; call count: ')
})

checkAsync('withGoogleRetry does NOT retry a revoked token', async () => {
  let calls = 0
  try {
    await gc.withGoogleRetry(async () => {
      calls++
      throw Object.assign(new Error('invalid_grant'), { response: { status: 400, data: { error: 'invalid_grant' } } })
    }, { baseDelayMs: 1 })
  } catch { /* expected */ }
  eq(calls, 1, 'retrying a dead token just delays the reconnect prompt; call count: ')
})

checkAsync('withGoogleRetry gives up after the attempt cap', async () => {
  let calls = 0
  try {
    await gc.withGoogleRetry(async () => {
      calls++
      throw Object.assign(new Error('rate limited'), { response: { status: 429 } })
    }, { attempts: 3, baseDelayMs: 1 })
  } catch { /* expected */ }
  eq(calls, 3, 'call count: ')
})

// ─── Course pagination ───────────────────────────────────────────────────────
checkAsync('listAllTeacherCourses walks every page', async () => {
  const pages = [
    { data: { courses: [{ id: '1', name: 'Gov A' }], nextPageToken: 'p2' } },
    { data: { courses: [{ id: '2', name: 'Gov B', section: 'Period 3' }] } },
  ]
  let i = 0
  const fake = { courses: { list: async () => pages[i++] } }
  const courses = await listAll(fake)
  eq(courses.length, 2, 'a teacher with >1 page used to silently lose classes; count: ')
  eq(courses[1].section, 'Period 3', 'section: ')
})

checkAsync('listAllTeacherCourses stops at the page cap', async () => {
  let calls = 0
  const fake = { courses: { list: async () => { calls++; return { data: { courses: [], nextPageToken: 'always' } } } } }
  await gc.listAllTeacherCourses(fake, { maxPages: 3 })
  eq(calls, 3, 'call count: ')
})

async function listAll(fake) { return gc.listAllTeacherCourses(fake) }

// ─── Stale coursework detection ──────────────────────────────────────────────
checkAsync('courseWorkExists is false when Google 404s', async () => {
  const fake = { courses: { courseWork: { get: async () => { throw Object.assign(new Error('gone'), { response: { status: 404 } }) } } } }
  eq(await gc.courseWorkExists(fake, 'c1', 'cw1'), false)
})

checkAsync('courseWorkExists is false for DELETED state', async () => {
  const fake = { courses: { courseWork: { get: async () => ({ data: { state: 'DELETED' } }) } } }
  eq(await gc.courseWorkExists(fake, 'c1', 'cw1'), false)
})

checkAsync('courseWorkExists is true for a live post', async () => {
  const fake = { courses: { courseWork: { get: async () => ({ data: { state: 'PUBLISHED' } }) } } }
  eq(await gc.courseWorkExists(fake, 'c1', 'cw1'), true)
})

checkAsync('courseWorkExists assumes present on a non-404 error', async () => {
  // Guessing "gone" on a transient failure would post a duplicate assignment
  // into a live class — the worse of the two mistakes.
  const fake = { courses: { courseWork: { get: async () => { throw Object.assign(new Error('boom'), { response: { status: 500 } }) } } } }
  eq(await gc.courseWorkExists(fake, 'c1', 'cw1'), true)
})

// ─── Due-date conversion (mirrors the server's dueDateTime handling) ─────────
function dueFields(dueDateTime) {
  const dt = new Date(dueDateTime)
  return {
    dueDate: { year: dt.getUTCFullYear(), month: dt.getUTCMonth() + 1, day: dt.getUTCDate() },
    dueTime: { hours: dt.getUTCHours(), minutes: dt.getUTCMinutes() },
  }
}

check('due date converts to UTC fields Google expects', () => {
  const { dueDate, dueTime } = dueFields('2026-09-15T23:59:00.000Z')
  eq(dueDate.year, 2026); eq(dueDate.month, 9); eq(dueDate.day, 15)
  eq(dueTime.hours, 23); eq(dueTime.minutes, 59)
})

check('a late-evening local due date rolls to the next UTC day', () => {
  // 11:59pm Sept 15 in New York (UTC-4) is 03:59 UTC on Sept 16. Sending the
  // local calendar day would make the assignment due a day early for students.
  const { dueDate, dueTime } = dueFields('2026-09-16T03:59:00.000Z')
  eq(dueDate.day, 16, 'day: ')
  eq(dueTime.hours, 3, 'hours: ')
})

// ─── Run + report ────────────────────────────────────────────────────────────
for (const [name, fn] of asyncChecks) {
  try { await fn(); passed++ } catch (err) { failures.push(`${name}: ${err.message}`) }
}

if (failures.length) {
  console.log(`❌ ${failures.length} failed, ${passed} passed\n`)
  for (const f of failures) console.log(`   ✗ ${f}`)
  console.log('')
  process.exit(1)
}
console.log(`✅ All ${passed} Google Classroom logic tests passed\n`)
