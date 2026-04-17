// Canonical bill-id generator. Historically BillDetail, Results, Search,
// BillCard, AssignBillModal, etc. each had their own template literal, and
// they disagreed on case (`hr123-119` vs `HR123-119`), which let the same
// bill bookmark itself twice and split interaction history into two buckets.
// Everything now goes through this one helper.

/**
 * Build the canonical bill id from a bill-shaped object.
 * - LegiScan-backed bills: `ls-<legiscan_bill_id>`
 * - Everything else: `<type-lower><number>-<congress>`  (e.g. `hr123-119`)
 *
 * Accepts both Congress.gov shape (type/number) and bills-table shape
 * (bill_type/bill_number) because the caller doesn't always know which
 * API surface produced the object.
 */
export function makeBillId(bill) {
  if (!bill) return ''
  if (bill.legiscan_bill_id) return `ls-${bill.legiscan_bill_id}`
  const type = bill.type ?? bill.bill_type ?? ''
  const number = bill.number ?? bill.bill_number ?? ''
  const congress = bill.congress ?? bill.session ?? ''
  return `${String(type).toLowerCase()}${number}-${congress}`
}

/**
 * Variant for callers that only have loose route params (string `type`,
 * string `number`, string `congress`). Keeps callers from having to
 * build a fake bill just to call makeBillId.
 */
export function makeCongressBillId(type, number, congress) {
  return `${String(type || '').toLowerCase()}${number}-${congress}`
}

/**
 * Case-insensitive equality for bill ids. Used when comparing an id we
 * just built (lowercase) against rows already stored in the database
 * from legacy uppercase code paths.
 */
export function sameBillId(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase()
}

// Fields the server attaches to /api/legislation results for its own
// internal use (state-bill full text + CRS summary). They can each be tens
// of KB; a batch of state bills that includes them blows past the server's
// 2 MB body limit and 413s. The server already re-fetches text from its DB
// when the field is absent, so stripping here is safe.
const SERVER_INTERNAL_BILL_FIELDS = [
  '_localText',
  '_localCrsSummary',
  '_localTextWordCount',
  '_localTextVersion',
]

/**
 * Strip large server-internal fields from a bill before posting it back
 * to /api/personalize-batch. Use for any client → server round-trip that
 * sends bills the server already has indexed.
 */
export function stripBillForPersonalize(bill) {
  if (!bill || typeof bill !== 'object') return bill
  const out = { ...bill }
  for (const k of SERVER_INTERNAL_BILL_FIELDS) delete out[k]
  return out
}
