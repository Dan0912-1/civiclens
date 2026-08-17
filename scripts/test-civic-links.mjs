#!/usr/bin/env node
// Regression tests for api/civicLinks.js.
//
// Every case below is a real failure observed in the production
// personalization_cache, not a hypothetical. The worst of them — a STATE bill
// whose "read the bill" action linked to a real but unrelated FEDERAL bill —
// is the reason this module exists.
//
// Plain node + assert to match the other scripts/ci-*.mjs checks (no framework).

import assert from 'node:assert/strict'
import {
  sanitizeCivicActions,
  federalBillUrl,
  federalBillTextUrl,
  contactUrlFor,
} from '../api/civicLinks.js'
import { decidingChamber as apiDecidingChamber, districtsForZip, representativesFor } from '../api/representatives.js'
import {
  congressGovUrl,
  congressGovTextUrl,
  repLookupUrl,
  decidingChamber,
  isRepFinderUrl,
  trimDanglingConnector,
  HOUSE_FINDER,
  SENATE_FINDER,
  STATE_LEGISLATOR_FINDER,
} from '../src/lib/billUrl.js'
import { splitActionText } from '../src/lib/actionLinks.js'

let passed = 0
function test(name, fn) {
  try {
    fn()
    passed++
  } catch (err) {
    console.error(`\n✗ ${name}\n  ${err.message}\n`)
    process.exitCode = 1
  }
}

// ── congress.gov path segments ────────────────────────────────────────────
// Expected values come from the Congress.gov API's own legislationUrl field.
test('federal bill URLs use the correct path segment for every type', () => {
  const cases = {
    hr: 'house-bill',
    s: 'senate-bill',
    hres: 'house-resolution',
    sres: 'senate-resolution',
    hjres: 'house-joint-resolution',
    sjres: 'senate-joint-resolution',
    hconres: 'house-concurrent-resolution',
    sconres: 'senate-concurrent-resolution',
  }
  for (const [type, path] of Object.entries(cases)) {
    assert.equal(
      federalBillUrl(119, type, 42),
      `https://www.congress.gov/bill/119th-congress/${path}/42`,
      `type ${type}`
    )
  }
})

test('unknown bill type yields no URL rather than a wrong one', () => {
  assert.equal(federalBillUrl(119, 'zz', 42), null)
  assert.equal(federalBillUrl(119, '', 42), null)
})

// ── the production bug: state bills linked to federal law ─────────────────
test('state bill no longer links to an unrelated federal bill', () => {
  const bill = { isStateBill: true, state: 'MD', type: 'hb', number: 529, congress: 0 }
  const parsed = {
    civic_actions: [
      { action: 'Read', how: 'Go to https://www.congress.gov/bill/119th-congress/house-bill/529 to read it.' },
      { action: 'Contact', how: 'Visit https://www.house.gov/representatives/find-your-representative to email.' },
    ],
  }
  sanitizeCivicActions(parsed, bill, 'https://openstates.org/md/bills/2026/HB529/')
  assert.equal(parsed.civic_actions[0].how, 'Go to https://openstates.org/md/bills/2026/HB529/ to read it.')
  assert.equal(parsed.civic_actions[1].action, 'Contact your state legislators')
  assert.equal(parsed.civic_actions[1].how, 'Email your state legislators at https://openstates.org/find_your_legislator/.')
})

test('hallucinated state agency URLs are replaced', () => {
  const bill = { isStateBill: true, state: 'CT', type: 'sb', number: 475, congress: 0 }
  const parsed = {
    civic_actions: [
      { action: 'a', how: 'Visit https://www.ct.gov/ded for details.' },
      { action: 'b', how: 'See https://www.maryland.gov/CCRI now.' },
    ],
  }
  sanitizeCivicActions(parsed, bill, null)
  for (const a of parsed.civic_actions) {
    assert.ok(a.how.includes('https://openstates.org/find_your_legislator/'), a.how)
    assert.ok(!a.how.includes('ct.gov/ded'))
    assert.ok(!a.how.includes('maryland.gov'))
  }
})

test('malformed congress.gov path is not passed through', () => {
  const bill = { isStateBill: true, state: 'CT', type: 'sb', number: 475, congress: 0 }
  const parsed = { civic_actions: [{ action: 'a', how: 'Go to https://www.congress.gov/bill/119th-congress/sb/475 now.' }] }
  sanitizeCivicActions(parsed, bill, null)
  assert.equal(parsed.civic_actions[0].how, 'Go to https://openstates.org/find_your_legislator/ now.')
})

test('federal resolution link is corrected to the canonical path', () => {
  const bill = { isStateBill: false, congress: 119, type: 'hres', number: 24 }
  const parsed = { civic_actions: [{ action: 'a', how: 'See https://www.congress.gov/bill/119th-congress/house-joint-resolution/24 today.' }] }
  sanitizeCivicActions(parsed, bill, null)
  assert.equal(parsed.civic_actions[0].how, 'See https://www.congress.gov/bill/119th-congress/house-resolution/24 today.')
})

// Observed live: the model wrote "visit <rep finder> to view the full text",
// i.e. a read-the-bill action carrying a contact URL. Intent must come from the
// prose, not from whichever link the model happened to reach for.
test('read-intent action gets the bill link even when the model linked elsewhere', () => {
  const bill = { isStateBill: false, congress: 119, type: 'hr', number: 9544 }
  const parsed = {
    civic_actions: [
      { action: 'Read the bill', how: 'Visit https://www.house.gov/representatives/find-your-representative to view the full text and track progress.' },
    ],
  }
  sanitizeCivicActions(parsed, bill, null)
  assert.ok(
    parsed.civic_actions[0].how.includes('https://www.congress.gov/bill/119th-congress/house-bill/9544'),
    parsed.civic_actions[0].how
  )
})

test('contact-intent action keeps the contact link even when it cites the bill', () => {
  const bill = { isStateBill: false, congress: 119, type: 'hr', number: 9544 }
  const parsed = {
    civic_actions: [
      { action: 'Contact your rep', how: 'Email your representative about the bill at https://www.congress.gov/bill/119th-congress/house-bill/9544' },
    ],
  }
  sanitizeCivicActions(parsed, bill, null)
  assert.ok(
    parsed.civic_actions[0].how.includes('https://www.house.gov/representatives/find-your-representative'),
    parsed.civic_actions[0].how
  )
})

// Collapsing distinct model URLs onto one canonical link left visible seams in
// live output: a link printed twice joined by "and", and an orphaned path
// fragment ("<url> bill/HB5518").
test('duplicate links produced by rewriting are collapsed', () => {
  const bill = { isStateBill: false, congress: 119, type: 'hr', number: 9544 }
  const parsed = {
    civic_actions: [
      { action: 'Contact', how: 'Email them at https://www.house.gov/representatives/find-your-representative and https://www.senate.gov/senators/senators-contact.htm.' },
    ],
  }
  sanitizeCivicActions(parsed, bill, null)
  const hits = parsed.civic_actions[0].how.match(/https?:\/\//g) || []
  assert.equal(hits.length, 1, parsed.civic_actions[0].how)
})

test('orphaned path fragment after a rewritten URL is removed', () => {
  const bill = { isStateBill: true, state: 'CT', type: 'hb', number: 5518, congress: 0 }
  const parsed = {
    civic_actions: [
      { action: 'Read', how: 'Visit https://www.cga.ct.gov/2026/ bill/HB5518 to read the full text.' },
    ],
  }
  sanitizeCivicActions(parsed, bill, 'https://openstates.org/ct/bills/2026/HB5518/')
  assert.equal(
    parsed.civic_actions[0].how,
    'Visit https://openstates.org/ct/bills/2026/HB5518/ to read the full text.'
  )
})

test('tidying leaves a normal single-link sentence intact around its URL', () => {
  const bill = { isStateBill: false, congress: 119, type: 'hr', number: 9544 }
  const parsed = {
    civic_actions: [
      { action: 'Read', how: 'Read the full text of the bill at https://www.congress.gov/bill/119th-congress/house-bill/9544 today.' },
    ],
  }
  sanitizeCivicActions(parsed, bill, null)
  // The prose is untouched; the URL gains /text because this action sends the
  // student to the words of the bill, and congress.gov opens on Summary.
  assert.equal(
    parsed.civic_actions[0].how,
    'Read the full text of the bill at https://www.congress.gov/bill/119th-congress/house-bill/9544/text today.'
  )
})

// ── the Text tab ──────────────────────────────────────────────────────────
// "Read the full bill text" landing on a page with a Text tab the student has
// to find and click is a promise the button didn't keep.
test('federal text URLs open on the text itself', () => {
  assert.equal(
    federalBillTextUrl(119, 'hr', 5631),
    'https://www.congress.gov/bill/119th-congress/house-bill/5631/text'
  )
  assert.equal(federalBillTextUrl(119, 'zz', 5631), null)
  assert.equal(congressGovTextUrl(119, 's', 42), federalBillTextUrl(119, 's', 42))
})

test('a track-the-status action keeps the bill page, not the text tab', () => {
  const bill = { isStateBill: false, congress: 119, type: 'hr', number: 9544 }
  const parsed = {
    civic_actions: [
      { action: 'Track it', how: 'Follow the bill\u2019s progress at https://www.congress.gov/bill/119th-congress/house-bill/9544 each week.' },
    ],
  }
  sanitizeCivicActions(parsed, bill, null)
  assert.equal(
    parsed.civic_actions[0].how,
    'Follow the bill\u2019s progress at https://www.congress.gov/bill/119th-congress/house-bill/9544 each week.'
  )
})

// ── trust boundary ────────────────────────────────────────────────────────
test('a non-.gov, non-openstates state URL is never used', () => {
  const bill = { isStateBill: true, state: 'MD', type: 'hb', number: 529, congress: 0 }
  const parsed = { civic_actions: [{ action: 'a', how: 'Go to https://www.congress.gov/bill/119th-congress/house-bill/529 ok.' }] }
  sanitizeCivicActions(parsed, bill, 'https://evil.example.com/phish')
  assert.ok(!parsed.civic_actions[0].how.includes('evil.example.com'))
  assert.ok(parsed.civic_actions[0].how.includes('openstates.org/find_your_legislator'))
})

test('chamber routing sends senate bills to senate contacts', () => {
  assert.equal(contactUrlFor({ isStateBill: false, type: 's' }), 'https://www.senate.gov/senators/senators-contact.htm')
  assert.equal(contactUrlFor({ isStateBill: false, type: 'sjres' }), 'https://www.senate.gov/senators/senators-contact.htm')
  assert.equal(contactUrlFor({ isStateBill: false, type: 'hr' }), 'https://www.house.gov/representatives/find-your-representative')
  assert.equal(contactUrlFor({ isStateBill: true, state: 'CT' }), 'https://openstates.org/find_your_legislator/')
})

test('senate contact prose and destination name the same audience', () => {
  const bill = { isStateBill: false, congress: 119, type: 's', number: 5225 }
  const parsed = {
    civic_actions: [{ action: 'Contact representatives', how: 'Email your Connecticut state representatives at https://example.com now.' }],
  }
  sanitizeCivicActions(parsed, bill, null)
  assert.equal(parsed.civic_actions[0].action, 'Contact your U.S. senators')
  assert.match(parsed.civic_actions[0].how, /^Email your U\.S\. senators at https:\/\/www\.senate\.gov\//)
  assert.ok(!parsed.civic_actions[0].how.includes('state representatives'))
})

// ── robustness ────────────────────────────────────────────────────────────
test('trailing punctuation stays prose, not part of the URL', () => {
  const bill = { isStateBill: false, congress: 119, type: 'hr', number: 9544 }
  const parsed = { civic_actions: [{ action: 'a', how: 'Read https://www.congress.gov/bill/119th-congress/house-bill/9544.' }] }
  sanitizeCivicActions(parsed, bill, null)
  assert.ok(parsed.civic_actions[0].how.endsWith('/9544.'))
  const parts = splitActionText(parsed.civic_actions[0].how)
  const linked = parts.find(p => p.href)
  assert.equal(linked.href, 'https://www.congress.gov/bill/119th-congress/house-bill/9544')
  assert.equal(linked.trailing, '.')
})

test('missing or malformed civic_actions does not throw', () => {
  assert.doesNotThrow(() => sanitizeCivicActions({}, { isStateBill: false }))
  assert.doesNotThrow(() => sanitizeCivicActions({ civic_actions: null }, { isStateBill: false }))
  assert.doesNotThrow(() => sanitizeCivicActions({ civic_actions: [{}, null] }, { isStateBill: false }))
})

// ── serve-time re-sanitizing ──────────────────────────────────────────────
// The sanitizer runs again when a CACHED analysis is served, because entries
// live for 30 days and can predate any link fix. Two properties matter: it
// must be idempotent (a good analysis survives untouched), and it must not
// downgrade a state bill's real link just because it is re-running.
test('re-sanitizing an already-clean analysis changes nothing', () => {
  const bill = { isStateBill: false, congress: 119, type: 'hr', number: 9544 }
  const make = () => ({
    civic_actions: [
      { action: 'Read', how: 'Read the full text at https://www.congress.gov/bill/119th-congress/house-bill/9544/text today.' },
      { action: 'Contact', how: 'Email your rep via https://www.house.gov/representatives/find-your-representative now.' },
    ],
  })
  const once = make()
  sanitizeCivicActions(once, bill, null)
  const twice = JSON.parse(JSON.stringify(once))
  const report = sanitizeCivicActions(twice, bill, null)
  assert.deepEqual(twice.civic_actions, once.civic_actions)
  assert.equal(report.rewritten, 0, 'a second pass should rewrite nothing')
})

test('serve-time pass kills a hallucinated .gov link in an old cached analysis', () => {
  // Verbatim from a real cached row in personalization_cache.
  const bill = { isStateBill: true, state: 'MD', type: 'hb', number: 529, congress: 0 }
  const parsed = {
    civic_actions: [
      { action: 'Learn more', how: 'See https://www.maryland.gov/mdhhs/Pages/Medicaid.aspx for details.' },
    ],
  }
  sanitizeCivicActions(parsed, bill, 'https://openstates.org/md/bills/2026/HB529/')
  assert.ok(!parsed.civic_actions[0].how.includes('maryland.gov'), parsed.civic_actions[0].how)
})

test('re-sanitizing a state bill keeps its real bill link when we supply it', () => {
  const bill = { isStateBill: true, state: 'CT', type: 'hb', number: 5001, congress: 0 }
  const url = 'https://openstates.org/ct/bills/2026/HB5001/'
  const parsed = { civic_actions: [{ action: 'Read', how: `Read the bill at ${url} first.` }] }
  sanitizeCivicActions(parsed, bill, url)
  assert.ok(parsed.civic_actions[0].how.includes(url), parsed.civic_actions[0].how)
})

// The regression this guards: serving a cached STATE analysis without looking
// the canonical URL up would replace a working bill link with the generic
// finder — a downgrade caused by the fix itself.
test('a state bill-page link degrades to the finder only when we have no URL', () => {
  const bill = { isStateBill: true, state: 'CT', type: 'hb', number: 5001, congress: 0 }
  const url = 'https://openstates.org/ct/bills/2026/HB5001/'
  const withUrl = { civic_actions: [{ action: 'Read', how: `Read the bill at ${url}.` }] }
  const without = { civic_actions: [{ action: 'Read', how: `Read the bill at ${url}.` }] }
  sanitizeCivicActions(withUrl, bill, url)
  sanitizeCivicActions(without, bill, null)
  assert.ok(withUrl.civic_actions[0].how.includes(url))
  assert.ok(without.civic_actions[0].how.includes('openstates.org/find_your_legislator'))
})

// ── ZIP → district ────────────────────────────────────────────────────────
// The panel's job is to name a person. Before this, a student in any
// multi-district state got the whole delegation and a link to house.gov.
test('a ZIP inside one district resolves to that district', () => {
  assert.deepEqual(districtsForZip('06032'), [{ state: 'CT', district: 5 }])
  // At-large states encode district 00, which matches district 0 in the
  // member data — not a missing value.
  assert.deepEqual(districtsForZip('82001'), [{ state: 'WY', district: 0 }])
})

test('a split ZIP returns its districts ranked by share of the ZIP', () => {
  const d = districtsForZip('06001')
  assert.equal(d.length, 2)
  assert.deepEqual(d[0], { state: 'CT', district: 5 }, 'largest share first')
  assert.deepEqual(d[1], { state: 'CT', district: 1 })
})

test('malformed and unknown ZIPs resolve to nothing rather than guessing', () => {
  for (const z of ['', '0603', '060321', 'abcde', null, undefined, '00000']) {
    assert.deepEqual(districtsForZip(z), [], `zip ${JSON.stringify(z)}`)
  }
})

// ZIP+4 is a shape people type, and its first five digits are the ZIP.
test('ZIP+4 resolves to the same district as its five-digit ZIP', () => {
  assert.deepEqual(districtsForZip('06032-1234'), [{ state: 'CT', district: 5 }])
  assert.deepEqual(districtsForZip('060321234'), [{ state: 'CT', district: 5 }])
})

test('a ZIP narrows the House to one member, and marks it exact', async () => {
  const r = await representativesFor({ state: 'CT', chamber: 'house', zip: '06032' })
  assert.equal(r.members.length, 1)
  assert.equal(r.members[0].district, 5)
  assert.equal(r.exact, true)
  assert.equal(r.fromZip, true)
  assert.equal(r.delegationSize, 5, 'the state still has five seats')
})

test('a split ZIP narrows without claiming to be exact', async () => {
  const r = await representativesFor({ state: 'CT', chamber: 'house', zip: '06001' })
  assert.equal(r.members.length, 2)
  assert.equal(r.exact, false)
  assert.equal(r.reason, 'zip_spans_districts')
})

// A ZIP the student mistyped, or one from somewhere else entirely, must not
// silently name someone who doesn't represent them.
test('an unusable ZIP falls back to the full delegation', async () => {
  for (const zip of ['99999', '90210']) {
    const r = await representativesFor({ state: 'CT', chamber: 'house', zip })
    assert.equal(r.members.length, 5, `zip ${zip}`)
    assert.equal(r.fromZip, false)
    assert.equal(r.reason, 'district_unknown')
  }
})

test('a ZIP does not change the Senate answer, which is state-wide', async () => {
  const withZip = await representativesFor({ state: 'CT', chamber: 'senate', zip: '06032' })
  const without = await representativesFor({ state: 'CT', chamber: 'senate' })
  assert.equal(withZip.members.length, 2)
  assert.deepEqual(withZip.members.map(m => m.name), without.members.map(m => m.name))
  assert.equal(withZip.exact, true)
})

// ── in-app answers to "find your rep" links ───────────────────────────────
// The sanitizer rewrites an AI action's contact URL to a national finder. That
// is safe but a dead end: the prose says "email your Connecticut
// representative" and the link knows nothing about Connecticut. The client
// detects those URLs and opens our own panel instead.
test('every finder we rewrite contact links to is recognised', () => {
  for (const u of [HOUSE_FINDER, SENATE_FINDER, STATE_LEGISLATOR_FINDER]) {
    assert.equal(isRepFinderUrl(u), true, u)
    assert.equal(isRepFinderUrl(u + '/'), true, `${u} (trailing slash)`)
    assert.equal(isRepFinderUrl(u.toUpperCase()), true, `${u} (case)`)
  }
})

test('a real bill or member link is not mistaken for a finder', () => {
  for (const u of [
    'https://www.congress.gov/bill/119th-congress/house-resolution/234/text',
    'https://openstates.org/ct/bills/2026/HB5001/',
    'https://www.murphy.senate.gov/contact',
    '', null, undefined,
  ]) assert.equal(isRepFinderUrl(u), false, String(u))
})

test('removing a mid-sentence URL does not strand its preposition', () => {
  const parts = [{ text: 'Email your Connecticut representative at ', href: null, trailing: '' }]
  assert.equal(trimDanglingConnector(parts)[0].text, 'Email your Connecticut representative.')
})

// Both of these were real bugs: trimming the connector before the punctuation
// produced "representative..", and a fragment that was only "." counted as
// real text so the scan stopped before reaching the "via" it had to remove.
test('prose that already ends cleanly is left alone', () => {
  const parts = [{ text: 'Email your U.S. representative.', href: null, trailing: '' }]
  assert.equal(trimDanglingConnector(parts)[0].text, 'Email your U.S. representative.')
})

test('a lone punctuation fragment after the URL does not stop the trim', () => {
  const parts = [
    { text: 'Share your view via ', href: null, trailing: '' },
    { text: '.', href: null, trailing: '' },
  ]
  assert.equal(trimDanglingConnector(parts).map(p => p.text).join(''), 'Share your view.')
})

// ── frontend / backend drift ──────────────────────────────────────────────
// The two type maps must stay identical. They can't share a module because
// .vercelignore excludes api/ from the frontend deploy, so only a test can
// hold them together.
test('frontend and backend build identical federal bill URLs', () => {
  for (const type of ['hr', 's', 'hres', 'sres', 'hjres', 'sjres', 'hconres', 'sconres']) {
    assert.equal(
      congressGovUrl(119, type, 7),
      federalBillUrl(119, type, 7),
      `type ${type} differs between src/lib/billUrl.js and api/civicLinks.js`
    )
  }
})

test('frontend rep lookup is jurisdiction- and chamber-aware', () => {
  // A state bill must never route to a federal member lookup.
  assert.equal(
    repLookupUrl({ isStateBill: true, state: 'CT' }),
    'https://openstates.org/find_your_legislator/'
  )
  assert.equal(
    repLookupUrl({ jurisdiction: 'MD', bill_type: 'hb' }),
    'https://openstates.org/find_your_legislator/'
  )
  // A Senate bill is decided by senators; the House finder is the wrong page.
  assert.equal(
    repLookupUrl({ isStateBill: false, congress: 119, type: 's' }),
    'https://www.senate.gov/senators/senators-contact.htm'
  )
  assert.equal(
    repLookupUrl({ isStateBill: false, congress: 119, type: 'hr' }),
    'https://www.house.gov/representatives/find-your-representative'
  )
  // "US" is a jurisdiction, not a state — it must not make this a state bill.
  assert.equal(
    repLookupUrl({ jurisdiction: 'US', type: 'hr' }),
    'https://www.house.gov/representatives/find-your-representative'
  )
})

// The panel asks /api/representatives for a chamber the client computed, so
// the two implementations have to agree on every bill shape we emit.
test('frontend and backend agree on which chamber decides a bill', () => {
  const cases = [
    { isStateBill: false, type: 'hr', state: 'US' },
    { isStateBill: false, type: 's', state: 'US' },
    { isStateBill: false, type: 'sjres', state: 'US' },
    { isStateBill: false, type: 'hconres', state: 'US' },
    { isStateBill: true, state: 'CT', type: 'hb' },
    { isStateBill: true, state: 'CT', type: 'sb' },
    { isStateBill: true, state: 'CA', type: 'ab', originChamber: 'Assembly' },
    { isStateBill: true, state: 'NY', type: 'sb', originChamber: 'Senate' },
    { jurisdiction: 'MD', bill_type: 'hb' },
    { jurisdiction: 'US', bill_type: 's' },
  ]
  for (const bill of cases) {
    assert.equal(
      decidingChamber(bill),
      apiDecidingChamber(bill),
      `decidingChamber differs for ${JSON.stringify(bill)}`
    )
  }
})

test('senate bills route to senators and house bills to representatives', () => {
  assert.equal(decidingChamber({ type: 's', state: 'US' }), 'senate')
  assert.equal(decidingChamber({ type: 'sres', state: 'US' }), 'senate')
  assert.equal(decidingChamber({ type: 'hr', state: 'US' }), 'house')
  assert.equal(decidingChamber({ type: 'hjres', state: 'US' }), 'house')
  assert.equal(decidingChamber({ type: 'sb', state: 'CT', isStateBill: true }), 'state-upper')
  assert.equal(decidingChamber({ type: 'hb', state: 'CT', isStateBill: true }), 'state-lower')
})

if (process.exitCode) {
  console.error('civic-link tests FAILED')
} else {
  console.log(`✓ civic-link tests passed (${passed} cases)`)
}
