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
//
// Keyword rules:
// - Single words are matched with \b word boundaries, so 'coal' does NOT hit
//   'coalition' and 'clean' does NOT hit 'cleanse'. Compiled below into
//   INTEREST_SECTION_KEYWORD_REGEX.
// - Multi-word entries ('clean air', 'tax credit') work as substrings; the
//   space already gives us the boundary we need on each side.
// - Prefer bigrams over single words when the unigram is lexically noisy
//   ('coal' → 'coal mining' + 'coal-fired', 'clean' → 'clean air'/'clean
//   water'/'clean energy'). This keeps signal and kills false positives like
//   "clean hands doctrine" or "coalition government".
const INTEREST_SECTION_KEYWORDS = {
  education: [
    'educational', 'school', 'schools', 'schoolchildren', 'student', 'students',
    'teacher', 'teachers', 'curriculum', 'pell grant', 'tuition', 'college',
    'university', 'k-12', 'kindergarten', 'academic', 'scholarship',
    'literacy', 'title i of', 'idea act', 'pupil', 'classroom',
    'higher education', 'public school', 'charter school', 'school district',
  ],
  environment: [
    'climate', 'environmental', 'pollution', 'emission', 'emissions',
    'renewable', 'carbon', 'greenhouse', 'conservation', 'endangered',
    'forest', 'wildlife', 'epa', 'clean air', 'clean water', 'clean energy',
    'coal mining', 'coal-fired', 'solar', 'wind energy', 'natural gas',
    'oil and gas', 'drilling', 'methane',
  ],
  economy: [
    'wage', 'wages', 'minimum wage', 'taxation', 'tax credit', 'tax deduction',
    'tax cut', 'economic', 'business', 'businesses', 'commerce', 'employment',
    'workforce', 'trade', 'tariff', 'tariffs', 'small business', 'banking',
    'consumer', 'retirement', 'pension', 'labor', 'inflation',
  ],
  healthcare: [
    'health care', 'healthcare', 'medical', 'medicare', 'medicaid', 'drug',
    'drugs', 'hospital', 'hospitals', 'insurance', 'prescription',
    'pharmaceutical', 'opioid', 'mental health', 'disease', 'diseases',
    'vaccine', 'vaccines', 'hospice', 'physician', 'physicians', 'clinic',
    'clinics', 'patient', 'patients',
  ],
  technology: [
    'technology', 'cybersecurity', 'data privacy', 'digital', 'internet',
    'broadband', 'artificial intelligence', 'algorithm', 'algorithms',
    'semiconductor', 'spectrum', 'telecom', '5g', 'online platform',
    'social media', 'software', 'encryption',
  ],
  housing: [
    'housing', 'rental', 'homeless', 'homelessness', 'mortgage', 'tenant',
    'tenants', 'zoning', 'section 8', 'public housing', 'eviction', 'landlord',
    'home loan', 'affordable housing',
  ],
  immigration: [
    'immigration', 'visa', 'visas', 'asylum', 'border security',
    'border wall', 'border patrol', 'refugee', 'deportation', 'naturalization',
    'dreamer', 'migrant', 'immigrant', 'immigrants', 'green card',
    'customs enforcement', 'immigration and customs',
  ],
  civil_rights: [
    'voting', 'civil rights', 'discrimination', 'police', 'racial',
    'disability', 'lgbtq', 'equal pay', 'criminal justice', 'firearm',
    'firearms', 'incarceration', 'parole', 'voting rights', 'census',
    'gerrymandering',
  ],
  community: [
    'americorps', 'volunteer', 'nonprofit', 'community', 'food assistance',
    'rural', 'snap benefits', 'snap program', 'wic program', 'disaster relief',
    'fema', 'agriculture', 'farm', 'farmer', 'public service',
  ],
}

// Compile each keyword once. Multi-word phrases keep their literal form (the
// internal whitespace already provides a boundary on each side). Single-word
// entries get wrapped with \b ... \b so we don't match inside other words.
// We escape regex metacharacters ("5g" is safe, but "k-12", "section 8"
// contain regex-special chars).
const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g
function compileKeyword(kw) {
  const escaped = kw.replace(REGEX_SPECIALS, '\\$&')
  // Treat as "single word" only if there's no internal whitespace and no
  // dash/digit mix — for those (e.g. "k-12", "5g") we still want a left
  // boundary but a right \b would fail because "5g" ends on a letter
  // followed by nothing. The \b still works correctly at string edges.
  const isSimpleWord = /^[a-z]+$/.test(kw)
  const pattern = isSimpleWord ? `\\b${escaped}\\b` : `\\b${escaped}(?!\\w)`
  return new RegExp(pattern, 'gi')
}
const INTEREST_SECTION_KEYWORD_REGEX = Object.fromEntries(
  Object.entries(INTEREST_SECTION_KEYWORDS).map(([topic, words]) => [
    topic,
    words.map((kw) => ({ kw, re: compileKeyword(kw) })),
  ])
)

// Short-section length penalty. A hard cutoff (e.g. "reject anything under
// 50 words") blinds us to pathological high-value edges: a naked
// appropriation like "Sec. 4. $5,000,000 is appropriated to the Department
// of Energy for solar grid grants." is 13 words of pure policy impact.
//
// Instead, multiply the interior score by a soft length factor that
// squares the ratio. A 20-word section with multiple hits can still
// survive if its density is exceptional, but a random 10-word
// administrative header is quadratically suppressed.
//   words = 10  →  factor = (10/50)^2 = 0.04
//   words = 25  →  factor = (25/50)^2 = 0.25
//   words = 50+ →  factor = 1.00 (no penalty)
const LENGTH_PENALTY_TARGET = 50
function lengthPenalty(wordCount) {
  const r = Math.min(1, wordCount / LENGTH_PENALTY_TARGET)
  return r * r
}

// Effective-date detector for the tail slot. Most bills bury the effective
// date in one of the final few sections; we'd rather pin that one than
// either the severability clause (pure boilerplate) OR a random section
// near the end. Forward-scan the last 5 sections specifically for this
// pattern. If none match, return no tail — the LLM can write a good
// summary without one, but it should NOT miss the effective date just
// because severability sits in front of it.
const EFFECTIVE_DATE_PATTERNS = [
  /\bshall\s+take\s+effect\b/i,
  /\beffective\s+date\b/i,
  /\bapplicability\b/i,
  /\bapplies\s+to\b/i,
]
function looksLikeEffectiveDate(sectionText) {
  if (!sectionText) return false
  const snippet = sectionText.slice(0, 800)
  return EFFECTIVE_DATE_PATTERNS.some((re) => re.test(snippet))
}

// Single source of truth for the section-splitting regex. Both the
// request-time retriever and the sync-time precomputer split the same way
// so precomputed scores can be indexed by section position.
const SECTION_SPLIT_REGEX = /\s+(?=(?:SEC\.?|SECTION|Sec\.?|§)\s*\d{1,4}\.?\s+[A-Z])/

/**
 * Sync-time precompute: score every section of a bill against ALL topic
 * keyword lists once, store the result in bills.section_topic_scores as
 * JSONB. At request time getRelevantSections() reads these scores directly
 * instead of running the regex pass — turns a CPU-bound N×M loop into an
 * O(sections × studentTopics) JSON lookup + sum.
 *
 * Returns null for bills too short or without section structure (same
 * gate as getRelevantSections so the contract matches).
 *
 * Schema (v1):
 *   {
 *     v: 1,
 *     count: <int>,                   -- number of sections
 *     scores: [
 *       { idx: 0, wc: 45,  hits: { education: 3 } },
 *       { idx: 1, wc: 220, hits: { environment: 2, technology: 1 } },
 *       ...
 *     ]
 *   }
 *
 * Keys in `hits` only include topics with nonzero matches — keeps the
 * JSONB payload small for bills that focus on a narrow domain.
 */
export function computeSectionTopicScores(text) {
  if (!text || text.length < 2000) return null
  const sections = text.split(SECTION_SPLIT_REGEX)
  if (sections.length < 4) return null

  const scores = sections.map((sec, idx) => {
    const hits = {}
    for (const [topic, entries] of Object.entries(INTEREST_SECTION_KEYWORD_REGEX)) {
      let topicHits = 0
      for (const { re } of entries) {
        re.lastIndex = 0
        // eslint-disable-next-line no-unused-vars
        for (const _m of sec.matchAll(re)) topicHits++
      }
      if (topicHits > 0) hits[topic] = topicHits
    }
    const wordCount = sec.split(/\s+/).length || 1
    return { idx, wc: wordCount, hits }
  })

  return { v: 1, count: sections.length, scores }
}

/**
 * Split a long bill into sections and return the ones most relevant to
 * the student's interests, up to maxChars total. Falls back to null if
 * the bill isn't section-structured enough to benefit from this.
 *
 * Always preserves section 1 (preamble / short title) and the last section
 * (effective date, totals). Interior sections are ranked by keyword density.
 *
 * Fast path: if `precomputedScores` is provided and its section count
 * matches our split, use the stored topic hits directly — no regex pass.
 * Falls back to live scoring when precomputed data is stale or missing.
 */
export function getRelevantSections(text, interests = [], maxChars = 5000, precomputedScores = null) {
  if (!text || text.length < 2000 || !interests.length) return null

  // Split on section markers. Congress.gov's HTML-stripped text runs without
  // newlines, so this regex matches either a newline boundary OR whitespace
  // before SEC. / SECTION markers. Keeps the marker with each section so
  // the LLM knows "SEC. 4" is a boundary.
  const sections = text.split(SECTION_SPLIT_REGEX)
  if (sections.length < 4) return null // Not enough structure

  // Decide scoring strategy: precomputed JSONB lookup if the shape matches,
  // otherwise fall back to live regex. Stale precomputed scores (section
  // count drift) would mis-align indices, so we invalidate on mismatch.
  const precomputedValid =
    precomputedScores
    && precomputedScores.v === 1
    && precomputedScores.count === sections.length
    && Array.isArray(precomputedScores.scores)
    && precomputedScores.scores.length === sections.length

  let scored
  if (precomputedValid) {
    // Fast path — JSONB lookup. O(sections × studentTopics) summation.
    scored = sections.map((sec, idx) => {
      const entry = precomputedScores.scores[idx]
      let hits = 0
      if (entry && entry.hits) {
        for (const topic of interests) {
          if (entry.hits[topic]) hits += entry.hits[topic]
        }
      }
      const wordCount = entry?.wc || (sec.split(/\s+/).length || 1)
      const density = hits / wordCount
      return { idx, sec, hits, density, length: sec.length, wordCount }
    })
  } else {
    // Slow path — live regex scan. Collect compiled regexes for the
    // student's interests. Word-boundary matching fixes unigram collisions
    // ("coal" ≠ "coalition", "clean" ≠ "cleanse"). See compileKeyword above.
    const regexes = []
    for (const topic of interests) {
      for (const entry of INTEREST_SECTION_KEYWORD_REGEX[topic] || []) regexes.push(entry.re)
    }
    if (!regexes.length) return null

    scored = sections.map((sec, idx) => {
      let hits = 0
      for (const re of regexes) {
        re.lastIndex = 0
        // eslint-disable-next-line no-unused-vars
        for (const _m of sec.matchAll(re)) hits++
      }
      const wordCount = sec.split(/\s+/).length || 1
      const density = hits / wordCount
      return { idx, sec, hits, density, length: sec.length, wordCount }
    })
  }

  // Always include first section (preamble / short title). For the tail,
  // forward-scan the last 5 sections specifically for an effective-date /
  // applicability clause; if one matches we pin it, if not we drop the
  // tail slot entirely rather than pinning severability boilerplate or a
  // random nearby section. The old walk-backward-through-boilerplate
  // approach was unreliable when severability + rule-of-construction +
  // effective-date clustered at the end of a bill.
  const selected = new Map()
  selected.set(0, scored[0])

  const lastN = Math.min(5, scored.length)
  let tailIdx = -1
  for (let i = scored.length - 1; i >= scored.length - lastN; i--) {
    if (looksLikeEffectiveDate(scored[i].sec)) {
      tailIdx = i
      break
    }
  }
  if (tailIdx > 0) {
    selected.set(tailIdx, scored[tailIdx])
  }

  // Rank interior sections by (hits × density) × lengthPenalty(wordCount).
  //
  // hits × density is mathematically equivalent to hits² / wordCount — a
  // volume × density product so that a long rambling section can't win
  // on raw count AND a microscopic section can't win on density alone.
  //
  // The length penalty (soft, quadratic) suppresses sections under 50
  // words WITHOUT excluding them outright. A naked appropriation line
  // like "Sec. 4. $5M is appropriated for solar grants." is 10 words of
  // pure policy impact — the old hard cutoff lost those; the soft
  // penalty lets them survive if the density is strong enough.
  const interior = scored
    .slice(1, -1)
    .filter((s) => s.hits > 0)
    .sort((a, b) => {
      const aScore = (a.hits * a.density) * lengthPenalty(a.wordCount)
      const bScore = (b.hits * b.density) * lengthPenalty(b.wordCount)
      return bScore - aScore
    })

  let totalChars = [...selected.values()].reduce((acc, s) => acc + s.length, 0)
  for (const s of interior) {
    if (selected.has(s.idx)) continue // tail may have been walked backwards into interior
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
export function pickBillContent(text, { maxWords = 4000, userInterests = [], precomputedScores = null } = {}) {
  if (!text) return { content: '', strategy: 'empty' }
  const words = text.split(/\s+/)
  if (words.length <= maxWords) return { content: text, strategy: 'full' }

  // Budget in characters for section retrieval (approx 6 chars/word)
  const maxChars = maxWords * 6

  if (userInterests.length) {
    const sections = getRelevantSections(text, userInterests, maxChars, precomputedScores)
    if (sections) return { content: sections, strategy: 'topic_sections' }
  }

  return {
    content: smartTruncate(text, maxWords),
    strategy: 'smart_truncate',
  }
}
