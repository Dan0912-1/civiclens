#!/usr/bin/env node
// Regression tests for src/lib/actionDate.js and the places that read
// bills.latest_action_date as "the last thing that happened".
//
// Cases are real production rows from 2026-09-28: effective dates (GA sb160,
// MN hf3827), scheduled DC hearings (b769, b707), and Alaska/Michigan rows
// whose text names a past date but whose stamp is a few days ahead.
//
// Plain node + assert to match the other scripts/test-*.mjs checks.

import assert from 'node:assert/strict'
import { classifyActionDate, describeLatestAction, formatActionDate } from '../src/lib/actionDate.js'
import { computeScore } from '../api/billRanker.js'
import { normalizeStatus } from '../api/billSync.js'

const TODAY = '2026-09-28'
let passed = 0
function check(name, fn) {
  fn()
  passed++
  console.log(`  ok  ${name}`)
}

check('past and missing dates stay past', () => {
  assert.deepEqual(classifyActionDate('Referred to Education', '2026-09-20', TODAY), { kind: 'past', date: '2026-09-20' })
  assert.deepEqual(classifyActionDate('Passed Senate', TODAY, TODAY), { kind: 'past', date: TODAY })
  assert.deepEqual(classifyActionDate('No recent action', '', TODAY), { kind: 'past', date: '' })
})

check('future effective dates are effective', () => {
  assert.deepEqual(classifyActionDate('Effective Date', '2028-07-01', TODAY), { kind: 'effective', date: '2028-07-01' })
  assert.deepEqual(classifyActionDate('Effective date 01/01/2027', '2027-01-01', TODAY), { kind: 'effective', date: '2027-01-01' })
  assert.deepEqual(classifyActionDate('Effective 10/6/26', '2026-10-06', TODAY), { kind: 'effective', date: '2026-10-06' })
})

check('other future dates are scheduled', () => {
  assert.deepEqual(classifyActionDate('Public Hearing', '2026-10-23', TODAY), { kind: 'scheduled', date: '2026-10-23' })
  assert.deepEqual(classifyActionDate('Committee Mark-up of B26-0707', '2026-10-14', TODAY), { kind: 'scheduled', date: '2026-10-14' })
  assert.deepEqual(classifyActionDate('FN4: (CC:HB263/EED)', '2026-09-30', TODAY), { kind: 'scheduled', date: '2026-09-30' })
})

check('a past date written in the text wins over a future stamp', () => {
  assert.deepEqual(classifyActionDate('VETOED BY GOVERNOR 8/31/26', '2026-09-30', TODAY), { kind: 'past', date: '2026-08-31' })
  assert.deepEqual(classifyActionDate('PERMANENTLY FILED 9/22 LEGIS RESOLVE 34', '2026-09-30', TODAY), { kind: 'past', date: '2026-09-22' })
  assert.deepEqual(classifyActionDate('Bill Electronically Reproduced 09/24/2026', '2026-09-29', TODAY), { kind: 'past', date: '2026-09-24' })
  assert.deepEqual(classifyActionDate('EFFECTIVE DATE(S) OF LAW 9/10/26', '2026-09-30', TODAY), { kind: 'past', date: '2026-09-10' })
})

check('display copy', () => {
  assert.equal(formatActionDate('2028-07-01'), 'Jul 1, 2028')
  assert.deepEqual(describeLatestAction('Effective Date', '2028-07-01', TODAY),
    { kind: 'effective', label: 'Takes effect', text: 'Jul 1, 2028', date: '' })
  assert.deepEqual(describeLatestAction('Public Hearing', '2026-10-23', TODAY),
    { kind: 'scheduled', label: 'Scheduled', text: 'Public Hearing on Oct 23, 2026', date: '' })
  assert.deepEqual(describeLatestAction('No recent action', '2026-10-23', TODAY),
    { kind: 'scheduled', label: 'Scheduled', text: 'Oct 23, 2026', date: '' })
  assert.deepEqual(describeLatestAction('Passed House', '2026-09-01', TODAY),
    { kind: 'past', label: 'Last action', text: 'Passed House', date: '2026-09-01' })
})

// Real "today" here: the ranker computes recency against the clock.
const iso = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const base = { full_text: true, text_word_count: 2000, topics: ['education'], title: 'An act concerning schools', bill_type: 'sb', jurisdiction: 'GA' }
const score = (b) => computeScore({ ...base, ...b })

check('ranker: a future effective date earns no recency', () => {
  const effective = score({ status_stage: 'introduced', latest_action: 'Effective Date', latest_action_date: iso(640) })
  const stale = score({ status_stage: 'introduced', latest_action: 'Referred to committee', latest_action_date: iso(-400) })
  const fresh = score({ status_stage: 'introduced', latest_action: 'Referred to committee', latest_action_date: iso(-3) })
  assert.equal(effective, stale)
  assert.equal(fresh - effective, 25)
  const enacted = score({ status_stage: 'enacted', latest_action: 'Effective Date', latest_action_date: iso(640) })
  const oldLaw = score({ status_stage: 'enacted', latest_action: 'Signed by Governor', latest_action_date: iso(-400) })
  assert.equal(enacted, oldLaw) // keeps the enacted-law floor
})

check('ranker: a scheduled event counts as today', () => {
  const hearing = score({ status_stage: 'in_committee', latest_action: 'Public Hearing', latest_action_date: iso(20) })
  const today = score({ status_stage: 'in_committee', latest_action: 'Public Hearing', latest_action_date: iso(0) })
  assert.equal(hearing, today)
})

check('normalizeStatus: effective-date actions are enacted', () => {
  for (const text of ['Effective Date', 'Effective date 01/01/2027', 'Effective 10/6/26', '(H) EFFECTIVE DATE(S) OF LAW 1/1/27', "Effective without Governor's signature"]) {
    assert.equal(normalizeStatus('bill', text), 'enacted', text)
  }
  assert.equal(normalizeStatus('bill', 'Amendment to effective date adopted'), 'introduced')
  assert.equal(normalizeStatus('bill', 'Public Hearing'), 'introduced')
})

console.log(`\n${passed} action-date checks passed`)
