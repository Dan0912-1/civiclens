// Canonical civic-action links.
//
// The LLM is asked to put a real URL in every civic_action. Left unchecked it
// invents them, and the failures are the worst kind: plausible .gov paths that
// 404 (https://www.ct.gov/ded, https://www.maryland.gov/CCRI), and — on STATE
// bills — links to congress.gov that resolve to a real but completely
// unrelated FEDERAL bill. A student following that link reads the wrong law.
//
// So the model's URLs are treated as untrusted. Every URL it emits is replaced
// with one we construct from the bill's own identity. Only the surrounding
// prose is the model's.
//
// Every constant URL below was verified to resolve before being added here.
// congress.gov path segments come from the Congress.gov API's own
// legislationUrl field, not from memory.

// Verified against api.congress.gov v3 legislationUrl for the 119th Congress.
const FEDERAL_TYPE_PATHS = {
  hr: 'house-bill',
  s: 'senate-bill',
  hres: 'house-resolution',
  sres: 'senate-resolution',
  hjres: 'house-joint-resolution',
  sjres: 'senate-joint-resolution',
  hconres: 'house-concurrent-resolution',
  sconres: 'senate-concurrent-resolution',
}

// Universal, stable finders. Verified 200. Exported because
// api/representatives.js hands the same URLs to the in-app panel — one owner
// for every canonical civic URL.
export const HOUSE_FINDER = 'https://www.house.gov/representatives/find-your-representative'
export const SENATE_FINDER = 'https://www.senate.gov/senators/senators-contact.htm'
// One page that covers all 50 states. Preferred over a hand-written per-state
// map: 50 hand-entered URLs is 50 chances to reintroduce the bug this fixes.
export const STATE_LEGISLATOR_FINDER = 'https://openstates.org/find_your_legislator/'

export function federalBillUrl(congress, type, number) {
  const path = FEDERAL_TYPE_PATHS[String(type || '').toLowerCase().replace(/\./g, '')]
  if (!path || !congress || !number) return null
  return `https://www.congress.gov/bill/${congress}th-congress/${path}/${number}`
}

// congress.gov opens a bill on its Summary tab. An action that told a student
// to "read the full text" therefore landed them on a page where the text is
// behind one more click, on a tab they have to notice first.
export function federalBillTextUrl(congress, type, number) {
  const page = federalBillUrl(congress, type, number)
  return page ? `${page}/text` : null
}

// Where a student should go to reach the people who actually vote on THIS bill.
export function contactUrlFor(bill) {
  if (bill?.isStateBill) return STATE_LEGISLATOR_FINDER
  const type = String(bill?.type || '').toLowerCase()
  // Senate-originated measures are voted by senators first.
  if (type.startsWith('s')) return SENATE_FINDER
  return HOUSE_FINDER
}

// The authoritative page for the bill itself. For state bills we only ever use
// a URL that came out of our own database — never one the model wrote and
// never one the client sent.
export function billPageUrlFor(bill, stateBillUrl) {
  if (bill?.isStateBill) {
    return isTrustedStateBillUrl(stateBillUrl) ? stateBillUrl : null
  }
  return federalBillUrl(bill?.congress, bill?.type, bill?.number)
}

const TRUSTED_STATE_BILL_HOSTS = new Set([
  'openstates.org', 'www.openstates.org',
  'legiscan.com', 'www.legiscan.com',
])

function isTrustedStateBillUrl(url) {
  if (!url || typeof url !== 'string') return false
  try {
    const u = new URL(url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false
    if (TRUSTED_STATE_BILL_HOSTS.has(u.hostname)) return true
    // State legislature sites are legitimate but unenumerable; accept .gov
    // hosts, which the scrapers are the only writers of.
    return u.hostname.endsWith('.gov')
  } catch {
    return false
  }
}

// Is this action about reading/tracking the bill, or about contacting someone?
//
// Intent is read from the action's own words rather than from the URL the
// model chose, because the URL is exactly the part it gets wrong — it will
// happily write "visit <rep finder> to read the full text". The prose is a far
// more reliable signal of what the student is being asked to do.
const READ_INTENT = /\b(read|view|track|follow|look at|see)\b[^.]*\b(bill|text|legislation|measure|status|progress|language)\b/i
const CONTACT_INTENT = /\b(contact|email|call|write|testify|tell|urge|reach out|message)\b/i
// A narrower cut of READ_INTENT: the student is being sent to the words of the
// bill, not to its status page. "Track its progress" wants the landing page;
// "read the full text" wants the document.
const TEXT_INTENT = /\b(full\s+)?(text|language|wording|bill\s+text)\b/i

function isBillPageAction(action, url) {
  const prose = `${action?.action || ''} ${action?.how || ''}`
  // An explicit contact verb wins: "email your rep about the bill" is contact.
  if (CONTACT_INTENT.test(prose)) return false
  if (READ_INTENT.test(prose)) return true
  // No clear prose signal — fall back to what the model linked to.
  return /congress\.gov\/bill\//i.test(url)
    || /legiscan\.com\//i.test(url)
    || /openstates\.org\/[a-z]{2}\//i.test(url)
}

// Collapsing several of the model's URLs onto one canonical link can leave
// visible seams in the prose: "at <url> and <url>", or an orphaned path
// fragment where the model split a URL across a space ("<url> bill/HB5518").
// Neither is wrong, but both look broken to a student.
function tidyAfterRewrite(text) {
  let out = text
  // "<url> and <url>" / "<url>, <url>" / "<url> <url>" → one link.
  out = out.replace(
    /(https?:\/\/[^\s,)\]"']+)((?:\s*(?:,|and|or)?\s*)\1)+/gi,
    '$1'
  )
  // Orphaned path fragment left over from the model's original URL.
  out = out.replace(
    /(https?:\/\/[^\s,)\]"']+)\s+(?![A-Za-z]+:)[A-Za-z0-9_-]+\/[A-Za-z0-9_./-]*/g,
    '$1'
  )
  // Tidy the punctuation the collapses can strand.
  out = out.replace(/\s+([.,;:])/g, '$1').replace(/\s{2,}/g, ' ').trim()
  return out
}

/**
 * Rewrite every URL in the analysis's civic_actions to a canonical one.
 *
 * Mutates `parsed` in place. Returns a small report so callers can log how
 * often the model needed correcting.
 */
export function sanitizeCivicActions(parsed, bill, stateBillUrl = null) {
  const actions = Array.isArray(parsed?.civic_actions) ? parsed.civic_actions : []
  if (!actions.length) return { rewritten: 0, removed: 0 }

  const contactUrl = contactUrlFor(bill)
  const billUrl = billPageUrlFor(bill, stateBillUrl)
  // State bills have no separately addressable text page we can construct from
  // the bill's identity alone, so they keep the bill page (which is the URL our
  // own database recorded for it).
  const textUrl = bill?.isStateBill
    ? billUrl
    : (federalBillTextUrl(bill?.congress, bill?.type, bill?.number) || billUrl)
  let rewritten = 0
  let removed = 0

  for (const action of actions) {
    if (!action || typeof action.how !== 'string') continue
    action.how = action.how.replace(/https?:\/\/[^\s,)\]"']+/g, match => {
      // Trailing sentence punctuation is part of the prose, not the URL.
      const trailing = match.match(/[.,;:]+$/)?.[0] || ''
      const url = trailing ? match.slice(0, -trailing.length) : match

      let replacement = contactUrl
      if (isBillPageAction(action, url)) {
        const prose = `${action?.action || ''} ${action?.how || ''}`
        replacement = (TEXT_INTENT.test(prose) ? textUrl : billUrl) || billUrl || contactUrl
      }
      if (replacement !== url) rewritten++
      return replacement + trailing
    })
    action.how = tidyAfterRewrite(action.how)
  }

  // A bill-page action on a state bill we have no trusted URL for would have
  // been rewritten to the contact link, leaving two identical actions. Drop
  // the duplicate rather than showing the same link twice.
  const seen = new Set()
  parsed.civic_actions = actions.filter(a => {
    const key = `${a?.action || ''}|${a?.how || ''}`
    if (seen.has(key)) { removed++; return false }
    seen.add(key)
    return true
  })

  return { rewritten, removed }
}
