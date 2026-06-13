// Canonical bill URL builder, shared by BillCard, FeaturedBills, and BillDetail.
//
// Federal bills live at /bill/:congress/:type/:number and resolve from the path.
// State bills live at the clean, path-resolvable /states/:state/:session/:type/:number
// (session is in the path because state bill numbers repeat across sessions).
//
// The session slug logic MUST match slugifySession in api/stateBills.js so the
// links the app emits resolve against the same rows the backend sitemap lists.

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
