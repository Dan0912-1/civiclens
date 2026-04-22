// State legislative session status as of 2026-04-22.
// Sources: NCSL 2026 calendar, MultiState, LegiScan, state legislative sites.
//
// Update this file as sessions adjourn or convene. The data drives the State
// tab on Results: states not "in_session" get a note instead of bills.
//
// Status values:
//   in_session        — currently meeting; bills may be active
//   adjourned         — 2026 regular session has ended sine die
//   biennial_off_year — state only meets in odd years, no 2026 session

export const STATE_SESSIONS = {
  AL: { status: 'adjourned', adjournedOn: '2026-04-09', nextConvenes: '2027-01' },
  AK: { status: 'in_session', scheduledAdjournment: '2026-05-20' },
  AZ: { status: 'in_session', scheduledAdjournment: '2026-04-25' },
  AR: { status: 'in_session', scheduledAdjournment: '2026-05-07', note: 'Fiscal session' },
  CA: { status: 'in_session', scheduledAdjournment: '2026-08-31' },
  CO: { status: 'in_session', scheduledAdjournment: '2026-05-13' },
  CT: { status: 'in_session', scheduledAdjournment: '2026-05-06' },
  DE: { status: 'in_session', scheduledAdjournment: '2026-06-30' },
  FL: { status: 'adjourned', adjournedOn: '2026-03-13', nextConvenes: '2027-01' },
  GA: { status: 'adjourned', adjournedOn: '2026-04-06', nextConvenes: '2027-01' },
  HI: { status: 'in_session', scheduledAdjournment: '2026-05-08' },
  ID: { status: 'adjourned', adjournedOn: '2026-04-02', nextConvenes: '2027-01' },
  IL: { status: 'in_session', scheduledAdjournment: '2026-05-31' },
  IN: { status: 'adjourned', adjournedOn: '2026-03-14', nextConvenes: '2027-01' },
  IA: { status: 'adjourned', adjournedOn: '2026-04-21', nextConvenes: '2027-01' },
  KS: { status: 'adjourned', adjournedOn: '2026-04-11', nextConvenes: '2027-01' },
  KY: { status: 'adjourned', adjournedOn: '2026-04-15', nextConvenes: '2027-01' },
  LA: { status: 'in_session', scheduledAdjournment: '2026-06-01' },
  ME: { status: 'in_session', scheduledAdjournment: '2026-04-29' },
  MD: { status: 'adjourned', adjournedOn: '2026-04-13', nextConvenes: '2027-01' },
  MA: { status: 'in_session', scheduledAdjournment: '2026-07-31', yearRound: true },
  MI: { status: 'in_session', yearRound: true },
  MN: { status: 'in_session', scheduledAdjournment: '2026-05-18' },
  MS: { status: 'adjourned', adjournedOn: '2026-04-05', nextConvenes: '2027-01' },
  MO: { status: 'in_session', scheduledAdjournment: '2026-05-15' },
  MT: { status: 'biennial_off_year', nextConvenes: '2027-01' },
  NE: { status: 'adjourned', adjournedOn: '2026-04-17', nextConvenes: '2027-01' },
  NV: { status: 'biennial_off_year', nextConvenes: '2027-02' },
  NH: { status: 'in_session', scheduledAdjournment: '2026-06-30' },
  NJ: { status: 'in_session', yearRound: true },
  NM: { status: 'adjourned', adjournedOn: '2026-02-19', nextConvenes: '2027-01' },
  NY: { status: 'in_session', scheduledAdjournment: '2026-06-04', yearRound: true },
  NC: { status: 'in_session', scheduledAdjournment: '2026-08-31', note: 'Short session' },
  ND: { status: 'biennial_off_year', nextConvenes: '2027-01' },
  OH: { status: 'in_session', yearRound: true },
  OK: { status: 'in_session', scheduledAdjournment: '2026-05-29' },
  OR: { status: 'adjourned', adjournedOn: '2026-03-06', nextConvenes: '2027-02' },
  PA: { status: 'in_session', scheduledAdjournment: '2026-11-30' },
  RI: { status: 'in_session', scheduledAdjournment: '2026-06-30' },
  SC: { status: 'in_session', scheduledAdjournment: '2026-05-07' },
  SD: { status: 'adjourned', adjournedOn: '2026-03-30', nextConvenes: '2027-01' },
  TN: { status: 'in_session', scheduledAdjournment: '2026-04-24' },
  TX: { status: 'biennial_off_year', nextConvenes: '2027-01' },
  UT: { status: 'adjourned', adjournedOn: '2026-03-06', nextConvenes: '2027-01' },
  VT: { status: 'in_session', scheduledAdjournment: '2026-05-08' },
  VA: { status: 'adjourned', adjournedOn: '2026-03-14', nextConvenes: '2027-01' },
  WA: { status: 'adjourned', adjournedOn: '2026-03-12', nextConvenes: '2027-01' },
  WV: { status: 'adjourned', adjournedOn: '2026-03-14', nextConvenes: '2027-01' },
  WI: { status: 'adjourned', adjournedOn: '2026-03-17', nextConvenes: '2027-01' },
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

export function getStateSession(state) {
  if (!state) return null
  return STATE_SESSIONS[state.toUpperCase()] || null
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
    return {
      title: `${name}'s 2026 legislative session has ended.`,
      body: `The legislature adjourned sine die on ${formatMonthDay(info.adjournedOn)} and reconvenes in ${formatMonthYear(info.nextConvenes)}. No new bills are being introduced until then.`,
    }
  }
  return null
}
