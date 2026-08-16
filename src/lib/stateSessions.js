// State legislative session status as of 2026-08-16.
//
// Adjournment dates come from the NCSL 2026 Legislative Session Calendar
// (updated March 23, 2026); 2027 convene dates from MultiState's 2027 calendar,
// with Florida (March 2) and North Carolina confirmed against primary reporting.
// Where a secondary aggregator disagreed with NCSL, NCSL won — it was right and
// the aggregator was wrong on AZ, GA, IA and VT.
//
// "*" states in the NCSL calendar (legislature meets throughout the year) are
// recorded as yearRound rather than given an adjournment date: IL, MA, MI, NJ,
// NY, OH, WI. Some of those have finished floor activity for 2026, but they can
// act at any time, so showing no note beats asserting a session has ended.
//
// Update this file as sessions adjourn or convene. The data drives the State
// tab on Results: states not "in_session" get a note instead of bills.
//
// Status values:
//   in_session        — currently meeting; bills may be active
//   adjourned         — 2026 regular session has ended sine die
//   biennial_off_year — state only meets in odd years, no 2026 session
//
// IMPORTANT: this table is hand-maintained and therefore goes stale. A stale
// "in_session" is the damaging direction — it tells a student a legislature is
// meeting when it went home months ago. getStateSession() therefore treats a
// past scheduledAdjournment as adjourned regardless of the stored status, so
// the table degrades into "we're not sure when they return" rather than into a
// confident falsehood. Refresh DATA_AS_OF and the rows together.
export const DATA_AS_OF = '2026-08-16'

export const STATE_SESSIONS = {
  AL: { status: 'adjourned', adjournedOn: '2026-04-27', nextConvenes: '2027-02' },
  AK: { status: 'adjourned', adjournedOn: '2026-05-20', nextConvenes: '2027-01' },
  AZ: { status: 'adjourned', adjournedOn: '2026-04-25', nextConvenes: '2027-01' },
  AR: { status: 'adjourned', adjournedOn: '2026-05-07', nextConvenes: '2027-01', note: 'Fiscal session' },
  CA: { status: 'in_session', scheduledAdjournment: '2026-08-31' },
  CO: { status: 'adjourned', adjournedOn: '2026-05-13', nextConvenes: '2027-01' },
  CT: { status: 'adjourned', adjournedOn: '2026-05-06', nextConvenes: '2027-01' },
  DE: { status: 'adjourned', adjournedOn: '2026-06-30', nextConvenes: '2027-01' },
  FL: { status: 'adjourned', adjournedOn: '2026-03-13', nextConvenes: '2027-03' },
  GA: { status: 'adjourned', adjournedOn: '2026-04-06', nextConvenes: '2027-01' },
  HI: { status: 'adjourned', adjournedOn: '2026-05-08', nextConvenes: '2027-01' },
  ID: { status: 'adjourned', adjournedOn: '2026-04-10', nextConvenes: '2027-01' },
  IL: { status: 'in_session', yearRound: true },
  IN: { status: 'adjourned', adjournedOn: '2026-02-27', nextConvenes: '2027-01' },
  IA: { status: 'adjourned', adjournedOn: '2026-04-21', nextConvenes: '2027-01' },
  KS: { status: 'adjourned', adjournedOn: '2026-04-10', nextConvenes: '2027-01' },
  KY: { status: 'adjourned', adjournedOn: '2026-04-15', nextConvenes: '2027-01' },
  LA: { status: 'adjourned', adjournedOn: '2026-06-01', nextConvenes: '2027-04' },
  ME: { status: 'adjourned', adjournedOn: '2026-04-15', nextConvenes: '2026-12' },
  MD: { status: 'adjourned', adjournedOn: '2026-04-13', nextConvenes: '2027-01' },
  MA: { status: 'in_session', yearRound: true },
  MI: { status: 'in_session', yearRound: true },
  MN: { status: 'adjourned', adjournedOn: '2026-05-18', nextConvenes: '2027-01' },
  MS: { status: 'adjourned', adjournedOn: '2026-04-05', nextConvenes: '2027-01' },
  MO: { status: 'adjourned', adjournedOn: '2026-05-15', nextConvenes: '2027-01' },
  MT: { status: 'biennial_off_year', nextConvenes: '2027-01' },
  NE: { status: 'adjourned', adjournedOn: '2026-04-17', nextConvenes: '2027-01' },
  NV: { status: 'biennial_off_year', nextConvenes: '2027-02' },
  NH: { status: 'adjourned', adjournedOn: '2026-06-30', nextConvenes: '2027-01' },
  NJ: { status: 'in_session', yearRound: true },
  NM: { status: 'adjourned', adjournedOn: '2026-02-19', nextConvenes: '2027-01' },
  NY: { status: 'in_session', yearRound: true },
  // Short session adjourned; a resolution set limited reconvening dates
  // through December for budget/veto business only, not general bill filing.
  NC: { status: 'adjourned', adjournedOn: '2026-07-31', nextConvenes: '2027-01', note: 'Short session' },
  ND: { status: 'biennial_off_year', nextConvenes: '2027-01' },
  OH: { status: 'in_session', yearRound: true },
  OK: { status: 'adjourned', adjournedOn: '2026-05-29', nextConvenes: '2027-02' },
  OR: { status: 'adjourned', adjournedOn: '2026-03-06', nextConvenes: '2027-01' },
  PA: { status: 'in_session', scheduledAdjournment: '2026-11-30' },
  RI: { status: 'adjourned', adjournedOn: '2026-06-30', nextConvenes: '2027-01' },
  SC: { status: 'adjourned', adjournedOn: '2026-05-07', nextConvenes: '2027-01' },
  SD: { status: 'adjourned', adjournedOn: '2026-03-30', nextConvenes: '2027-01' },
  TN: { status: 'adjourned', adjournedOn: '2026-04-24', nextConvenes: '2027-01' },
  TX: { status: 'biennial_off_year', nextConvenes: '2027-01' },
  UT: { status: 'adjourned', adjournedOn: '2026-03-06', nextConvenes: '2027-01' },
  VT: { status: 'adjourned', adjournedOn: '2026-05-08', nextConvenes: '2027-01' },
  VA: { status: 'adjourned', adjournedOn: '2026-03-14', nextConvenes: '2027-01' },
  WA: { status: 'adjourned', adjournedOn: '2026-03-12', nextConvenes: '2027-01' },
  WV: { status: 'adjourned', adjournedOn: '2026-03-14', nextConvenes: '2027-01' },
  WI: { status: 'in_session', yearRound: true },
  WY: { status: 'adjourned', adjournedOn: '2026-03-11', nextConvenes: '2027-01' },
}

const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia',
  HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois', IN: 'Indiana', IA: 'Iowa',
  KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire',
  NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York', NC: 'North Carolina',
  ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
  RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee',
  TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
}

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Session info for a state, corrected for the age of the table.
 *
 * A row still marked in_session whose scheduled adjournment has already passed
 * is reported as adjourned, with `derived: true` so callers can word the note
 * without a reconvene date we don't actually have.
 */
export function getStateSession(state) {
  if (!state) return null
  const info = STATE_SESSIONS[state.toUpperCase()]
  if (!info) return null

  if (
    info.status === 'in_session' &&
    info.scheduledAdjournment &&
    info.scheduledAdjournment < todayIso()
  ) {
    return {
      ...info,
      status: 'adjourned',
      adjournedOn: info.scheduledAdjournment,
      // The stored date was the SCHEDULED adjournment, not a confirmed sine
      // die, and we have no reconvene date for these.
      derived: true,
    }
  }
  return info
}

// True when the table is old enough that its "in session" rows should not be
// trusted. Surfaced by scripts/check-session-freshness.mjs in CI.
export function sessionDataAgeInDays(now = new Date()) {
  const asOf = new Date(`${DATA_AS_OF}T00:00:00Z`)
  return Math.floor((now - asOf) / 86400000)
}

export function isStateInSession(state) {
  return getStateSession(state)?.status === 'in_session'
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December']

function formatMonthDay(iso) {
  if (!iso) return ''
  const [y, m, d] = iso.split('-').map(Number)
  return `${MONTHS[m - 1]} ${d}, ${y}`
}

function formatMonthYear(isoPrefix) {
  if (!isoPrefix) return ''
  const [y, m] = isoPrefix.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

// Returns a user-facing explanation for why no state bills appear, or null if
// the state is in session (caller should show bills normally).
export function getSessionNote(state) {
  const info = getStateSession(state)
  if (!info || info.status === 'in_session') return null
  const name = STATE_NAMES[state.toUpperCase()] || state
  if (info.status === 'biennial_off_year') {
    return {
      title: `The ${name} Legislature only meets in odd-numbered years.`,
      body: `${name} holds regular legislative sessions every other year. The next session convenes ${formatMonthYear(info.nextConvenes)}. Until then, no new bills are being introduced.`,
    }
  }
  if (info.status === 'adjourned') {
    // Derived from a passed scheduled-adjournment date: we know the session is
    // over but not the exact sine die date, and we have no reconvene date.
    // Say less rather than saying something wrong.
    if (info.derived) {
      return {
        title: `${name}'s 2026 legislative session has ended.`,
        body: `The legislature was scheduled to adjourn on ${formatMonthDay(info.adjournedOn)}. No new bills are being introduced until its next session begins.`,
      }
    }
    const reconvenes = info.nextConvenes
      ? ` and reconvenes in ${formatMonthYear(info.nextConvenes)}`
      : ''
    return {
      title: `${name}'s 2026 legislative session has ended.`,
      body: `The legislature adjourned sine die on ${formatMonthDay(info.adjournedOn)}${reconvenes}. No new bills are being introduced until then.`,
    }
  }
  return null
}
