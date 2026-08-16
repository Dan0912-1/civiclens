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
  contactUrlFor,
} from '../api/civicLinks.js'
import { congressGovUrl, repLookupUrl } from '../src/lib/billUrl.js'

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
  assert.equal(parsed.civic_actions[1].how, 'Visit https://openstates.org/find_your_legislator/ to email.')
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

test('tidying leaves a normal single-link sentence untouched', () => {
  const bill = { isStateBill: false, congress: 119, type: 'hr', number: 9544 }
  const parsed = {
    civic_actions: [
      { action: 'Read', how: 'Read the full text of the bill at https://www.congress.gov/bill/119th-congress/house-bill/9544 today.' },
    ],
  }
  sanitizeCivicActions(parsed, bill, null)
  assert.equal(
    parsed.civic_actions[0].how,
    'Read the full text of the bill at https://www.congress.gov/bill/119th-congress/house-bill/9544 today.'
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

// ── robustness ────────────────────────────────────────────────────────────
test('trailing punctuation stays prose, not part of the URL', () => {
  const bill = { isStateBill: false, congress: 119, type: 'hr', number: 9544 }
  const parsed = { civic_actions: [{ action: 'a', how: 'Read https://www.congress.gov/bill/119th-congress/house-bill/9544.' }] }
  sanitizeCivicActions(parsed, bill, null)
  assert.ok(parsed.civic_actions[0].how.endsWith('/9544.'))
})

test('missing or malformed civic_actions does not throw', () => {
  assert.doesNotThrow(() => sanitizeCivicActions({}, { isStateBill: false }))
  assert.doesNotThrow(() => sanitizeCivicActions({ civic_actions: null }, { isStateBill: false }))
  assert.doesNotThrow(() => sanitizeCivicActions({ civic_actions: [{}, null] }, { isStateBill: false }))
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

test('frontend rep lookup is jurisdiction-aware', () => {
  // A state bill must never route to a federal member lookup.
  assert.equal(
    repLookupUrl({ isStateBill: true, state: 'CT' }, 'CT'),
    'https://openstates.org/find_your_legislator/'
  )
  assert.equal(
    repLookupUrl({ jurisdiction: 'MD', bill_type: 'hb' }, 'CT'),
    'https://openstates.org/find_your_legislator/'
  )
  // Federal bills use the student's own state.
  assert.equal(
    repLookupUrl({ isStateBill: false, congress: 119, type: 'hr' }, 'CT'),
    'https://www.govtrack.us/congress/members/CT'
  )
  // "US" is a jurisdiction, not a state — it must not reach the path.
  assert.equal(
    repLookupUrl({ jurisdiction: 'US', type: 'hr' }, ''),
    'https://www.congress.gov/members/find-your-member'
  )
})

if (process.exitCode) {
  console.error('civic-link tests FAILED')
} else {
  console.log(`✓ civic-link tests passed (${passed} cases)`)
}
