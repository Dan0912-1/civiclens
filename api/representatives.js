// Who actually votes on this bill — and how a student reaches them.
//
// The old "Contact your rep" button sent every reader to a third-party member
// directory keyed only on their state. For a Senate bill that listed House
// members; for a House bill it listed senators; for a state bill it listed
// members of Congress, who have no vote on it at all. Chamber is not a detail
// here: telling a student to call a senator about a House resolution wastes
// the one civic action they were willing to take.
//
// So this module answers a narrower question — "given THIS bill and the
// student's state, exactly which lawmakers decide it?" — and is honest about
// the cases where state alone is not enough to name one person.
//
// ── Why we can be exact for the Senate and not the House ────────────────────
// Senators represent an entire state, so a state code names both of a
// student's senators with no further information. House members represent a
// district, and mapping a person to a district requires their street address:
//   • The Census geocoder (the free, authoritative option) resolves districts
//     from a full street address only — a bare ZIP or "city, ST ZIP" returns
//     zero matches. Verified against geocoding.geo.census.gov.
//   • Google's Civic Information representatives endpoint, the usual answer
//     here, was retired in April 2025.
//   • ZIP-to-district crosswalks exist, but the Census relationship file is
//     published for the 118th Congress, not the 119th. Applying it after the
//     mid-decade redistricting in several states would name the wrong member
//     with total confidence, which is worse than naming none.
// Collecting home addresses from high school students to close that gap is not
// a trade we want to make. So for multi-district states we list the whole House
// delegation, say plainly why, and link the official ZIP lookup that does have
// the address to resolve it.
//
// Source: unitedstates/congress-legislators (public domain, no API key). One
// CSV covers all current members with office phone, contact form, and website.

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { HOUSE_FINDER, SENATE_FINDER, STATE_LEGISLATOR_FINDER } from './civicLinks.js'

const MODULE_DIR = dirname(fileURLToPath(import.meta.url))
const SNAPSHOT_PATH = join(MODULE_DIR, 'assets', 'data', 'legislators-current.csv')
const ZIP_DISTRICTS_PATH = join(MODULE_DIR, 'assets', 'data', 'zip-districts.json')
const REMOTE_CSV = 'https://unitedstates.github.io/congress-legislators/legislators-current.csv'

// Refresh once a day. Membership changes on the order of a few times a year
// (deaths, resignations, special elections), so the bundled snapshot is a safe
// floor and the remote copy is the correction.
const REFRESH_MS = 1000 * 60 * 60 * 24

// The universal official finders live in civicLinks.js, which is the single
// owner of every canonical civic URL we emit.
let cached = null // { members, loadedAt, source }

/**
 * Minimal RFC 4180 parser. The legislators CSV quotes fields that contain
 * commas (fec_ids is a comma-joined list inside one field), so a naive
 * split(',') shifts every column after it.
 */
function parseCsv(text) {
  const rows = []
  let row = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += c
    } else if (c === '"') {
      quoted = true
    } else if (c === ',') {
      row.push(field); field = ''
    } else if (c === '\n') {
      row.push(field); field = ''
      rows.push(row); row = []
    } else if (c !== '\r') {
      field += c
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.length > 1)
}

const PARTY_ABBR = {
  Democrat: 'D',
  Republican: 'R',
  Independent: 'I',
  Libertarian: 'L',
}

function toMembers(csvText) {
  const rows = parseCsv(csvText)
  if (!rows.length) return []
  const header = rows[0].map(h => h.trim())
  const idx = Object.fromEntries(header.map((h, i) => [h, i]))
  const need = ['full_name', 'type', 'state', 'district', 'party']
  if (need.some(k => idx[k] === undefined)) return []

  const members = []
  for (const r of rows.slice(1)) {
    const type = r[idx.type]
    if (type !== 'sen' && type !== 'rep') continue
    const districtRaw = r[idx.district]
    members.push({
      bioguideId: r[idx.bioguide_id] || '',
      name: r[idx.full_name] || `${r[idx.first_name] || ''} ${r[idx.last_name] || ''}`.trim(),
      chamber: type === 'sen' ? 'senate' : 'house',
      state: (r[idx.state] || '').toUpperCase(),
      // '' for senators, '0' for a state's single at-large district.
      district: districtRaw === '' || districtRaw == null ? null : Number(districtRaw),
      party: PARTY_ABBR[r[idx.party]] || (r[idx.party] || '').slice(0, 1).toUpperCase(),
      partyFull: r[idx.party] || '',
      phone: r[idx.phone] || '',
      website: r[idx.url] || '',
      contactForm: r[idx.contact_form] || '',
      office: r[idx.address] || '',
    })
  }
  return members
}

function loadSnapshot() {
  try {
    return toMembers(readFileSync(SNAPSHOT_PATH, 'utf8'))
  } catch (err) {
    console.error('[reps] snapshot load failed:', err.message)
    return []
  }
}

/**
 * Current members of Congress. Serves the in-memory copy when fresh, otherwise
 * refreshes from the remote CSV and falls back to the committed snapshot.
 * Never throws and never returns a partially-parsed list — a bad fetch keeps
 * whatever we already had.
 */
export async function loadFederalLegislators() {
  if (cached && Date.now() - cached.loadedAt < REFRESH_MS) return cached

  try {
    const resp = await fetch(REMOTE_CSV, { signal: AbortSignal.timeout(8000) })
    if (resp.ok) {
      const members = toMembers(await resp.text())
      // A truncated or reshaped file must not blank out the directory. The
      // real one has 535 voting members plus delegates.
      if (members.length > 400) {
        cached = { members, loadedAt: Date.now(), source: 'remote' }
        return cached
      }
      console.error(`[reps] remote CSV parsed to only ${members.length} members — keeping snapshot`)
    } else {
      console.error(`[reps] remote CSV fetch failed: ${resp.status}`)
    }
  } catch (err) {
    console.error('[reps] remote CSV fetch error:', err.message)
  }

  if (cached) {
    // Keep serving the stale copy; just retry sooner than a full day.
    cached.loadedAt = Date.now() - REFRESH_MS + 1000 * 60 * 30
    return cached
  }
  cached = { members: loadSnapshot(), loadedAt: Date.now(), source: 'snapshot' }
  return cached
}

// ── ZIP → congressional district ─────────────────────────────────────────────
// See scripts/build-zip-districts.mjs. Built from the Census Bureau's official
// ZCTA-to-district relationship file for the 119th Congress, so this names a
// student's actual representative rather than handing them a delegation and a
// link. 84.8% of ZIPs sit wholly inside one district; the rest straddle two or
// three and are returned ranked by how much of the ZIP each district covers,
// which the panel presents as candidates rather than an answer.
//
// A ZIP is coarser than an address, so a split ZIP genuinely cannot be
// resolved further without one — that part of the earlier limitation stands.
// What changed is that it now applies to ~15% of ZIPs instead of every student
// in a multi-district state.

const FIPS_TO_STATE = {
  '01': 'AL', '02': 'AK', '04': 'AZ', '05': 'AR', '06': 'CA', '08': 'CO', '09': 'CT',
  '10': 'DE', '11': 'DC', '12': 'FL', '13': 'GA', '15': 'HI', '16': 'ID', '17': 'IL',
  '18': 'IN', '19': 'IA', '20': 'KS', '21': 'KY', '22': 'LA', '23': 'ME', '24': 'MD',
  '25': 'MA', '26': 'MI', '27': 'MN', '28': 'MS', '29': 'MO', '30': 'MT', '31': 'NE',
  '32': 'NV', '33': 'NH', '34': 'NJ', '35': 'NM', '36': 'NY', '37': 'NC', '38': 'ND',
  '39': 'OH', '40': 'OK', '41': 'OR', '42': 'PA', '44': 'RI', '45': 'SC', '46': 'SD',
  '47': 'TN', '48': 'TX', '49': 'UT', '50': 'VT', '51': 'VA', '53': 'WA', '54': 'WV',
  '55': 'WI', '56': 'WY', '60': 'AS', '66': 'GU', '69': 'MP', '72': 'PR', '78': 'VI',
}

let zipMap = null

function loadZipDistricts() {
  if (zipMap) return zipMap
  try {
    zipMap = JSON.parse(readFileSync(ZIP_DISTRICTS_PATH, 'utf8'))
  } catch (err) {
    console.error('[reps] zip-districts load failed:', err.message)
    zipMap = {}
  }
  return zipMap
}

/**
 * Districts a ZIP falls in, best first.
 * Returns [] for an unknown ZIP (PO-box-only ZIPs have no ZCTA, so they aren't
 * in the file at all) — callers fall back to the state delegation.
 */
export function districtsForZip(zip) {
  // Accept "06032" and the ZIP+4 forms ("06032-1234", "060321234"), which are
  // the shapes people actually type. Anything else is a typo, and truncating a
  // typo to five digits would name a representative with total confidence for
  // a ZIP the student never entered — "060321" is not 06032.
  const digits = String(zip ?? '').replace(/\D/g, '')
  if (digits.length !== 5 && digits.length !== 9) return []
  const z = digits.slice(0, 5)
  const packed = loadZipDistricts()[z]
  if (!packed) return []
  return packed.split(',').map(geoid => ({
    state: FIPS_TO_STATE[geoid.slice(0, 2)] || '',
    // "00" is the at-large marker, and matches district 0 in the member data.
    district: Number(geoid.slice(2)),
  })).filter(d => d.state)
}

/** Which body votes on this bill next, in the vocabulary the panel speaks. */
export function decidingChamber(bill) {
  const type = String(bill?.type || bill?.bill_type || '').toLowerCase().replace(/\./g, '')
  // Accepts the feed shape (isStateBill/state) and the bills-table shape
  // (jurisdiction) — the same rule as isStateBill in src/lib/billUrl.js.
  const jurisdiction = bill?.state ?? bill?.jurisdiction
  const isState = bill?.isStateBill != null
    ? Boolean(bill.isStateBill)
    : Boolean(jurisdiction) && jurisdiction !== 'US'

  if (isState) {
    // State chambers are named inconsistently across the 50 states (Assembly,
    // House of Delegates, General Assembly), so classify by origin rather than
    // by the letter of the prefix alone. LegiScan bill types: hb/ab/hr/hjr →
    // lower; sb/sr/sjr → upper.
    const origin = String(bill?.originChamber || '').toLowerCase()
    if (origin.includes('senate')) return 'state-upper'
    if (origin.includes('house') || origin.includes('assembly')) return 'state-lower'
    return type.startsWith('s') ? 'state-upper' : 'state-lower'
  }
  return type.startsWith('s') ? 'senate' : 'house'
}

const VALID_CHAMBERS = new Set(['house', 'senate', 'state-upper', 'state-lower'])

/**
 * The panel payload: who to contact, whether that list is exactly the
 * student's own lawmakers, and the honest reason when it isn't.
 */
export async function representativesFor({ state, chamber, zip }) {
  const st = String(state || '').toUpperCase()
  const ch = VALID_CHAMBERS.has(chamber) ? chamber : 'house'

  if (ch === 'state-upper' || ch === 'state-lower') {
    // State legislative districts are far smaller than a ZIP code, so there is
    // no address-free way to name a student's own state senator or
    // representative — and a chamber roster runs from 30 to 400 people, which
    // is not a list anyone can pick themselves out of. The official finder
    // takes an address on its own site and returns the exact answer.
    return {
      scope: 'state',
      chamber: ch,
      state: st,
      exact: false,
      members: [],
      finderUrl: STATE_LEGISLATOR_FINDER,
      reason: 'address_required',
    }
  }

  const { members: all, source } = await loadFederalLegislators()
  const delegation = all
    .filter(m => m.chamber === ch && m.state === st)
    .sort((a, b) => (a.district ?? -1) - (b.district ?? -1) || a.name.localeCompare(b.name))

  // A ZIP narrows the House down to the student's own member. Senate seats are
  // state-wide, so a ZIP tells us nothing there that the state code didn't.
  let members = delegation
  let zipDistricts = []
  if (ch === 'house' && zip) {
    zipDistricts = districtsForZip(zip).filter(d => !st || d.state === st)
    if (zipDistricts.length) {
      const wanted = zipDistricts.map(d => `${d.state}-${d.district}`)
      const matched = delegation.filter(m => wanted.includes(`${m.state}-${m.district}`))
      // Preserve the ZIP's own ranking: the district covering most of the ZIP
      // is the most likely one, and should be read first.
      if (matched.length) {
        members = wanted
          .map(k => matched.find(m => `${m.state}-${m.district}` === k))
          .filter(Boolean)
      }
    }
  }

  // Senators represent the whole state, so both are this student's. A
  // single-district state has exactly one House member, same story. And a ZIP
  // that lands in exactly one district names that student's representative.
  const exact = members.length > 0 && (
    ch === 'senate' ||
    members.length === 1
  )

  let reason = null
  if (!members.length) reason = 'no_members'
  else if (ch === 'house' && members.length > 1) {
    reason = zipDistricts.length > 1 ? 'zip_spans_districts' : 'district_unknown'
  }

  return {
    scope: 'federal',
    chamber: ch,
    state: st,
    exact,
    members,
    // How many House members the state has in total — the panel says "1 of 5"
    // rather than implying the state only has one.
    delegationSize: delegation.length,
    // True when the narrowing came from a ZIP rather than from the state alone.
    fromZip: zipDistricts.length > 0,
    finderUrl: ch === 'senate' ? SENATE_FINDER : HOUSE_FINDER,
    reason,
    source,
  }
}
