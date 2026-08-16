#!/usr/bin/env node
// Warns when src/lib/stateSessions.js has gone stale.
//
// The table is hand-maintained. Left alone it quietly starts telling students
// that adjourned legislatures are still meeting. getStateSession() already
// fails safe on a passed adjournment date, but a state whose row has no
// scheduledAdjournment (the year-round ones) can't be auto-corrected — those
// need a human. This surfaces that instead of letting it rot silently.

import {
  STATE_SESSIONS,
  DATA_AS_OF,
  sessionDataAgeInDays,
  getStateSession,
} from '../src/lib/stateSessions.js'

const STALE_AFTER_DAYS = 120
const age = sessionDataAgeInDays()
const today = new Date().toISOString().slice(0, 10)

// Rows that claim in_session and cannot be date-corrected.
const unverifiable = []
// Rows the date logic silently corrected — fine at runtime, but a signal the
// table is behind.
const autoCorrected = []

for (const [state, row] of Object.entries(STATE_SESSIONS)) {
  if (row.status !== 'in_session') continue
  const effective = getStateSession(state)
  if (effective.status === 'adjourned') {
    autoCorrected.push(`${state} (scheduled ${row.scheduledAdjournment})`)
  } else if (!row.scheduledAdjournment) {
    unverifiable.push(`${state}${row.yearRound ? ' (year-round)' : ''}`)
  }
}

console.log(`state session data as of ${DATA_AS_OF} (${age} days old, today ${today})`)

if (autoCorrected.length) {
  console.log(`\n  auto-corrected to adjourned (${autoCorrected.length}):`)
  console.log(`    ${autoCorrected.join(', ')}`)
}
if (unverifiable.length) {
  console.log(`\n  still "in session", no adjournment date to check against (${unverifiable.length}):`)
  console.log(`    ${unverifiable.join(', ')}`)
}

if (age > STALE_AFTER_DAYS) {
  console.log(
    `\n⚠️  stateSessions.js is ${age} days old (threshold ${STALE_AFTER_DAYS}).` +
    `\n   Refresh it against the NCSL session calendar and bump DATA_AS_OF.`
  )
} else {
  console.log('\n✓ session data is within the freshness window')
}

// Advisory only — never fail a build over calendar drift.
process.exit(0)
