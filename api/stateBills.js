// Shared state-bill URL contract + resolver, used by the SEO modules
// (sitemap + dynamic renderer) and the single-bill API in server.js.
//
// WHY THIS EXISTS
// Federal bills resolve from the path alone (`/bill/119/hr/1` keys the bills
// table by congress_bill_id). State bills historically needed a ?legiscan_id=
// query to resolve, so a bare URL soft-404'd and could not be sitemapped. This
// module defines ONE clean, path-resolvable URL shape for state bills and the
// lookup that backs it, so the sitemap, the bot renderer, and the human SPA all
// agree on the same canonical URLs.
//
// URL SHAPE:  /states/:state/:session/:type/:number
//   state    lowercase 2-letter jurisdiction        e.g. "ca"
//   session  slug of the bills.session string        e.g. "2025-2026", "2025-regular-session"
//   type     lowercase bills.bill_type               e.g. "ab", "hb", "sf"
//   number   bills.bill_number (integer)             e.g. "1234"
//
// Session is part of the path because state bill numbers REPEAT across sessions
// (e.g. TX HB 1 exists in multiple sessions), so jurisdiction+type+number is not
// unique. Including the session slug makes each URL map to exactly one bill.
//
// The duplicate-declaration CI scan (scripts/ci-duplicate-scan.mjs) forbids the
// same top-level name in two api/ files, so every helper here is declared ONCE
// and imported elsewhere (imports are ignored by the scan). Notably the name is
// US_STATE_NAMES, not STATE_NAMES, because billSync.js already owns STATE_NAMES.

// Jurisdictions we do NOT sitemap. NH blocks scraping, so its rows are thin and
// we keep them out of the indexable surface. (They still render if hit directly;
// they just are not advertised.)
export const EXCLUDED_SITEMAP_JURISDICTIONS = new Set(['NH'])

// 2-letter jurisdiction code -> full name, for human-readable meta/JSON-LD.
// Mirrors billSync.js STATE_NAMES; duplicated here so the SEO modules don't have
// to import the (heavy) sync engine just for a label map.
export const US_STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
}

// Lowercase bill_type -> readable label. Covers the common state abbreviations
// seen across all 50 states + DC; unknown types fall back to the uppercased
// code (see stateBillTypeLabel), which still reads fine ("Maine LD 676").
export const STATE_BILL_TYPE_LABELS = {
  hb: 'House Bill', sb: 'Senate Bill', h: 'House Bill', s: 'Senate Bill',
  a: 'Assembly Bill', ab: 'Assembly Bill',
  hr: 'House Resolution', sr: 'Senate Resolution', ar: 'Assembly Resolution',
  hf: 'House File', sf: 'Senate File',
  ld: 'Legislative Document', lb: 'Legislative Bill', lr: 'Legislative Resolution',
  hp: 'House Paper', sp: 'Senate Paper',
  hsb: 'House Study Bill', ssb: 'Senate Study Bill',
  hjr: 'House Joint Resolution', sjr: 'Senate Joint Resolution',
  hj: 'House Joint Resolution', sj: 'Senate Joint Resolution',
  ajr: 'Assembly Joint Resolution',
  hcr: 'House Concurrent Resolution', scr: 'Senate Concurrent Resolution',
  acr: 'Assembly Concurrent Resolution',
  hjres: 'House Joint Resolution', sjres: 'Senate Joint Resolution',
  hconres: 'House Concurrent Resolution', sconres: 'Senate Concurrent Resolution',
  hres: 'House Resolution', sres: 'Senate Resolution',
  hm: 'House Memorial', sm: 'Senate Memorial',
  hjm: 'House Joint Memorial', sjm: 'Senate Joint Memorial',
  hd: 'House Docket', sd: 'Senate Docket',
  aca: 'Assembly Constitutional Amendment', sca: 'Senate Constitutional Amendment',
  jrh: 'Joint Resolution', jrs: 'Joint Resolution',
  cacr: 'Constitutional Amendment Concurrent Resolution',
  b: 'Bill', gm: 'Governor’s Message',
}

// Turn a bills.session string into a URL-safe slug. Lowercase, collapse any run
// of non-alphanumerics to a single hyphen, trim hyphens. Must stay in lockstep
// with the frontend slugifySession in src/lib/billUrl.js.
//   "2025 Regular Session" -> "2025-regular-session"
//   "2025-2026"            -> "2025-2026"
//   "114"                  -> "114"
export function slugifySession(session) {
  return String(session ?? '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function stateName(code) {
  return US_STATE_NAMES[String(code || '').toUpperCase()] || String(code || '').toUpperCase()
}

export function stateBillTypeLabel(type) {
  const t = String(type || '').toLowerCase()
  return STATE_BILL_TYPE_LABELS[t] || t.toUpperCase()
}

// A readable session phrase for prose, e.g. meta descriptions. Keeps
// already-descriptive labels ("2025 Regular Session") as-is and appends
// "session" to bare years/ranges ("2025-2026" -> "2025-2026 session").
export function sessionPhrase(session) {
  const s = String(session ?? '').trim()
  if (!s) return ''
  if (/session|assembly|legislature|regular|special/i.test(s)) return s
  return `${s} session`
}

// Build the canonical state-bill path from a bills row (or row-shaped object).
// Returns null when any field needed by the URL is missing, so a malformed row
// never lands a broken/soft-404 URL in the sitemap.
export function stateBillPath(row) {
  if (!row) return null
  const state = String(row.jurisdiction ?? row.state ?? '').toLowerCase()
  const type = String(row.bill_type ?? row.type ?? '').toLowerCase()
  const number = row.bill_number ?? row.number
  const session = slugifySession(row.session)
  if (!/^[a-z]{2}$/.test(state) || !type || number == null || number === '' || !session) {
    return null
  }
  return `/states/${state}/${session}/${type}/${number}`
}

// Resolve a single bills row from the clean-URL params. State bill numbers repeat
// across sessions, so a (jurisdiction, type, number) lookup can return several
// rows; we disambiguate by matching the session slug, and fall back to the most
// recently-acted row when the slug doesn't match (e.g. a stale shared link).
export async function resolveStateBillRow(supabase, { state, type, number, sessionSlug }) {
  if (!supabase) return null
  const jurisdiction = String(state || '').toUpperCase()
  const billType = String(type || '').toLowerCase()
  const billNumber = parseInt(number, 10)
  if (!/^[A-Z]{2}$/.test(jurisdiction) || !billType || !Number.isInteger(billNumber)) return null

  const { data, error } = await supabase
    .from('bills')
    .select('legiscan_bill_id, openstates_id, title, description, session, bill_type, bill_number, jurisdiction, status_stage, latest_action, latest_action_date, origin_chamber, url, crs_summary')
    .eq('jurisdiction', jurisdiction)
    .eq('bill_type', billType)
    .eq('bill_number', billNumber)
    .limit(20)
  if (error) {
    console.error('[stateBills] resolve error:', error.message)
    return null
  }
  const rows = data || []
  if (rows.length === 0) return null
  if (rows.length === 1) return rows[0]

  const want = slugifySession(sessionSlug)
  const matches = rows.filter(r => slugifySession(r.session) === want)
  const pool = matches.length ? matches : rows
  // Most recent action wins on a tie (or when the session slug doesn't match any).
  return pool.slice().sort((a, b) =>
    String(b.latest_action_date || '').localeCompare(String(a.latest_action_date || ''))
  )[0]
}
