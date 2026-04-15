/**
 * Bill text excerpt + smart sampling for LLM context management.
 *
 * Solves three problems with long / omnibus bills whose full text blows
 * through the LLM context window:
 *
 *   1. smartTruncate()             — head + middle + tail sampling
 *      Replaces naive .slice(0, N) so the first-N-tokens-are-boilerplate
 *      problem doesn't leave the LLM reading only the table of contents.
 *
 *   2. extractStructuredExcerpt()  — stable, pre-computed summary
 *      Runs at sync time. Pulls short title, findings, division headers,
 *      section 2 (usually definitions or core substance), and appropriation
 *      lines. The result is a 500-1500 word "synopsis" that the LLM sees
 *      before the truncated text. Works for bills with no CRS summary
 *      available (state bills, newly introduced bills).
 *
 *   3. getRelevantSections()       — topic-filtered section retrieval
 *      Lightweight pseudo-RAG at personalization time. Splits the bill by
 *      SEC. / SECTION markers, scores each chunk by keyword density against
 *      the student's interest topics, returns the top-scoring sections.
 *      No embeddings — keyword based, which is good enough for civic
 *      education personalization and has zero infrastructure cost.
 */

// ─── Smart truncate: head + middle + tail ────────────────────────────────────

/**
 * Truncate to maxWords, keeping the informative beginning, a middle sample,
 * and the end (effective-date / appropriation totals tend to live at the tail).
 * Works on whitespace-split word boundaries so it doesn't cut mid-sentence.
 */
export function smartTruncate(text, maxWords = 4000) {
  if (!text) return ''
  const words = text.split(/\s+/)
  if (words.length <= maxWords) return text

  // Allocation: 50% head, 25% middle, 25% tail
  const headCount = Math.floor(maxWords * 0.50)
  const middleCount = Math.floor(maxWords * 0.25)
  const tailCount = maxWords - headCount - middleCount

  const head = words.slice(0, headCount).join(' ')
  const middleStart = Math.max(headCount, Math.floor(words.length / 2) - Math.floor(middleCount / 2))
  const middle = words.slice(middleStart, middleStart + middleCount).join(' ')
  const tail = words.slice(-tailCount).join(' ')

  const skipped1 = middleStart - headCount
  const skipped2 = words.length - tailCount - (middleStart + middleCount)

  return [
    head,
    skipped1 > 0 ? `\n\n[...${skipped1.toLocaleString()} words omitted...]\n\n` : '\n\n',
    middle,
    skipped2 > 0 ? `\n\n[...${skipped2.toLocaleString()} words omitted...]\n\n` : '\n\n',
    tail,
  ].join('')
}

// ─── Structured excerpt extraction (runs at sync time) ───────────────────────

/**
 * Extract a structured "synopsis" from bill text — short title, findings,
 * major divisions, section 2 (typically definitions or core substance), and
 * any appropriation language. Designed to run once at sync time and be
 * stored in a `structured_excerpt` column so the LLM can read a pre-digested
 * overview before the (possibly truncated) full text.
 *
 * Returns null if no extractable structure is found (very short bills,
 * non-standard format). Bills where this returns null should fall through
 * to the raw text path.
 */
export function extractStructuredExcerpt(text) {
  if (!text || text.length < 500) return null
  const parts = []

  // Congress.gov's HTML-stripped text is single-lined and uses backticks
  // for quotes (`` and ''), so patterns have to be forgiving about both
  // whitespace and quote style. We normalize once for searching but quote
  // back from the original.
  const norm = text.replace(/\s+/g, ' ')

  // 1. Long title / purpose. Federal bills have "A BILL [To/Making] ..."
  // followed by the purpose statement. Must be anchored on "A BILL" —
  // without the anchor we catch random "To X" phrases mid-document.
  const longTitleMatch = norm.match(/\bA BILL\s+((?:To|Making|For)\s[^.]{20,600}\.)/i)
  if (longTitleMatch) {
    parts.push(`LONG TITLE: ${longTitleMatch[1].trim()}`)
  }

  // 2. Short title — "This Act may be cited as ``NAME''" (backticks) or
  // "as the \"NAME\"" (straight quotes). Also handles "cited as the NAME."
  const shortTitleMatch = norm.match(
    /this\s+act\s+may\s+be\s+cited\s+as\s+(?:the\s+)?(?:``|["'“])([^`"”']{5,200})(?:''|["'”])/i
  ) || norm.match(
    /this\s+act\s+may\s+be\s+cited\s+as\s+the\s+([^.]{5,200?})\./i
  )
  if (shortTitleMatch) {
    parts.push(`SHORT TITLE: ${shortTitleMatch[1].trim()}`)
  }

  // 3. Findings / Purpose section — federal bills use "SEC. N. FINDINGS" or
  // "SEC. N. PURPOSE". Pull up to ~1400 chars starting after that header.
  const findingsMatch = norm.match(
    /SEC(?:TION)?\.?\s*\d+\.\s*(FINDINGS(?:\s+AND\s+PURPOSE)?|PURPOSE|PURPOSES|STATEMENT\s+OF\s+POLICY|CONGRESSIONAL\s+FINDINGS)\s*\.?\s*([^]{200,1800}?)(?=\s+SEC(?:TION)?\.?\s*\d+\.|\Z)/i
  )
  if (findingsMatch) {
    const label = findingsMatch[1].toUpperCase().replace(/\s+/g, ' ')
    const body = findingsMatch[2].trim().slice(0, 1400)
    parts.push(`${label}:\n${body}`)
  }

  // 4. Major division / title headings (for omnibus bills)
  const divisionRegex = /\b(DIVISION\s+[A-Z]{1,3}[\s\-—]+[A-Z][A-Z0-9 ,\-—&]{5,100}|TITLE\s+[IVXLC]{1,5}[\s\-—]+[A-Z][A-Z0-9 ,\-—&]{5,100})/g
  // Dedupe aggressively: strip trailing words after the last comma/clear noun
  // boundary so "DIVISION A--FOO ACT 2026 DIVISION B--" and
  // "DIVISION A--FOO ACT, 2026 TITLE I" both collapse to "DIVISION A--FOO".
  const rawDivisions = [...norm.matchAll(divisionRegex)]
    .map((m) => m[1].replace(/\s+/g, ' ').trim())
  const normalizedSeen = new Set()
  const divisions = []
  for (const d of rawDivisions) {
    // Cut off at the next DIVISION/TITLE marker that slipped into our match
    const clean = d.split(/\s+(?:DIVISION|TITLE)\s+[A-Z]/)[0].trim().replace(/[\s.]+$/, '')
    // Normalize key: lowercase, strip punctuation spacing
    const key = clean.toLowerCase().replace(/\s+/g, ' ').slice(0, 80)
    if (normalizedSeen.has(key)) continue
    normalizedSeen.add(key)
    divisions.push(clean)
    if (divisions.length >= 14) break
  }
  if (divisions.length >= 3) {
    parts.push(`MAJOR DIVISIONS/TITLES:\n${divisions.map((d) => `  - ${d.slice(0, 140)}`).join('\n')}`)
  }

  // 5. SEC. 2 body (typically definitions or core substance; section 1 is
  // just the short title)
  const sec2Match = norm.match(
    /SEC(?:TION)?\.?\s*2\.\s*([A-Z][A-Z ,\-—]{3,100})\.\s*([^]{200,1800}?)(?=\s+SEC(?:TION)?\.?\s*[3-9]|\Z)/i
  )
  if (sec2Match) {
    const heading = sec2Match[1].replace(/\s+/g, ' ').trim()
    const body = sec2Match[2].trim().slice(0, 1400)
    parts.push(`SECTION 2 — ${heading}:\n${body}`)
  }

  // 6. Appropriation lines
  const appropRegex = /(?:there\s+(?:is|are)\s+authorized\s+to\s+be\s+appropriated|there\s+(?:is|are)\s+appropriated|is\s+appropriated\s+(?:out\s+of|to\s+carry))[^.]{10,350}\$[\d,\.]+/gi
  const approps = [...(norm.matchAll(appropRegex) || [])]
    .slice(0, 6)
    .map((m) => m[0].replace(/\s+/g, ' ').trim())
    .filter((s) => s.length > 20)
  if (approps.length >= 1) {
    parts.push(`APPROPRIATIONS:\n${approps.map((a) => `- ${a.slice(0, 300)}`).join('\n')}`)
  }

  // 7. Effective date
  const effectiveDateMatch = norm.match(
    /\b(?:this\s+act\s+shall\s+take\s+effect[^.]{5,250}\.|effective\s+date[\s.\-:—]+[^.]{5,250}\.|shall\s+apply\s+(?:to|beginning|on|with\s+respect)[^.]{5,250}\.)/i
  )
  if (effectiveDateMatch) {
    parts.push(`EFFECTIVE DATE: ${effectiveDateMatch[0].replace(/\s+/g, ' ').trim().slice(0, 300)}`)
  }

  if (parts.length < 2) return null
  return parts.join('\n\n')
}

// ─── Topic-filtered section retrieval (runs at personalization time) ─────────

// Map of app interest topics → keywords found in bill section text.
// These overlap the classifier list but are tuned for section retrieval:
// higher-signal phrases, fewer generic terms that match everywhere.
const INTEREST_SECTION_KEYWORDS = {
  education: [
    'educational', 'school ', 'student', 'teacher', 'curriculum', 'pell',
    'tuition', 'college', 'university', 'k-12', 'kindergarten', 'academic',
    'scholarship', 'literacy', 'title i', 'idea act', 'pupil',
  ],
  environment: [
    'climate', 'environmental', 'energy', 'clean ', 'pollution', 'emission',
    'renewable', 'carbon', 'greenhouse', 'conservation', 'endangered',
    'forest', 'wildlife', 'epa ', 'clean air', 'clean water', 'coal', 'solar',
  ],
  economy: [
    'wage', 'taxation', 'tax credit', 'tax deduction', 'economic', 'business',
    'commerce', 'employment', 'workforce', 'trade', 'tariff', 'small business',
    'banking', 'consumer', 'retirement', 'pension', 'labor',
  ],
  healthcare: [
    'health care', 'healthcare', 'medical', 'medicare', 'medicaid', 'drug',
    'hospital', 'insurance', 'prescription', 'pharmaceutical', 'opioid',
    'mental health', 'disease', 'vaccine', 'hospice', 'physician',
  ],
  technology: [
    'technology', 'cybersecurity', 'data privacy', 'digital', 'internet',
    'broadband', 'artificial intelligence', 'algorithm', 'semiconductor',
    'spectrum', 'telecom', '5g', 'platform', 'software',
  ],
  housing: [
    'housing', 'rental', 'homeless', 'mortgage', 'tenant', 'zoning',
    'section 8', 'public housing', 'eviction', 'landlord', 'home loan',
  ],
  immigration: [
    'immigration', 'visa', 'asylum', 'border ', 'refugee', 'deportation',
    'naturalization', 'dreamer', 'migrant', 'immigrant', 'green card',
    'customs', 'ice ',
  ],
  civil_rights: [
    'voting', 'civil rights', 'discrimination', 'police', 'racial',
    'disability', 'lgbtq', 'equal pay', 'criminal justice', 'firearm',
    'incarceration', 'parole', 'voting rights', 'census',
  ],
  community: [
    'americorps', 'volunteer', 'nonprofit', 'community', 'food assistance',
    'rural', 'snap', 'wic ', 'disaster relief', 'fema', 'agriculture',
    'farm', 'public service',
  ],
}

/**
 * Split a long bill into sections and return the ones most relevant to
 * the student's interests, up to maxChars total. Falls back to null if
 * the bill isn't section-structured enough to benefit from this.
 *
 * Always preserves section 1 (preamble / short title) and the last section
 * (effective date, totals). Interior sections are ranked by keyword density.
 */
export function getRelevantSections(text, interests = [], maxChars = 5000) {
  if (!text || text.length < 2000 || !interests.length) return null

  // Split on section markers. Congress.gov's HTML-stripped text runs without
  // newlines, so this regex matches either a newline boundary OR whitespace
  // before SEC. / SECTION markers. Keeps the marker with each section so
  // the LLM knows "SEC. 4" is a boundary.
  const sections = text.split(/\s+(?=(?:SEC\.?|SECTION|Sec\.?|§)\s*\d{1,4}\.?\s+[A-Z])/)
  if (sections.length < 4) return null // Not enough structure

  // Collect keywords for the student's interests
  const keywords = []
  for (const topic of interests) {
    for (const kw of INTEREST_SECTION_KEYWORDS[topic] || []) keywords.push(kw)
  }
  if (!keywords.length) return null

  // Score each section by how many keyword hits it contains (density-normalized)
  const scored = sections.map((sec, idx) => {
    const lower = sec.toLowerCase()
    let hits = 0
    for (const kw of keywords) {
      // Cheap includes counting (avoids regex cost on big strings)
      let from = 0
      while (true) {
        const at = lower.indexOf(kw, from)
        if (at === -1) break
        hits++
        from = at + kw.length
      }
    }
    // Density bias: a 200-word section with 10 hits beats a 2000-word one with 10
    const wordCount = sec.split(/\s+/).length || 1
    const density = hits / wordCount
    return { idx, sec, hits, density, length: sec.length }
  })

  // Always include first section (preamble) and last section (effective date).
  const selected = new Map()
  selected.set(0, scored[0])
  selected.set(scored.length - 1, scored[scored.length - 1])

  // Rank interior sections by hits * density for the fill.
  // hits alone rewards long rambling sections; density alone penalizes them
  // for being long enough to be informative. Product balances.
  const interior = scored
    .slice(1, -1)
    .filter((s) => s.hits > 0)
    .sort((a, b) => (b.hits * b.density) - (a.hits * a.density))

  let totalChars = [...selected.values()].reduce((acc, s) => acc + s.length, 0)
  for (const s of interior) {
    if (totalChars + s.length > maxChars) continue
    selected.set(s.idx, s)
    totalChars += s.length
    if (selected.size >= 10) break
  }

  if (selected.size <= 2) return null // No interest hits; caller should fall back

  // Emit in original order
  return [...selected.values()]
    .sort((a, b) => a.idx - b.idx)
    .map((s) => s.sec.trim())
    .join('\n\n')
}

/**
 * High-level picker: given bill text + optional user interests, return
 * the best content string to feed the LLM.
 *
 * Strategy:
 *   - Short bills (≤ maxWords): return as-is
 *   - Long bills + user interests with section structure: topic-filtered
 *     sections (falls back to smart truncation if no interest hits)
 *   - Long bills without user interests (batch pre-warm, etc): smart
 *     head+middle+tail truncation
 */
export function pickBillContent(text, { maxWords = 4000, userInterests = [] } = {}) {
  if (!text) return { content: '', strategy: 'empty' }
  const words = text.split(/\s+/)
  if (words.length <= maxWords) return { content: text, strategy: 'full' }

  // Budget in characters for section retrieval (approx 6 chars/word)
  const maxChars = maxWords * 6

  if (userInterests.length) {
    const sections = getRelevantSections(text, userInterests, maxChars)
    if (sections) return { content: sections, strategy: 'topic_sections' }
  }

  return {
    content: smartTruncate(text, maxWords),
    strategy: 'smart_truncate',
  }
}
