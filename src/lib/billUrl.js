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
 * Where to send a student who wants to contact the people voting on THIS bill.
 * State bills are decided by state legislators, so a federal member lookup is
 * the wrong destination for them.
 */
export function repLookupUrl(bill, profileState = '') {
  if (isStateBill(bill ?? {})) {
    // One finder that covers all 50 states.
    return 'https://openstates.org/find_your_legislator/'
  }
  // For a federal bill the relevant state is the STUDENT's, not the bill's —
  // and "US" is a jurisdiction, not a state, so it must never reach the path.
  const billState = String(bill?.state ?? bill?.jurisdiction ?? '').toUpperCase()
  const state = (billState && billState !== 'US' ? billState : String(profileState || '').toUpperCase())
  // GovTrack lists both senators and every House member for a state on one
  // page, which beats congress.gov's bare search form.
  return /^[A-Z]{2}$/.test(state)
    ? `https://www.govtrack.us/congress/members/${state}`
    : 'https://www.congress.gov/members/find-your-member'
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
