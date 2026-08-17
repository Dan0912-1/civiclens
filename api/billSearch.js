// Helpers for exact bill-number searches. Keyword search is intentionally
// fuzzy; a query that names a bill identity is not. Keeping the type and
// number together prevents `S 5225` from silently returning `HB 5225`.

const FEDERAL_TYPES = {
  HR: 'hr', HB: 'hr',
  S: 's', SB: 's',
  HRES: 'hres', SRES: 'sres',
  HJRES: 'hjres', HJR: 'hjres',
  SJRES: 'sjres', SJR: 'sjres',
  HCONRES: 'hconres', HCR: 'hconres',
  SCONRES: 'sconres', SCR: 'sconres',
}

const STATE_TYPES = {
  HR: 'hb', HB: 'hb',
  S: 'sb', SB: 'sb',
  HRES: 'hr', SRES: 'sr',
  HJRES: 'hjr', HJR: 'hjr',
  SJRES: 'sjr', SJR: 'sjr',
  HCONRES: 'hcr', HCR: 'hcr',
  SCONRES: 'scr', SCR: 'scr',
}

const CHAMBER_TERMS = {
  HR: 'house bill', HB: 'house bill',
  S: 'senate bill', SB: 'senate bill',
  HRES: 'house resolution', SRES: 'senate resolution',
  HJR: 'house joint resolution', HJRES: 'house joint resolution',
  SJR: 'senate joint resolution', SJRES: 'senate joint resolution',
  HCR: 'house concurrent resolution', HCONRES: 'house concurrent resolution',
  SCR: 'senate concurrent resolution', SCONRES: 'senate concurrent resolution',
}

function normalizeType(type) {
  return String(type || '').toLowerCase().replace(/[.\s-]/g, '')
}

export function parseBillNumberQuery(query, jurisdiction = 'US') {
  const normalized = String(query || '')
    .replace(/\./g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
  const match = normalized.match(
    /^(HR|S|HB|SB|HRES|SRES|HJRES|SJRES|HCONRES|SCONRES|HJR|SJR|HCR|SCR)\s*(\d+)$/
  )
  if (!match) return null

  const prefix = match[1]
  const number = Number.parseInt(match[2], 10)
  const type = (jurisdiction === 'US' ? FEDERAL_TYPES : STATE_TYPES)[prefix]
  if (!type || !Number.isFinite(number)) return null

  return {
    prefix,
    type,
    number,
    searchQuery: `${CHAMBER_TERMS[prefix] || prefix.toLowerCase()} ${number}`,
  }
}

export function exactBillMatches(bills, query) {
  if (!query) return bills
  return (bills || []).filter(bill =>
    Number(bill?.number) === query.number
    && normalizeType(bill?.type) === query.type
  )
}
