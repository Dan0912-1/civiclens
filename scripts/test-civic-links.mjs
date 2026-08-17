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
import { isReadBillAction, splitActionText } from '../src/lib/actionLinks.js'
import { formatBillText } from '../src/lib/billText.js'

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

test('the dedicated reader suppresses only duplicate read-bill actions', () => {
  assert.equal(isReadBillAction({
    action: 'Read the bill',
    how: 'Visit https://www.congress.gov/example/text to read the full text.',
  }), true)
  assert.equal(isReadBillAction({
    action: 'Track the bill',
    how: 'Review its status every week.',
  }), false)
  assert.equal(isReadBillAction({
    action: 'Research the issue',
    how: 'Read reports from several sources.',
  }), false)
})

test('bill text formatting rejoins hard wraps and preserves structure', () => {
  const blocks = formatBillText([
    'SECTION 1. SHORT TITLE.',
    '',
    'This Act may be cited as the',
    '“Student Civic Literacy Act”.',
    '',
    '(a) In general.—The Secretary shall',
    'publish the required materials.',
  ].join('\n'))
  assert.deepEqual(blocks, [
    { type: 'heading', level: 2, marker: 'SECTION 1.', text: 'SHORT TITLE.' },
    { type: 'paragraph', text: 'This Act may be cited as the “Student Civic Literacy Act”.' },
    { type: 'provision', marker: '(a)', depth: 0, text: 'In general.—The Secretary shall publish the required materials.' },
  ])
})

test('bill text formatting decodes GPO amendment markup and one-line sections', () => {
  const blocks = formatBillText(
    '&lt;DOC&gt; &lt;DELETED&gt;SECTION 1. OLD TITLE.&lt;/DELETED&gt; '
    + 'SEC. 2. CURRENT SYSTEM. The Secretary shall act. (1) First requirement. (2) Second requirement.'
  )
  assert.deepEqual(blocks, [
    { type: 'heading', level: 2, marker: 'SECTION 1.', text: 'OLD TITLE.', deleted: true },
    { type: 'heading', level: 2, marker: 'SEC. 2.', text: 'CURRENT SYSTEM.' },
    { type: 'paragraph', text: 'The Secretary shall act.' },
    { type: 'provision', marker: '(1)', depth: 0, text: 'First requirement.' },
    { type: 'provision', marker: '(2)', depth: 0, text: 'Second requirement.' },
  ])
})

test('bill text formatting classifies export metadata and cleans GPO typography', () => {
  const blocks = formatBillText(
    '[Congressional Bills 119th Congress] [From GPO]\n\nThis is the ``current text\'\'.'
  )
  assert.deepEqual(blocks, [
    { type: 'metadata', text: '[Congressional Bills 119th Congress] [From GPO]' },
    { type: 'paragraph', text: 'This is the “current text”.' },
  ])
})

test('bill text formatting does not split an internal subsection reference', () => {
  const blocks = formatBillText(
    "SEC. 2. SYSTEM. Section 10 is amended— (1) by inserting after subsection (k) the following: ``(A) New rule.--Apply it.''"
  )
  assert.deepEqual(blocks, [
    { type: 'heading', level: 2, marker: 'SEC. 2.', text: 'SYSTEM.' },
    { type: 'paragraph', text: 'Section 10 is amended—' },
    { type: 'provision', marker: '(1)', depth: 0, text: 'by inserting after subsection (k) the following:' },
    { type: 'provision', marker: '(A)', depth: 1, quoted: true, text: 'New rule.—Apply it.' },
  ])
})

test('bill text formatting preserves coordinated hyphens', () => {
  const blocks = formatBillText('Use privacy- and security-enhancing tools, not a user- friendly export.')
  assert.deepEqual(blocks, [
    { type: 'paragraph', text: 'Use privacy- and security-enhancing tools, not a user-friendly export.' },
  ])
})

test('bill text formatting removes GPO PDF line numbers and page furniture', () => {
  const blocks = formatBillText(
    'Tech-18 nology, including frameworks, con-19 sistent with section 2(c) of the Na-20 tional Institute of Standards and 21 Technology Act (15 U.S.C. 272(c)), or 22 any relevant successor of such frame-23 works; 24 VerDate Sep 11 2014 02:29 Aug 05, 2026 Jkt 069200 PO 00000 Frm 00005 Fmt 6652 Sfmt 6401 E:\\BILLS\\S2511.RS S2511 kjohnson on DSK7ZCZBW3PROD with $$_JOB — 5 of 72 — 6 •S 2511 RS ‘‘(v) follow Federal data minimization 1 practices to ensure only the minimum'
  )
  assert.deepEqual(blocks, [
    {
      type: 'paragraph',
      text: 'Technology, including frameworks, consistent with section 2(c) of the National Institute of Standards and Technology Act (15 U.S.C. 272(c)), or any relevant successor of such frameworks;',
    },
    {
      type: 'provision',
      marker: '(v)',
      depth: 0,
      quoted: true,
      text: 'follow Federal data minimization practices to ensure only the minimum',
    },
  ])
})

// ── GPO PDF margin numbers ────────────────────────────────────────────────
// Text extracted from a typeset GPO PDF carries a margin number for every
// printed line. They arrive in two forms — bare between two words, and
// swallowed by a word that wrapped across the line — and both have to be
// counted together for the run to be recognisable at all.
const GPO_FOOTER = 'VerDate Sep 11 2014 02:29 Aug 05, 2026 Jkt 069200 PO 00000 Frm 00002 '
  + 'Fmt 6652 Sfmt 6401 E:\\BILLS\\S2511.RS S2511kjohnson on DSK7ZCZBW3PROD with $$_JOB 3 •S 2511 RS'

test('bill text formatting removes GPO margin numbers in both forms', () => {
  const blocks = formatBillText(
    '``(i) accurately evaluate student enrollment patterns, progres-19 sion, completion, and '
    + 'postcollegiate outcomes; 20 ``(ii) assist with transparency, institu-21 tional improvement, '
    + 'and analysis of Fed-22 eral aid programs; 23 ``(iii) provide accurate, complete, and 24 '
    + 'customizable information for students and 25 ' + GPO_FOOTER + ' families making decisions '
    + 'about postsec-1 ondary education; and 2 ``(iv) reduce the reporting burden on 3 institutions '
    + 'of higher education, in accord-4 ance with section 5 of the College Trans-5 parency Act. 6 '
    + '``(B) AVOIDING DUPLICATED REPORT-7 ING.--Notwithstanding any other provision of 8 this section.'
  )
  const joined = blocks.map(block => block.text).join(' ')
  // Every wrapped word is rejoined, including across the page footer.
  assert.match(joined, /enrollment patterns, progression, completion/)
  assert.match(joined, /institutional improvement, and analysis of Federal aid programs/)
  assert.match(joined, /information for students and families making decisions/)
  assert.match(joined, /about postsecondary education/)
  assert.match(joined, /reduce the reporting burden on institutions of higher education/)
  // The small-caps heading breaks uppercase rather than lowercase.
  assert.match(joined, /AVOIDING DUPLICATED REPORTING/)
  // Nothing of the printed page survives.
  assert.doesNotMatch(joined, /VerDate|DSK7ZCZBW3PROD|[•●]|S2511/)
  assert.doesNotMatch(joined, /\b\d{1,2}\b(?! of the College)/)
})

test('bill text formatting repairs small-caps provision headings', () => {
  // The PDF sets these in small caps with a full-size initial; extraction
  // splits the initial off and drifts the closing period away from the word.
  const blocks = formatBillText(
    '``(i) evaluate patterns, progres-11 sion; 12 ``(ii) assist with transpar-13 ency; 14 '
    + '``(A) E STABLISHMENT OF SYSTEM .--Not later 15 than 4 years after enactment; 16 '
    + '``(B) A VOIDING DUPLICATED REPORTING .--Notwith-17 standing any other provision. 18 '
    + GPO_FOOTER
  )
  const joined = blocks.map(block => block.text).join(' ')
  assert.match(joined, /ESTABLISHMENT OF SYSTEM\.—Not later than 4 years/)
  assert.match(joined, /AVOIDING DUPLICATED REPORTING\.—Notwithstanding any other provision/)
})

test('bill text formatting keeps a citation that lands on the margin count', () => {
  // "section 5 of the College Trans-5 parency Act" holds both a citation and
  // the real margin number, and only one of them may go. Deleting the citation
  // rewrites the law.
  const blocks = formatBillText(
    '``(i) evaluate enrollment patterns, progres-19 sion and completion; 20 ``(ii) assist with '
    + 'transparency, institu-21 tional improvement; 22 ``(iii) provide accurate and 23 customizable '
    + 'information for students and 24 families making decisions; and 25 ``(iv) reduce the reporting '
    + 'burden on 26 institutions of higher education, in accord-27 ance with section 5 of the College '
    + 'Trans-28 parency Act. 29 ' + GPO_FOOTER + ' ``(B) Other provisions apply.'
  )
  const joined = blocks.map(block => block.text).join(' ')
  assert.match(joined, /in accordance with section 5 of the College Transparency Act/)
})

test('bill text formatting removes a margin number that only looks cited', () => {
  // A citing word before the number is not enough — a citation names what it
  // points into. "this paragraph 3 shall not include" is a broken line.
  const blocks = formatBillText(
    '``(i) evaluate enrollment patterns, progres-11 sion; 12 ``(ii) assist with transpar-13 ency; 14 '
    + '``(iii) any aggregate information described in this paragraph 15 shall not include personally '
    + 'identifiable information, 16 consistent with any relevant Federal law 17 relating to privacy, '
    + 'and with chapter 35 of title 44, United 18 States Code. 19 ' + GPO_FOOTER
  )
  const joined = blocks.map(block => block.text).join(' ')
  assert.match(joined, /described in this paragraph shall not include/)
  assert.match(joined, /relevant Federal law relating to privacy/)
  // The real citation in the same sentence survives.
  assert.match(joined, /chapter 35 of title 44, United States Code/)
})

test('bill text formatting keeps ordinary statutory numbers without GPO page furniture', () => {
  const blocks = formatBillText('Section 2 applies within 5 years to 21 institutions and 15 U.S.C. 272(c).')
  assert.deepEqual(blocks, [
    { type: 'paragraph', text: 'Section 2 applies within 5 years to 21 institutions and 15 U.S.C. 272(c).' },
  ])
})

// ── Reconstructed nesting ─────────────────────────────────────────────────
// Our stored copies are whitespace-collapsed, so the indentation the printed
// bill uses to show nesting is gone. Depth has to come back from the markers.
test('bill text formatting nests provisions down the drafting ladder', () => {
  const blocks = formatBillText(
    'SEC. 2. RULES. (a) In general.—Section 601 is amended— (1) by striking the first sentence; '
    + 'and (2) by adding at the end the following: ``(A) any direct effect; and ``(B) any indirect effect. '
    + '``(i) a rule about veterans; or ``(ii) a rule about rates.'
  )
  assert.deepEqual(
    blocks.filter(block => block.type === 'provision').map(block => [block.marker, block.depth]),
    [['(a)', 0], ['(1)', 1], ['(2)', 1], ['(A)', 2], ['(B)', 2], ['(i)', 3], ['(ii)', 3]]
  )
})

test('bill text formatting places an amendment that starts mid-sequence', () => {
  // Amendments quote existing statute, so an inserted list routinely opens at
  // "(9)" rather than "(1)". It is still a paragraph one level under "(b)".
  const blocks = formatBillText(
    'SEC. 3. DEFINITIONS. (b) Indirect effects.—Section 601 is amended by adding at the end the following: '
    + '``(9) Economic impact.--The term `economic impact\' means-- ``(A) any direct economic effect.'
  )
  assert.deepEqual(
    blocks.filter(block => block.type === 'provision').map(block => [block.marker, block.depth]),
    [['(b)', 0], ['(9)', 1], ['(A)', 2]]
  )
})

test('bill text formatting restarts a level rather than nesting it in itself', () => {
  // The ladder alternates kinds, so a second quoted statute opening at "(a)"
  // sits beside the earlier subsections, not inside them.
  const blocks = formatBillText(
    'SEC. 5. AMENDMENTS. (a) First.—Do a thing. (b) Second.—Do another. (c) Third.—Section 9 is amended '
    + 'to read as follows: ``(a) In general.--The Secretary shall report.'
  )
  assert.deepEqual(
    blocks.filter(block => block.type === 'provision').map(block => [block.marker, block.depth]),
    [['(a)', 0], ['(b)', 0], ['(c)', 0], ['(a)', 0]]
  )
})

test('bill text formatting reads a nested single quote as a quotation', () => {
  const blocks = formatBillText("SEC. 2. TERMS. (1) Rule.--The term `rule' has the meaning given.")
  assert.equal(blocks.at(-1).text, 'Rule.—The term ‘rule’ has the meaning given.')
})

test('bill text formatting splits siblings joined by a coordinating clause', () => {
  const blocks = formatBillText(
    'SEC. 4. AMENDMENTS. (1) Analysis.—Section 604(a) is amended— (A) by redesignating paragraph (6) '
    + 'as paragraph (7); and (B) in paragraph (6), by striking the heading.'
  )
  assert.deepEqual(
    blocks.filter(block => block.type === 'provision').map(block => block.marker),
    ['(1)', '(A)', '(B)']
  )
})

// ── State print artifacts ─────────────────────────────────────────────────
// Connecticut prints a margin line number beside every line and a running
// header on every page. Extraction drops both straight into the prose.
test('bill text formatting removes state margin line numbers', () => {
  const blocks = formatBillText(
    'Be it enacted by the Senate and House of Representatives in General Assembly convened: '
    + 'Section 1. Subsection (b) of section 10-66bb of the general 1 statutes is repealed and the '
    + 'following is substituted in lieu thereof 2 (Effective July 1, 2026): 3 Any organization that '
    + 'is exempt from taxation 4 under Section 501(c)(3) of the Internal Revenue Code of 1986, or any 5 '
    + 'subsequent corresponding internal revenue code of the United States, 6 as amended from time to '
    + 'time, may apply to the Commissioner of 7 Education for a certificate of approval, provided no 8 '
    + 'nonpublic school may be established as a charter school and no 9 parent may establish a charter '
    + 'school for home instruction. 10'
  )
  const joined = blocks.map(block => block.text).join(' ')
  assert.match(joined, /exempt from taxation under Section 501\(c\)\(3\)/)
  assert.match(joined, /Commissioner of Education for a certificate/)
  // The real statutory citations in the same sentence must survive.
  assert.match(joined, /section 10-66bb/)
  assert.match(joined, /Internal Revenue Code of 1986/)
})

test('bill text formatting does not apply GPO PDF repairs to state bills', () => {
  // A state page counter looks like GPO's, but the GPO hyphen repair reads a
  // margin number that follows a hyphenated word as part of that word and
  // deletes it — which used to break the line-number run and strand its first
  // few numbers in the prose.
  const blocks = formatBillText(
    'Be it enacted by the Senate and House of Representatives in General Assembly convened: '
    + 'Section 1. (Effective from passage) Notwithstanding any 1 provision of title 26 of the general '
    + 'statutes, any person who violates any 2 regulation concerning the taking of striped bass, '
    + 'whether in the marine 3 or inland waters of the state, shall have committed an infraction 4 '
    + 'and shall be fined two hundred fifty dollars for a first offense, three 5 hundred fifty dollars '
    + 'for a second offense, by mail, or plead not guilty in 6 accordance with section 51-164n of the '
    + 'general statutes, provided the 7 amount of such fine shall be paid to the municipality where the 8 '
    + 'infraction occurred. 9 (a) Notwithstanding the provisions of this title, no person shall 10 '
    + 'engage in the hand-harvesting of horseshoe crabs or the eggs of 11 '
    + '-- 1 of 3 -- Raised Bill No. 5333 LCO No. 1651 2 of 3 horseshoe crabs from the waters of this state. 12'
  )
  const joined = blocks.map(block => block.text).join(' ')
  assert.match(joined, /Notwithstanding any provision of title 26 of the general statutes/)
  assert.match(joined, /violates any regulation concerning/)
  assert.match(joined, /whether in the marine or inland waters/)
  assert.match(joined, /the eggs of horseshoe crabs from the waters/)
  // The hyphenated word must survive intact, and real citations with it.
  assert.match(joined, /hand-harvesting of horseshoe crabs/)
  assert.match(joined, /section 51-164n/)
})

test('bill text formatting strips a line-number run with one number missing', () => {
  // Page furniture can swallow a printed number. The run either side of the
  // hole is one run, not two.
  const numbered = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12]
  const source = 'Be it enacted by the Senate and House of Representatives in General Assembly convened: '
    + 'Section 1. The commissioner shall act '
    + numbered.map(n => `and take further steps as required ${n}`).join(' ')
  const joined = formatBillText(source).map(block => block.text).join(' ')
  assert.equal(/\b\d+\b/.test(joined.replace('Section 1.', '')), false, joined)
})

test('bill text formatting does not read an annotation as an enumerator', () => {
  // "(NEW)" flags a section that creates law rather than amending it, and
  // "(ENV)" names the committee of reference. Neither is a rung on the ladder.
  const blocks = formatBillText(
    'Be it enacted by the Senate and House of Representatives in General Assembly convened: '
    + 'Section 1. (NEW) (Effective July 1, 2026) The department shall submit a report. '
    + 'Sec. 2. (a) The board shall act.'
  )
  assert.deepEqual(
    blocks.filter(block => block.type === 'provision').map(block => block.marker),
    ['(a)']
  )
  assert.match(
    blocks.find(block => block.type === 'paragraph').text,
    /^\(NEW\) \(Effective July 1, 2026\) The department/
  )
})

test('bill text formatting removes the Connecticut running page header', () => {
  const blocks = formatBillText(
    'Be it enacted by the Senate and House of Representatives in General Assembly convened: '
    + 'Section 1. The commissioners shall jointly -- 5 of 11 -- Substitute Bill No. 138 LCO 6 of 11 '
    + 'submit a report to the joint standing committee.'
  )
  assert.equal(
    blocks.at(-1).text,
    'The commissioners shall jointly submit a report to the joint standing committee.'
  )
})

test('bill text formatting strikes bracketed state repeals inline', () => {
  const blocks = formatBillText(
    'Be it enacted by the Senate and House of Representatives in General Assembly convened: '
    + 'Section 1. The board shall review [, annually,] all applications.'
  )
  const provision = blocks.at(-1)
  assert.equal(provision.text, 'The board shall review , annually, all applications.')
  assert.deepEqual(provision.runs, [
    { text: 'The board shall review ', struck: false },
    { text: ', annually,', struck: true },
    { text: ' all applications.', struck: false },
  ])
})

test('bill text formatting leaves federal brackets alone', () => {
  // Only state drafting uses brackets to mark repeals; federal text must keep
  // them verbatim.
  const blocks = formatBillText('SEC. 2. RULES. The Secretary shall publish [Reserved] guidance.')
  assert.equal(blocks.at(-1).text, 'The Secretary shall publish [Reserved] guidance.')
  assert.equal(blocks.at(-1).runs, undefined)
})

test('bill text formatting keeps a state act title in one piece', () => {
  const blocks = formatBillText(
    'AN ACT CONCERNING GAMING. Be it enacted by the Senate and House of Representatives in General Assembly convened:'
  )
  assert.equal(blocks[0].type, 'display')
  assert.equal(blocks[0].text, 'AN ACT CONCERNING GAMING.')
})

test('bill text formatting splits mixed-case state section labels', () => {
  const blocks = formatBillText(
    'Be it enacted by the Senate and House of Representatives in General Assembly convened: '
    + 'Section 1. (Effective July 1, 2026) The town shall act. Sec. 2. Subsection (h) of section '
    + '10-264l is repealed.'
  )
  assert.deepEqual(
    blocks.filter(block => block.type === 'heading').map(block => block.marker),
    ['Section 1.', 'Sec. 2.']
  )
})

test('bill text formatting reads the federal masthead', () => {
  const blocks = formatBillText(
    '[Congressional Bills 119th Congress] 119th CONGRESS 2d Session S. 5178 To amend chapter 6 of title 5.'
  )
  assert.equal(blocks.find(block => block.type === 'masthead').text, 'S. 5178 · 119th CONGRESS · 2d Session')
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
