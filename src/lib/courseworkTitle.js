// Default title for a bill pushed into Google Classroom.
//
// The first version used the bill's official title verbatim. Real example, as
// it appeared in a live Classroom stream:
//
//   "To amend the Servicemembers Civil Relief Act to provide relief for members
//    of the uniformed services who homeschool their dependent children, and for
//    other purposes."
//
// 165 characters of legislative boilerplate, with the bill number nowhere in
// sight. In a Classwork list that wraps to three lines and tells a student
// almost nothing. This builds something a teacher would actually write —
// and the assign modal lets them overwrite it anyway.
//
// Lives in src/lib/ (not api/) because both the modal and the server need it,
// and .vercelignore keeps api/ out of the frontend build. api/googleClassroom.js
// imports it the same way it imports billHref.

// Trailing catch-alls that carry no information. Congress ends most bills this
// way; dropping the clause is always safe because it never narrows the subject.
const BOILERPLATE_TAIL = /[,;]?\s*(and)?\s*for other purposes\.?\s*$/i

// Leading "To ..." is the drafting convention for a bill's purpose clause. As a
// title it reads like a fragment, so we lift it to an imperative.
const LEADING_TO = /^to\s+/i

const MAX_TITLE = 90     // comfortable on one or two lines in Classroom's list
const MAX_TOTAL = 200    // our own input cap; Google's limit is 3000

/**
 * "HR 9351", "S 1234", "CT HB 5001" — how a teacher refers to the bill out loud.
 */
export function formatBillLabel(bill) {
  if (!bill) return ''
  const type = String(bill.type ?? bill.bill_type ?? '').replace(/\./g, '').toUpperCase()
  const number = bill.number ?? bill.bill_number
  if (!type || number == null || String(number).trim() === '') return ''
  const state = String(bill.state ?? bill.jurisdiction ?? '').toUpperCase()
  // State bills repeat federal-looking numbers, so the state prefix is what
  // keeps "HB 5001" unambiguous in a class that covers both.
  const isState = /^[A-Z]{2}$/.test(state) && !bill.congress
  return `${isState ? `${state} ` : ''}${type} ${number}`
}

/**
 * Shorten an official bill title to something readable, without cutting a word
 * in half. Prefers to end at a clause boundary when one lands near the cap.
 */
export function shortenBillTitle(title, max = MAX_TITLE) {
  let t = String(title || '').replace(/\s+/g, ' ').trim()
  if (!t) return ''
  t = t.replace(BOILERPLATE_TAIL, '').trim().replace(/[,;]+$/, '')
  t = t.replace(LEADING_TO, '')
  if (t) t = t[0].toUpperCase() + t.slice(1)
  if (t.length <= max) return t

  // A comma near the end of the budget is a natural stopping point; falling
  // back to the last whole word keeps us from slicing mid-word.
  const window = t.slice(0, max + 1)
  const clause = Math.max(window.lastIndexOf(', '), window.lastIndexOf('; '))
  if (clause > max * 0.55) return t.slice(0, clause).replace(/[,;]+$/, '')
  const space = window.lastIndexOf(' ')
  return `${t.slice(0, space > 0 ? space : max).replace(/[,;:]+$/, '')}…`
}

/**
 * The prefilled coursework title: "HR 9351: Amend the Servicemembers Civil
 * Relief Act to provide relief for members of the uniformed services".
 *
 * Deliberately NOT the AI headline — that's personalized to whoever is reading,
 * so the teacher's copy would name an impact specific to them and make no sense
 * to the class.
 */
export function defaultCourseworkTitle(bill) {
  const label = formatBillLabel(bill)
  const short = shortenBillTitle(bill?.title)
  const joined = label && short ? `${label}: ${short}` : (short || label)
  if (!joined) return 'CapitolKey reading'
  return joined.slice(0, MAX_TOTAL)
}

export const COURSEWORK_TITLE_MAX = MAX_TOTAL
