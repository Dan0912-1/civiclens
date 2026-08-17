// Canonical bill URL builder, shared by BillCard, FeaturedBills, and BillDetail.
//
// Federal bills live at /bill/:congress/:type/:number and resolve from the path.
// State bills live at the clean, path-resolvable /states/:state/:session/:type/:number
// (session is in the path because state bill numbers repeat across sessions).
//
// The session slug logic MUST match slugifySession in api/stateBills.js so the
// links the app emits resolve against the same rows the backend sitemap lists.

// congress.gov path segment per federal bill type. Verified against the
// Congress.gov API's own legislationUrl field for the 119th Congress.
//
// This mirrors FEDERAL_TYPE_PATHS in api/civicLinks.js. The two cannot share a
// module: .vercelignore excludes api/ from the frontend deploy, so importing
// across that boundary would break the Vercel build. scripts/test-civic-links.mjs
// asserts the two maps stay identical.
export const FEDERAL_TYPE_PATHS = {
  hr: 'house-bill',
  s: 'senate-bill',
  hres: 'house-resolution',
  sres: 'senate-resolution',
  hjres: 'house-joint-resolution',
  sjres: 'senate-joint-resolution',
  hconres: 'house-concurrent-resolution',
  sconres: 'senate-concurrent-resolution',
}

/**
 * The public congress.gov page for a federal bill.
 *
 * Returns null for an unrecognized type rather than guessing. The previous
 * inline version fell back to "house-joint-resolution" for anything that
 * wasn't s/hr/sjres, which silently mislabeled every hres, sres, hconres and
 * sconres in the feed.
 */
export function congressGovUrl(congress, type, number) {
  const path = FEDERAL_TYPE_PATHS[String(type ?? '').toLowerCase().replace(/\./g, '')]
  if (!path || !congress || number == null) return null
  return `https://www.congress.gov/bill/${congress}th-congress/${path}/${number}`
}

/**
 * The congress.gov page that opens ON the bill's text.
 *
 * Without the /text segment congress.gov lands on the Summary tab and the
 * student has to notice a row of tabs and click "Text" to reach the thing the
 * button promised them.
 */
export function congressGovTextUrl(congress, type, number) {
  const page = congressGovUrl(congress, type, number)
  return page ? `${page}/text` : null
}

// Official finders, used when we can't name a student's own lawmakers.
export const HOUSE_FINDER = 'https://www.house.gov/representatives/find-your-representative'
export const SENATE_FINDER = 'https://www.senate.gov/senators/senators-contact.htm'
export const STATE_LEGISLATOR_FINDER = 'https://openstates.org/find_your_legislator/'

/**
 * Drop the preposition left dangling when a URL is removed from mid-sentence.
 *
 * "Email your representative at <url>." becomes "Email your representative at ."
 * once the finder link is pulled out, so trim the trailing connector and
 * re-terminate the sentence. Operates on the parts array produced by
 * splitActionText.
 */
export function trimDanglingConnector(parts) {
  const out = parts.slice()
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i].href) break
    // Strip the existing terminator first, then the connector, then put a
    // single period back. Trimming the connector before the punctuation left
    // "representative.." on prose that already ended in a full stop, and a
    // fragment that was nothing but "." was treated as real text, so the scan
    // stopped there and never reached the "via" it was meant to remove.
    const stripped = out[i].text
      .replace(/[\s.,;:]+$/, '')
      .replace(/\s*\b(at|via|through|on|here)\b$/i, '')
      .replace(/[\s,;:]+$/, '')
    out[i] = { ...out[i], text: stripped ? `${stripped}.` : '' }
    if (stripped) break
  }
  return out
}

/**
 * Is this one of the generic "go find your own lawmaker" pages?
 *
 * The sanitizer rewrites every contact URL in an AI-written civic action to one
 * of these, which is safe but a dead end: the action's own prose says "email
 * your Connecticut representative" and then hands the student a national lookup
 * form that knows nothing about Connecticut. We already know their state, and
 * with a ZIP we can name the actual person — so the app should answer the
 * question itself instead of linking out to have it asked again.
 */
export function isRepFinderUrl(url) {
  const u = String(url || '').replace(/\/+$/, '').toLowerCase()
  return [HOUSE_FINDER, SENATE_FINDER, STATE_LEGISLATOR_FINDER]
    .some(f => u === f.replace(/\/+$/, '').toLowerCase())
}

/**
 * Which body votes on this bill, in the vocabulary /api/representatives speaks.
 *
 * Chamber is the whole point: a Senate bill is decided by senators and a House
 * bill by representatives, and the old lookup ignored the distinction — every
 * bill sent the reader to one state-wide directory listing both. Mirrors
 * decidingChamber in api/representatives.js; scripts/test-civic-links.mjs
 * asserts the two agree (they can't share a module — .vercelignore keeps api/
 * out of the frontend build).
 */
export function decidingChamber(bill) {
  const type = String(bill?.type ?? bill?.bill_type ?? '').toLowerCase().replace(/\./g, '')
  if (isStateBill(bill ?? {})) {
    // State chambers are named inconsistently across the 50 states (Assembly,
    // House of Delegates, General Assembly), so trust the origin chamber the
    // data gives us before falling back to the bill-type prefix.
    const origin = String(bill?.originChamber ?? '').toLowerCase()
    if (origin.includes('senate')) return 'state-upper'
    if (origin.includes('house') || origin.includes('assembly')) return 'state-lower'
    return type.startsWith('s') ? 'state-upper' : 'state-lower'
  }
  return type.startsWith('s') ? 'senate' : 'house'
}

/**
 * The official finder for whichever chamber decides this bill. Used as the
 * "look up your exact district" escape hatch in the representatives panel, and
 * as the whole answer when we have no state to work from.
 */
export function repLookupUrl(bill) {
  const chamber = decidingChamber(bill ?? {})
  if (chamber === 'state-upper' || chamber === 'state-lower') {
    // One finder that covers all 50 states.
    return STATE_LEGISLATOR_FINDER
  }
  if (chamber === 'senate') return SENATE_FINDER
  // House districts can't be derived from a state code — house.gov's finder
  // resolves one from a ZIP (asking for ZIP+4 when the ZIP spans two
  // districts), which is the piece we don't have.
  return HOUSE_FINDER
}

export function slugifySession(session) {
  return String(session ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// True when this bill-shaped object is a state (non-federal) bill. Accepts the
// feed shape (isStateBill/state) and the bills-table shape (jurisdiction).
function isStateBill(bill) {
  if (bill.isStateBill != null) return Boolean(bill.isStateBill)
  const j = bill.state ?? bill.jurisdiction
  return Boolean(j) && j !== 'US'
}

/**
 * Build the in-app href for a bill.
 *
 * State bills with a known session get the clean /states/... URL. Federal bills
 * (and the rare state bill that arrives without a session, e.g. a live search
 * hit) get the legacy /bill/... URL; for navigation we keep ?legiscan_id= on it
 * so the detail page resolves fast and exactly as before. Pass { canonical: true }
 * for share/Open-Graph links to get the clean path with no query string.
 */
export function billHref(bill, { canonical = false } = {}) {
  if (!bill) return '/'
  const type = String(bill.type ?? bill.bill_type ?? '').toLowerCase()
  const number = bill.number ?? bill.bill_number

  if (isStateBill(bill)) {
    const state = String(bill.state ?? bill.jurisdiction ?? '').toLowerCase()
    const session = slugifySession(bill.session)
    if (/^[a-z]{2}$/.test(state) && session && type && number != null) {
      return `/states/${state}/${session}/${type}/${number}`
    }
    // State bill with no resolvable session: only the legacy legiscan_id path
    // can render it. Always carry the id (even for canonical) so it isn't a 404.
    const ls = bill.legiscan_bill_id ? `?legiscan_id=${bill.legiscan_bill_id}` : ''
    return `/bill/0/${type}/${number}${ls}`
  }

  const congress = bill.congress ?? 0
  const ls = (!canonical && bill.legiscan_bill_id) ? `?legiscan_id=${bill.legiscan_bill_id}` : ''
  return `/bill/${congress}/${type}/${number}${ls}`
}
