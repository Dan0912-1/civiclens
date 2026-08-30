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

// ─── Due dates ───────────────────────────────────────────────────────────────
// Regression cases for a bug that was live in a real course: Google held
// dueDate {2026,6,24} + dueTime {23,59}, i.e. 23:59 UTC, which Classroom showed
// as 7:59 PM Eastern. The teacher had asked for the end of that day.
const FUTURE = Date.parse('2026-09-01T00:00:00Z')

check('due fields are the UTC parts of the absolute instant', () => {
  const out = gc.buildDueFields('2026-09-15T23:59:00.000Z', { now: FUTURE })
  eq(out.dueDate.year, 2026); eq(out.dueDate.month, 9); eq(out.dueDate.day, 15)
  eq(out.dueTime.hours, 23); eq(out.dueTime.minutes, 59)
})

check('a late-evening local due date rolls to the next UTC day', () => {
  // 11:59pm Sept 15 in New York (UTC-4) is 03:59 UTC on Sept 16. Sending the
  // local calendar day instead is exactly what shifted due times four hours.
  const out = gc.buildDueFields('2026-09-16T03:59:00.000Z', { now: FUTURE })
  eq(out.dueDate.day, 16, 'day: ')
  eq(out.dueTime.hours, 3, 'hours: ')
})

check('11:59 PM local round-trips to 11:59 PM local in every US timezone', () => {
  // The property that actually matters: whatever the teacher picks is what a
  // student in the same timezone sees in Classroom.
  for (const [tz, offsetHours] of [['America/New_York', 4], ['America/Chicago', 5], ['America/Denver', 6], ['America/Los_Angeles', 7]]) {
    // 23:59 local on Sept 15 == (23:59 + offset) UTC
    const instant = new Date(Date.UTC(2026, 8, 16, (23 + offsetHours) % 24, 59))
    const out = gc.buildDueFields(instant.toISOString(), { now: FUTURE })
    const back = new Date(Date.UTC(out.dueDate.year, out.dueDate.month - 1, out.dueDate.day, out.dueTime.hours, out.dueTime.minutes))
    const shown = back.toLocaleString('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' })
    eq(shown, '11:59 PM', `${tz} display: `)
  }
})

check('a past due date is flagged, not silently sent', () => {
  // Google requires a future due date and rejects the whole create with an
  // opaque 400 that we used to report as a problem with the course.
  const out = gc.buildDueFields('2026-01-01T00:00:00.000Z', { now: FUTURE })
  ok(out?.past, 'should be flagged as past')
  ok(!out.dueDate, 'must not also produce fields')
})

check('no due date and garbage due dates yield null', () => {
  eq(gc.buildDueFields(null), null)
  eq(gc.buildDueFields(''), null)
  eq(gc.buildDueFields('not a date', { now: FUTURE }), null)
})

// ─── Draft links ─────────────────────────────────────────────────────────────
check('a draft falls back to the course link', () => {
  // alternateLink is only populated for PUBLISHED coursework, and draft is our
  // default — so the success screen had no link at all on the common path.
  eq(gc.classroomFallbackLink({ alternateLink: 'https://classroom.google.com/c/ABC' }, 'ABC'),
     'https://classroom.google.com/c/ABC')
  eq(gc.classroomFallbackLink(null, 'XYZ'), 'https://classroom.google.com/c/XYZ')
  eq(gc.classroomFallbackLink(null, null), null)
})

// ─── Coursework titles ───────────────────────────────────────────────────────
check('the default title leads with the bill number', () => {
  const t = gc.defaultCourseworkTitle({ type: 'hr', number: '9351', congress: 119, title: 'To amend the Servicemembers Civil Relief Act to provide relief for members of the uniformed services who homeschool their dependent children, and for other purposes.' })
  ok(t.startsWith('HR 9351: '), `got: ${t}`)
  ok(!/for other purposes/i.test(t), 'boilerplate tail should be dropped')
  ok(t.length <= gc.COURSEWORK_TITLE_MAX, `too long (${t.length}): ${t}`)
})

check('the default title truncates at a word boundary', () => {
  const long = 'To establish a comprehensive national framework for the regulation of artificial intelligence systems deployed in critical infrastructure sectors, and for other purposes.'
  const t = gc.defaultCourseworkTitle({ type: 's', number: '1', congress: 119, title: long })
  ok(t.length <= gc.COURSEWORK_TITLE_MAX, `too long (${t.length})`)
  ok(t.length < long.length, 'should have been shortened')
  // Every word that survives must be a whole word from the original.
  const words = t.replace(/^S 1: /, '').replace(/…$/, '').split(' ')
  const source = long.toLowerCase()
  for (const w of words) {
    ok(source.includes(w.toLowerCase().replace(/[,;:]$/, '')), `"${w}" is not a whole word from the title: ${t}`)
  }
})

check('state bills carry their state in the label', () => {
  const t = gc.defaultCourseworkTitle({ type: 'hb', number: '5001', state: 'ct', session: '2026 Regular Session', title: 'An Act Concerning School Meals' })
  ok(t.startsWith('CT HB 5001: '), `got: ${t}`)
})

check('a short title is left alone', () => {
  const t = gc.defaultCourseworkTitle({ type: 'hr', number: '42', congress: 119, title: 'Limit retainage in certain private construction projects' })
  eq(t, 'HR 42: Limit retainage in certain private construction projects')
})

check('a missing title still produces something postable', () => {
  // Google rejects an empty title, so this must never come back blank.
  ok(gc.defaultCourseworkTitle({ type: 'hr', number: '42', congress: 119 }).length > 0)
  ok(gc.defaultCourseworkTitle(null).length > 0)
  ok(gc.defaultCourseworkTitle({}).length > 0)
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
