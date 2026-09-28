// bills.latest_action_date is the date the source attached to a bill's newest
// action, and sources attach future dates to some actions: effective dates
// ("Effective Date", "Effective date 01/01/2027") and scheduled events (DC
// public hearings, committee mark-ups). Those values are accurate; they just
// aren't something that has already happened. Shared by the server (ranking,
// prerender, personalization prompt) and the UI so every surface reads a
// future date the same way instead of calling it the "last action".
//
// Kinds:
//   past      - date is today or earlier (or missing): a real last action
//   effective - future date on an "Effective..." action: when a law takes effect
//   scheduled - any other future date: an upcoming event on the calendar

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const EFFECTIVE_RE = /^\s*(\([a-z]\)\s*)?effective\b/i
// m/d, m/d/yy, m/d/yyyy written into the action text
const TEXT_DATE_RE = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}|\d{2}))?\b/g

const pad = (n) => String(n).padStart(2, '0')

export function todayIso(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

// Some sources stamp a past event with a later posting date: Alaska's
// "VETOED BY GOVERNOR 8/31/26" and Michigan's "Bill Electronically Reproduced
// 09/24/2026" both carry dates a few days in the future. When the text names
// its own date, that is when the event happened.
function textDate(text, stampDate) {
  const stampYear = Number(stampDate.slice(0, 4))
  for (const m of String(text || '').matchAll(TEXT_DATE_RE)) {
    const month = Number(m[1])
    const day = Number(m[2])
    if (month < 1 || month > 12 || day < 1 || day > 31) continue
    let year = m[3] ? Number(m[3]) : stampYear
    if (year < 100) year += 2000
    let iso = `${year}-${pad(month)}-${pad(day)}`
    if (!m[3] && iso > stampDate) iso = `${year - 1}-${pad(month)}-${pad(day)}`
    return iso
  }
  return null
}

export function classifyActionDate(actionText, actionDate, today = todayIso()) {
  const date = String(actionDate || '').slice(0, 10)
  if (!ISO_DATE_RE.test(date) || date <= today) return { kind: 'past', date: ISO_DATE_RE.test(date) ? date : '' }
  const written = textDate(actionText, date)
  if (written && written <= today) return { kind: 'past', date: written }
  if (EFFECTIVE_RE.test(actionText || '')) return { kind: 'effective', date }
  return { kind: 'scheduled', date }
}

// "2028-07-01" -> "Jul 1, 2028". Parsed as UTC so the day never shifts.
export function formatActionDate(iso) {
  if (!ISO_DATE_RE.test(iso || '')) return iso || ''
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

// What to show where the UI says "Last action: <text> · <date>".
export function describeLatestAction(actionText, actionDate, today = todayIso()) {
  const text = actionText || ''
  const { kind, date } = classifyActionDate(text, actionDate, today)
  if (kind === 'effective') return { kind, label: 'Takes effect', text: formatActionDate(date), date: '' }
  if (kind === 'scheduled') {
    const event = text.trim() && text !== 'No recent action' ? `${text} on ` : ''
    return { kind, label: 'Scheduled', text: `${event}${formatActionDate(date)}`, date: '' }
  }
  return { kind, label: 'Last action', text, date }
}
