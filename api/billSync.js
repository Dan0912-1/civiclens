/**
 * Bill Sync Module — Populates local bills table from three sources:
 *   1. Congress.gov (federal, free, unlimited)
 *   2. Open States / Plural (state, 1000/day, 40/min)
 *   3. LegiScan (text gap-fill only, 30K/month)
 *
 * Designed to run as a daily cron. After initial backfill, only fetches
 * bills that changed since last sync.
 */

import { extractStructuredExcerpt, computeSectionTopicScores } from './billExcerpt.js'
import { loadPDFParse } from './pdfLoader.js'

// Safety cap: a handful of state bills publish 50+ MB PDFs (full code
// rewrites). Parsing those eats memory and rarely produces useful excerpts.
const MAX_PDF_BYTES = 15 * 1024 * 1024

// Browser-like User-Agent for state legislature fetches.
//
// Some states (Indiana's iga.in.gov is a confirmed case) serve a React SPA
// shell to non-browser UAs and the actual PDF to browser UAs — the same
// URL returns a 691-byte JS loader to `CapitolKey/1.0` and a 4.2 MB PDF to
// Chrome. This is a common bot-filter pattern on state gov sites, so we
// send a realistic Chrome UA for every text-fetch request.
//
// Scope: only legislature HTML/PDF fetches inside billSync.js. The rest of
// the backend keeps its honest UA. This is consistent with how browsers
// access the same public documents — no auth, no personal data, just
// reading bill text that's intended to be publicly readable.
const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

// Thrown when Open States returns 429 (daily quota exhausted). Separated
// from generic errors so backfillStateTexts can break out of its loop
// immediately instead of burning through the remaining queue — and so the
// offending bill doesn't get a false "strike" that would shelf it for 14
// days. See the block comment on backfillStateTexts for context.
class OpenStatesRateLimitError extends Error {
  constructor(status) {
    super(`Open States rate limited (HTTP ${status})`)
    this.name = 'OpenStatesRateLimitError'
    this.status = status
  }
}

// Legacy-TLS fallback for state legislature sites.
//
// Several state legislatures (CT cga.ct.gov, MS billstatus.ls.state.ms.us)
// serve certificates with incomplete intermediate chains. Node's bundled
// CA store can't verify them even though curl and browsers (which use the
// OS CA store) have no problem. We fall back to http.get with
// rejectUnauthorized: false AFTER the strict-TLS fetch fails on a
// verification error.
//
// This is safe for our use case:
//   1. Scope: only this helper; the rest of the backend stays strict.
//   2. Content: publicly-published bill text, not secrets.
//   3. No credentials, cookies, or auth headers on these requests.
import { get as httpsGet } from 'node:https'
import { get as httpGet } from 'node:http'

function fetchInsecure(url, { timeoutMs = 20000, userAgent = BROWSER_UA } = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const opts = {
      headers: {
        'User-Agent': userAgent,
        'Accept': '*/*',
      },
      rejectUnauthorized: false, // SCOPED: gov-PDF fetch only; see block comment above
    }
    const getter = parsed.protocol === 'http:' ? httpGet : httpsGet
    const req = getter(url, opts, (res) => {
      // Follow one level of redirect manually (common on ViewDocument-style URLs)
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        const next = new URL(res.headers.location, url).toString()
        fetchInsecure(next, { timeoutMs, userAgent }).then(resolve, reject)
        return
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const chunks = []
      let total = 0
      res.on('data', (c) => {
        total += c.length
        if (total > MAX_PDF_BYTES) {
          req.destroy()
          return reject(new Error('response too large'))
        }
        chunks.push(c)
      })
      res.on('end', () => resolve({
        status: res.statusCode,
        contentType: res.headers['content-type'] || '',
        body: Buffer.concat(chunks),
      }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error('timeout'))
    })
  })
}

// Detects TLS verification errors from global fetch (undici wraps them as
// TypeError with a cause.code of UNABLE_TO_VERIFY_LEAF_SIGNATURE or similar).
function isCertError(err) {
  const code = err?.cause?.code || err?.code
  return code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
         code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
         code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
         code === 'CERT_HAS_EXPIRED' ||
         code === 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY'
}

// ─── Topic classification ──────────────────────────────────────────────────
// Maps raw subjects from Congress.gov and Open States to our app interest keys.
// Congress.gov uses "policyArea" (single string) and "subjects" (array).
// Open States uses "subject" (array of strings, varies by state).

const SUBJECT_TO_TOPIC = {
  // Congress.gov policyAreas → app topics
  'Education': 'education',
  'Higher Education': 'education',
  'Elementary and Secondary Education': 'education',
  'Environmental Protection': 'environment',
  'Energy': 'environment',
  'Public Lands and Natural Resources': 'environment',
  'Water Resources Development': 'environment',
  'Economics and Public Finance': 'economy',
  'Finance and Financial Sector': 'economy',
  'Taxation': 'economy',
  'Commerce': 'economy',
  'Labor and Employment': 'economy',
  'Health': 'healthcare',
  'Science, Technology, Communications': 'technology',
  'Housing and Community Development': 'housing',
  'Immigration': 'immigration',
  'Civil Rights and Liberties, Minority Issues': 'civil_rights',
  'Crime and Law Enforcement': 'civil_rights',
  'Social Welfare': 'community',
  'Agriculture and Food': 'community',

  // Open States common subjects → app topics
  'education': 'education',
  'higher education': 'education',
  'K-12 education': 'education',
  'schools': 'education',
  'teachers': 'education',
  'universities': 'education',
  'environment': 'environment',
  'climate': 'environment',
  'energy': 'environment',
  'natural resources': 'environment',
  'pollution': 'environment',
  'water': 'environment',
  'economy': 'economy',
  'business': 'economy',
  'labor': 'economy',
  'employment': 'economy',
  'taxes': 'economy',
  'taxation': 'economy',
  'wages': 'economy',
  'workforce': 'economy',
  'health': 'healthcare',
  'healthcare': 'healthcare',
  'mental health': 'healthcare',
  'medicaid': 'healthcare',
  'public health': 'healthcare',
  'technology': 'technology',
  'internet': 'technology',
  'data privacy': 'technology',
  'cybersecurity': 'technology',
  'artificial intelligence': 'technology',
  'telecommunications': 'technology',
  'housing': 'housing',
  'homelessness': 'housing',
  'rent': 'housing',
  'zoning': 'housing',
  'immigration': 'immigration',
  'refugees': 'immigration',
  'civil rights': 'civil_rights',
  'voting': 'civil_rights',
  'discrimination': 'civil_rights',
  'police': 'civil_rights',
  'criminal justice': 'civil_rights',
  'guns': 'civil_rights',
  'firearms': 'civil_rights',
  'community development': 'community',
  'agriculture': 'community',
  'food': 'community',
  'nonprofit': 'community',
  'social services': 'community',
}

// Keyword-based fallback: if subject mapping doesn't match, scan title
// AND the first 500 words of full_text (which carries far more signal than
// titles alone — many real bills have bland "Protecting Americans Act"-style
// titles but their text reveals the actual policy area).
const TITLE_KEYWORDS_TO_TOPIC = [
  { keywords: ['student', 'school', 'education', 'teacher', 'college', 'university', 'tuition', 'pell grant', 'scholarship', 'curriculum', 'classroom', 'literacy', 'stem', 'k-12', 'preschool', 'kindergarten', 'academic'], topic: 'education' },
  { keywords: ['climate', 'environment', 'clean energy', 'carbon', 'pollution', 'renewable', 'electric vehicle', 'wildlife', 'energy', 'solar', 'wind power', 'emission', 'greenhouse', 'conservation', 'forest', 'endangered', 'national park', 'epa ', 'toxic', 'clean water', 'clean air', 'coal', 'oil', 'natural gas', 'offshore drilling'], topic: 'environment' },
  { keywords: ['minimum wage', 'workforce', 'small business', 'unemployment', 'tax', 'cost of living', 'wage', 'inflation', 'trade', 'tariff', 'banking', 'consumer protection', 'bankruptcy', 'credit card', 'economic', 'fiscal', 'budget', 'deficit', 'commerce', 'retirement', 'social security', 'pension', 'labor union', 'industry'], topic: 'economy' },
  { keywords: ['health', 'mental', 'medicaid', 'drug', 'insurance', 'telehealth', 'substance', 'medicare', 'hospital', 'physician', 'prescription', 'pharmaceutical', 'opioid', 'fentanyl', 'addiction', 'disease', 'cancer', 'diabetes', 'abortion', 'reproductive', 'medical', 'nursing', 'hospice', 'vaccine', 'epidemic', 'pandemic'], topic: 'healthcare' },
  { keywords: ['artificial intelligence', 'data privacy', 'broadband', 'social media', 'cyber', 'algorithm', 'internet', ' ai ', 'machine learning', 'deepfake', 'digital', 'software', 'technology', 'semiconductor', 'quantum', 'spectrum', 'telecom', '5g', 'blockchain', 'cryptocurrency'], topic: 'technology' },
  { keywords: ['housing', 'rent', 'homeless', 'mortgage', 'tenant', 'zoning', 'affordable housing', 'section 8', 'public housing', 'eviction', 'real estate', 'landlord', 'home loan', 'first-time buyer'], topic: 'housing' },
  { keywords: ['immigration', 'daca', 'visa', 'asylum', 'citizen', 'border', 'refugee', 'deportat', 'naturalization', 'dreamer', 'undocumented', 'migrant', 'ice ', 'immigrant', 'green card', 'guest worker', 'customs'], topic: 'immigration' },
  { keywords: ['voting', 'civil rights', 'discrimination', 'police', 'racial', 'disability', 'lgbtq', 'equal pay', 'criminal justice', 'gun ', 'firearm', 'second amendment', 'incarceration', 'prison', 'parole', 'death penalty', 'hate crime', 'free speech', 'privacy rights', 'voting rights', 'elections', 'census', 'ballot', 'veteran benefits'], topic: 'civil_rights' },
  { keywords: ['americorps', 'volunteer', 'nonprofit', 'community', 'food assistance', 'library', 'rural', 'snap', 'food stamp', 'wic ', 'disaster relief', 'fema', 'agriculture', 'farm', 'rural development', 'public service', 'charity', 'philanthropy', 'senior center', 'childcare'], topic: 'community' },
]

function classifyTopics(subjects, title, fullText = null) {
  const topics = new Set()

  // 1. Map known subjects
  for (const subj of subjects) {
    const lower = subj.toLowerCase()
    // Try exact match first
    if (SUBJECT_TO_TOPIC[subj]) topics.add(SUBJECT_TO_TOPIC[subj])
    // Then case-insensitive
    else if (SUBJECT_TO_TOPIC[lower]) topics.add(SUBJECT_TO_TOPIC[lower])
    // Then partial match
    else {
      for (const [key, topic] of Object.entries(SUBJECT_TO_TOPIC)) {
        if (lower.includes(key.toLowerCase()) || key.toLowerCase().includes(lower)) {
          topics.add(topic)
          break
        }
      }
    }
  }

  // 2. Keyword scan from title + first 800 words of full_text if provided.
  // We always run this (not just when subjects fail) so full-text signal can
  // add topics that subject tags missed. Multi-topic bills score better.
  const corpus = [
    (title || '').toLowerCase(),
    fullText ? fullText.toLowerCase().split(/\s+/).slice(0, 800).join(' ') : '',
  ].join(' ')
  if (corpus.trim()) {
    for (const { keywords, topic } of TITLE_KEYWORDS_TO_TOPIC) {
      // Require at least 2 keyword hits if classifying from full_text to avoid
      // single-mention false positives. Title alone needs only 1.
      const titleLower = (title || '').toLowerCase()
      const titleHit = keywords.some(kw => titleLower.includes(kw))
      if (titleHit) { topics.add(topic); continue }
      if (fullText) {
        let hits = 0
        for (const kw of keywords) {
          if (corpus.includes(kw)) hits++
          if (hits >= 2) { topics.add(topic); break }
        }
      }
    }
  }

  return [...topics]
}

// ─── Status normalization ──────────────────────────────────────────────────
function normalizeStatus(rawStatus, latestAction) {
  // Both status descriptor and latest-action text carry stage signal; callers
  // often pass one empty (e.g. Congress.gov sync passes '' for rawStatus), so
  // we scan the combined string instead of treating them separately.
  const combined = `${rawStatus || ''} ${latestAction || ''}`.toLowerCase()

  if (/signed\s+by\s+(the\s+)?(president|governor)|became\s+(public\s+)?law|\bpublic\s+law\s+no|\benacted\b|chaptered/.test(combined)) return 'enacted'
  if (/\bvetoed\b/.test(combined)) return 'vetoed'
  if (/\b(failed|defeated|withdrawn|tabled|died)\b/.test(combined)) return 'failed'
  if (/passed\s+both|enrolled|presented\s+to\s+(the\s+)?(president|governor)/.test(combined)) return 'passed_both'
  if (/passed\s+(the\s+)?(house|senate)|\bpassed\b|engrossed/.test(combined)) return 'passed_one'
  if (/floor\s+(vote|consideration|calendar)/.test(combined)) return 'floor_vote'
  if (/committee|reported|markup|subcommittee|referred/.test(combined)) return 'in_committee'
  return 'introduced'
}

// ─── Congress.gov sync ─────────────────────────────────────────────────────
// Free API, rate limit ~80/min. We pace at 1 req/sec to be safe.

async function syncCongressGov(supabase, congressApiKey, options = {}) {
  const { since, congress = 119, onProgress } = options
  const BASE = 'https://api.congress.gov/v3'
  const headers = { 'X-Api-Key': congressApiKey }
  let totalSynced = 0
  let totalCalls = 0

  const sinceDate = since || new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  console.log(`[sync:congress] Starting federal sync since ${sinceDate}, congress=${congress}`)

  // Fetch recently updated bills (paginate until we hit bills older than sinceDate)
  let offset = 0
  const limit = 250
  let done = false

  while (!done) {
    const url = `${BASE}/bill/${congress}?offset=${offset}&limit=${limit}&sort=updateDate+desc&format=json`
    const resp = await fetch(url, { headers })
    totalCalls++

    if (!resp.ok) {
      console.error(`[sync:congress] API error ${resp.status} at offset ${offset}`)
      break
    }

    const data = await resp.json()
    const bills = data.bills || []

    if (!bills.length) break

    for (const bill of bills) {
      // Stop if we've gone past our since date
      if (bill.updateDate && bill.updateDate < sinceDate) {
        done = true
        break
      }

      const billType = bill.type?.toLowerCase() || ''
      const billNumber = bill.number
      const congressBillId = `${congress}-${billType}-${billNumber}`

      // Upsert bill metadata
      const row = {
        congress_bill_id: congressBillId,
        jurisdiction: 'US',
        session: String(congress),
        bill_type: billType,
        bill_number: billNumber,
        title: bill.title || '',
        status: bill.latestAction?.text || '',
        status_stage: normalizeStatus('', bill.latestAction?.text),
        latest_action: bill.latestAction?.text || null,
        latest_action_date: bill.latestAction?.actionDate || null,
        origin_chamber: bill.originChamber || null,
        url: bill.url || `https://www.congress.gov/bill/${congress}th-congress/${billType === 's' ? 'senate' : 'house'}-bill/${billNumber}`,
        subjects: bill.subjects?.legislativeSubjects?.map(s => s.name) || [],
        topics: classifyTopics(
          [bill.policyArea?.name, ...(bill.subjects?.legislativeSubjects?.map(s => s.name) || [])].filter(Boolean),
          bill.title
        ),
        source: 'congress_gov',
        updated_at: bill.updateDate || new Date().toISOString(),
        synced_at: new Date().toISOString(),
      }

      const { error } = await supabase
        .from('bills')
        .upsert(row, { onConflict: 'congress_bill_id' })

      if (error) {
        console.error(`[sync:congress] Upsert error for ${congressBillId}:`, error.message)
      } else {
        totalSynced++
      }
    }

    offset += limit
    if (onProgress) onProgress({ phase: 'congress_gov', synced: totalSynced, calls: totalCalls })

    // Rate limit: 1 req/sec
    await sleep(1000)
  }

  // Phase 2: Fetch text for bills that don't have it yet
  const { data: needText } = await supabase
    .from('bills')
    .select('id, congress_bill_id, bill_type, bill_number, session')
    .eq('jurisdiction', 'US')
    .is('full_text', null)
    .order('updated_at', { ascending: false })
    .limit(500) // Congress.gov is unlimited — pull aggressively per run

  if (needText?.length) {
    console.log(`[sync:congress] Fetching text for ${needText.length} bills`)
    for (const bill of needText) {
      try {
        const textUrl = `${BASE}/bill/${bill.session}/${bill.bill_type}/${bill.bill_number}/text?format=json`
        const textResp = await fetch(textUrl, { headers })
        totalCalls++

        if (textResp.ok) {
          const textData = await textResp.json()
          const versions = textData.textVersions || []
          // Get the latest version
          const latest = versions[0]
          if (latest) {
            // Congress.gov provides formatted text URL — fetch plain text
            const txtFormat = latest.formats?.find(f => f.type === 'Formatted Text')
            let fullText = null
            let wordCount = 0

            if (txtFormat?.url) {
              const txtResp = await fetch(txtFormat.url, { headers })
              totalCalls++
              if (txtResp.ok) {
                fullText = await txtResp.text()
                // Strip HTML tags if present
                fullText = fullText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
                wordCount = fullText.split(/\s+/).length
              }
              await sleep(1000)
            }

            await supabase
              .from('bills')
              .update({
                full_text: fullText,
                text_word_count: wordCount,
                text_version: latest.type || 'Unknown',
                structured_excerpt: fullText ? extractStructuredExcerpt(fullText) : null,
                section_topic_scores: fullText ? computeSectionTopicScores(fullText) : null,
                synced_at: new Date().toISOString(),
              })
              .eq('id', bill.id)
          }
        }
        await sleep(1000) // Rate limit
      } catch (err) {
        console.error(`[sync:congress] Text fetch error for ${bill.congress_bill_id}:`, err.message)
      }
    }
  }

  // Phase 3: Fetch CRS summaries for bills missing them
  const { data: needSummary } = await supabase
    .from('bills')
    .select('id, congress_bill_id, bill_type, bill_number, session')
    .eq('jurisdiction', 'US')
    .is('crs_summary', null)
    .not('full_text', 'is', null) // Only for bills we already have text for
    .order('updated_at', { ascending: false })
    .limit(200)

  if (needSummary?.length) {
    console.log(`[sync:congress] Fetching summaries for ${needSummary.length} bills`)
    for (const bill of needSummary) {
      try {
        const sumUrl = `${BASE}/bill/${bill.session}/${bill.bill_type}/${bill.bill_number}/summaries?format=json`
        const sumResp = await fetch(sumUrl, { headers })
        totalCalls++

        if (sumResp.ok) {
          const sumData = await sumResp.json()
          const summaries = sumData.summaries || []
          const latest = summaries[summaries.length - 1] // Most detailed version
          if (latest?.text) {
            const cleanSummary = latest.text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
            await supabase
              .from('bills')
              .update({ crs_summary: cleanSummary, synced_at: new Date().toISOString() })
              .eq('id', bill.id)
          }
        }
        await sleep(1000)
      } catch (err) {
        console.error(`[sync:congress] Summary fetch error for ${bill.congress_bill_id}:`, err.message)
      }
    }
  }

  console.log(`[sync:congress] Done: ${totalSynced} bills synced, ${totalCalls} API calls`)
  return { synced: totalSynced, calls: totalCalls }
}

// ─── Open States sync ──────────────────────────────────────────────────────
// 1,000 calls/day, 40/min. REST API v3 — paginated GET /bills endpoint.

const OPENSTATES_BASE = 'https://v3.openstates.org'

// Map of state codes to state names (Open States v3 uses full names for jurisdiction param)
const STATE_NAMES = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas',
  CA: 'California', CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas',
  KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi',
  MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma',
  OR: 'Oregon', PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina',
  SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas', UT: 'Utah',
  VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia',
  WI: 'Wisconsin', WY: 'Wyoming', DC: 'District of Columbia',
}

async function syncOpenStates(supabase, apiKey, options = {}) {
  const { since, states, onProgress } = options
  const sinceDate = since || new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const statesToSync = states || Object.keys(STATE_NAMES)
  let totalSynced = 0
  let totalCalls = 0

  console.log(`[sync:openstates] Starting state sync for ${statesToSync.length} states since ${sinceDate}`)

  for (const stateCode of statesToSync) {
    const stateName = STATE_NAMES[stateCode]
    if (!stateName) continue

    try {
      let page = 1
      let hasMore = true

      while (hasMore) {
        // include=versions is free on the list endpoint and lets us skip bills
        // that have no text URLs at all — preventing tens of thousands of
        // metadata-only state-bill rows that the feed can never surface.
        // URLSearchParams can't express repeated keys via the object form, so
        // we append twice.
        const params = new URLSearchParams({
          jurisdiction: stateName,
          updated_since: sinceDate,
          per_page: '20',
          page: String(page),
          apikey: apiKey,
        })
        params.append('include', 'sponsorships')
        params.append('include', 'versions')

        const resp = await fetch(`${OPENSTATES_BASE}/bills?${params}`)
        totalCalls++

        if (!resp.ok) {
          const errText = await resp.text()
          console.error(`[sync:openstates] API error for ${stateCode}: ${resp.status} ${errText.slice(0, 200)}`)
          break
        }

        const data = await resp.json()
        const bills = data.results || []
        const pagination = data.pagination || {}
        let pageSkipped = 0

        for (const bill of bills) {
          // Parse bill identifier (e.g., "HB 1234", "SB 42", "AB 2447")
          const match = bill.identifier?.match(/^([A-Z]+)\s*(\d+)$/i)
          if (!match) continue

          // Skip bills with no text versions at all. These can't ever become
          // feed-eligible (the ranker requires full_text), so ingesting them
          // just wastes DB rows and backfill quota. When Open States later
          // attaches a version, updated_at will bump and we'll re-encounter
          // the bill on the next sync.
          const versions = bill.versions || []
          const hasAnyLink = versions.some(v => (v.links || []).some(l => l.url))
          if (!hasAnyLink) {
            pageSkipped++
            continue
          }

          const billType = match[1].toLowerCase()
          const billNumber = parseInt(match[2], 10)
          const session = bill.session || ''
          const subjects = bill.subject || []
          const sponsors = (bill.sponsorships || []).map(s => s.name)

          const row = {
            openstates_id: bill.id,
            jurisdiction: stateCode,
            session,
            bill_type: billType,
            bill_number: billNumber,
            title: bill.title || '',
            status: bill.latest_action_description || '',
            status_stage: normalizeStatus(bill.classification?.[0] || '', bill.latest_action_description),
            latest_action: bill.latest_action_description || null,
            latest_action_date: bill.latest_action_date || null,
            origin_chamber: bill.from_organization?.classification === 'upper' ? 'Senate' : 'House',
            url: bill.openstates_url || null,
            subjects,
            topics: classifyTopics(subjects, bill.title),
            sponsors,
            source: 'openstates',
            updated_at: bill.updated_at || new Date().toISOString(),
            synced_at: new Date().toISOString(),
          }

          const { error } = await supabase
            .from('bills')
            .upsert(row, { onConflict: 'openstates_id' })

          if (error) {
            if (error.code === '23505') {
              await supabase
                .from('bills')
                .update(row)
                .eq('jurisdiction', stateCode)
                .eq('session', session)
                .eq('bill_type', billType)
                .eq('bill_number', billNumber)
            } else {
              console.error(`[sync:openstates] Upsert error for ${stateCode} ${bill.identifier}:`, error.message)
            }
          } else {
            totalSynced++
          }
        }

        if (pageSkipped) {
          console.log(`[sync:openstates] ${stateCode} p${page}: skipped ${pageSkipped} bills with no version links`)
        }

        hasMore = page < pagination.max_page
        page++

        // Rate limit: stay well under 40/min (1.5s between calls)
        await sleep(1500)
      }

      if (onProgress) onProgress({ phase: 'openstates', state: stateCode, synced: totalSynced, calls: totalCalls })

    } catch (err) {
      console.error(`[sync:openstates] Error syncing ${stateCode}:`, err.message)
    }
  }

  console.log(`[sync:openstates] Done: ${totalSynced} bills synced across ${statesToSync.length} states, ${totalCalls} API calls`)
  return { synced: totalSynced, calls: totalCalls }
}

// ─── LegiScan bulk catalog sync ─────────────────────────────────────────────
// Ingests the full bill catalog for a session via one getMasterList call per
// state. Our Open States sync uses updated_since=yesterday and misses bills
// that haven't had recent activity — leaving MA at 284/8,424 (3%) coverage
// until this was added. LegiScan returns the entire session's bill list in
// one call (~1MB JSON for MA, ~30 fields per bill inc. bill_id, number,
// title, status, latest_action, change_hash). No auth beyond the API key,
// and the free tier's 30k queries/month covers all 50 states daily at a
// negligible 1,500/month.
//
// Dedup strategy: match existing rows by (jurisdiction, bill_type, bill_number)
// ignoring session — most states have one active session at a time, and this
// avoids the cross-source session-format mismatch (Open States stores "194th"
// where LegiScan has "194th General Court"). Existing row's enrichment
// (full_text, openstates_id, topics, subjects, sponsors) is preserved —
// updates only touch the LegiScan-sourced fields.

// Some states store session in a format our synthesizers expect (MA:"194th",
// TN:"114"). LegiScan's session_name is richer ("194th General Court"); we
// normalize to match existing rows + keep synthesizers working.
const LEGISCAN_SESSION_NORMALIZERS = {
  MA: (info) => info.session_name?.match(/^(\d+(?:st|nd|rd|th))/)?.[1] || info.session_name,
  IL: (info) => info.session_name?.match(/^(\d+(?:st|nd|rd|th))/)?.[1] || info.session_name,
  TN: (info) => String(info.session_name?.match(/^(\d+)/)?.[1] || info.year_start),
  NE: (info) => String(info.session_name?.match(/^(\d+)/)?.[1] || info.year_start),
  IA: (info) => `${info.year_start}-${info.year_end}`,
  NY: (info) => `${info.year_start}-${info.year_end}`,
  WI: (info) => String(info.year_start),
  CT: (info) => String(info.year_end || info.year_start),
  RI: (info) => String(info.year_end || info.year_start),
}

function normalizeLegiScanSession(sessionInfo, state) {
  const fn = LEGISCAN_SESSION_NORMALIZERS[state]
  if (fn) return fn(sessionInfo)
  return sessionInfo.session_title || sessionInfo.session_name || String(sessionInfo.session_id)
}

function parseLegiScanBillNumber(number) {
  const s = String(number || '').trim()
  // Standard: "HB1", "AB 74", "ACR200" — common 46-state format.
  const m = s.match(/^([A-Z]+)\s*(\d+)$/)
  if (m) return { type: m[1].toLowerCase(), number: parseInt(m[2], 10) }
  // DC: "B26-0001" — type + 2-digit council + hyphen + 4-digit number.
  // Drop the council prefix; our session column carries that info already.
  const dc = s.match(/^([A-Z]+)\d{2}-(\d+)$/)
  if (dc) return { type: dc[1].toLowerCase(), number: parseInt(dc[2], 10) }
  // Amendment/variant suffix ("LB13A", "AB74A"): letter-suffixed duplicates
  // of base bills. Silently skip — the base bill is already in the catalog
  // and ingesting duplicates would trigger UNIQUE(bill_type, bill_number).
  return { type: null, number: null }
}

// LegiScan occasionally emits "0000-00-00" for unset dates (seen in TX
// masterlist). Postgres rejects that as out-of-range; treat it as null.
function sanitizeLegiScanDate(d) {
  if (!d || d === '0000-00-00') return null
  return d
}

async function syncLegiScanCatalog(supabase, apiKey, options = {}) {
  const { states = [] } = options
  if (!apiKey) {
    console.warn('[legiscan-catalog] No LEGISCAN_API_KEY configured')
    return { totalNew: 0, totalUpdated: 0, totalTextInvalidated: 0 }
  }

  let totalNew = 0
  let totalUpdated = 0
  let totalTextInvalidated = 0

  for (const state of states) {
    try {
      console.log(`[legiscan-catalog] ${state}: fetching getMasterList`)
      const url = `https://api.legiscan.com/?key=${apiKey}&op=getMasterList&state=${state}`
      const resp = await fetch(url, { signal: AbortSignal.timeout(30000) })
      if (!resp.ok) {
        console.error(`[legiscan-catalog] ${state}: HTTP ${resp.status}`)
        continue
      }
      const json = await resp.json()
      if (json.status !== 'OK' || !json.masterlist) {
        console.error(`[legiscan-catalog] ${state}: ${JSON.stringify(json).slice(0,200)}`)
        continue
      }

      const sessionInfo = json.masterlist.session
      // Stale-session safeguard. getMasterList with no session param returns
      // what LegiScan calls "current", which for biennial states between
      // regular sessions is the most-recently-adjourned one. Without this
      // guard, an 2026-04-20 run imports 12k+ TX bills from the 2025 session
      // that ended in June — real bills, but not fresh, and we'd re-import
      // them every day forever.
      //
      // Skip if LegiScan flags the session as adjourned sine die, OR if the
      // session ended before last year. Active special sessions still have
      // sine_die=0 and pass through.
      const nowYear = new Date().getUTCFullYear()
      if (sessionInfo.sine_die === 1 || (sessionInfo.year_end && sessionInfo.year_end < nowYear - 1)) {
        console.log(`[legiscan-catalog] ${state}: skipping — session "${sessionInfo.session_name}" is closed (sine_die=${sessionInfo.sine_die}, year_end=${sessionInfo.year_end})`)
        continue
      }
      const session = normalizeLegiScanSession(sessionInfo, state)
      const lsBills = Object.entries(json.masterlist)
        .filter(([k]) => k !== 'session')
        .map(([, b]) => b)
        .filter(b => b && b.bill_id)

      // Second staleness guard: biennial states (TX, ND, MT) keep sine_die=0
      // through the off-year, so the flag alone lets adjourned sessions
      // through. Check the newest last_action_date in the masterlist — if
      // every bill has been quiet for 90+ days, the session is effectively
      // closed even if LegiScan hasn't flipped the flag yet. Active
      // legislatures show action within a couple weeks; TX/ND last acted
      // 300+ days ago when this guard was added.
      const STALE_DAYS = 90
      const actionDates = lsBills
        .map(b => b.last_action_date)
        .filter(d => d && d !== '0000-00-00')
        .sort()
      const newestAction = actionDates[actionDates.length - 1]
      if (newestAction) {
        const daysSince = Math.floor((Date.now() - new Date(newestAction).getTime()) / 86400000)
        if (daysSince > STALE_DAYS) {
          console.log(`[legiscan-catalog] ${state}: skipping — session "${sessionInfo.session_name}" has no activity in ${daysSince}d (newest action ${newestAction}, sine_die=${sessionInfo.sine_die})`)
          continue
        }
      }

      // Read existing rows to dedupe. Match by (bill_type, bill_number)
      // ignoring session so we catch openstates-sourced rows with a
      // different session string format. Supabase caps single SELECTs at
      // 1000 rows silently — paginate with range() so we see every row,
      // otherwise re-runs against states with >1000 bills double-insert.
      const existing = []
      const PAGE = 1000
      for (let from = 0; ; from += PAGE) {
        const { data: page = [], error } = await supabase
          .from('bills')
          .select('id, bill_type, bill_number, session, legiscan_bill_id, change_hash, source')
          .eq('jurisdiction', state)
          .range(from, from + PAGE - 1)
        if (error) { console.error(`[legiscan-catalog] ${state} existing-rows err:`, error.message); break }
        existing.push(...page)
        if (page.length < PAGE) break
      }
      // Two-tier map: session-scoped (authoritative) + session-agnostic (fallback
      // for cross-source string-format mismatches like "194th" vs "194th General
      // Court"). If multiple rows share the same natural key across sessions,
      // prefer the session-matched one; otherwise take the first to avoid
      // duplicate-key inserts. This is the fix for the dedup gap where an
      // Open States row with a different session string would get re-inserted
      // by LegiScan and trigger the UNIQUE(jurisdiction,session,bill_type,
      // bill_number) violation.
      const existingBySession = new Map()
      const existingAnySession = new Map()
      for (const b of existing) {
        const nat = `${b.bill_type}-${b.bill_number}`
        existingBySession.set(`${b.session}::${nat}`, b)
        if (!existingAnySession.has(nat)) existingAnySession.set(nat, b)
      }
      const lookupExisting = (type, number) => {
        const nat = `${type}-${number}`
        return existingBySession.get(`${session}::${nat}`) || existingAnySession.get(nat) || null
      }

      const toInsert = []
      const toUpdate = []
      const nowIso = new Date().toISOString()

      for (const ls of lsBills) {
        const { type, number } = parseLegiScanBillNumber(ls.number)
        if (!type || !number) continue
        const prev = lookupExisting(type, number)

        if (!prev) {
          toInsert.push({
            legiscan_bill_id: ls.bill_id,
            jurisdiction: state,
            session,
            bill_type: type,
            bill_number: number,
            title: ls.title || '',
            description: ls.description || null,
            status: ls.status != null ? String(ls.status) : null,
            latest_action: ls.last_action || null,
            latest_action_date: sanitizeLegiScanDate(ls.last_action_date),
            url: ls.url || null,
            change_hash: ls.change_hash || null,
            source: 'legiscan',
            synced_at: nowIso,
            updated_at: nowIso,
          })
        } else if (prev.change_hash !== ls.change_hash || !prev.legiscan_bill_id) {
          // Existing row — refresh LegiScan-sourced fields only.
          // Don't touch openstates_id, topics, subjects, sponsors.
          // Postgres' ON CONFLICT DO UPDATE still type-checks the proposed
          // INSERT row, so NOT NULL columns (jurisdiction, bill_type,
          // bill_number) must be present even for a pure update.
          //
          // Refetch policy: when change_hash differs AND we previously had
          // full_text, null it out so the next text-fetch pass re-pulls the
          // latest version (amendments, substitutes, enrollment). Hash match
          // means text is unchanged — preserve the cached full_text. First
          // attach (no prior change_hash) also preserves text since the null
          // isn't a real version-change signal.
          const textChanged = prev.change_hash && ls.change_hash && prev.change_hash !== ls.change_hash
          const update = {
            id: prev.id,
            jurisdiction: state,
            bill_type: prev.bill_type,
            bill_number: prev.bill_number,
            // Preserve the existing source tag so Open States-sourced rows
            // keep source='openstates' and retain hybrid-fallback access to
            // their openstates_id. LegiScan ID is additive, not a replacement.
            source: prev.source || 'legiscan',
            legiscan_bill_id: ls.bill_id,
            title: ls.title || '',
            status: ls.status != null ? String(ls.status) : null,
            latest_action: ls.last_action || null,
            latest_action_date: sanitizeLegiScanDate(ls.last_action_date),
            url: ls.url || null,
            change_hash: ls.change_hash || null,
            updated_at: nowIso,
          }
          if (textChanged) {
            update.full_text = null
            update.synced_at = null // let nightly text pass pick it up
          }
          toUpdate.push(update)
        }
      }

      // Batch inserts
      for (let i = 0; i < toInsert.length; i += 500) {
        const chunk = toInsert.slice(i, i + 500)
        const { error } = await supabase.from('bills').insert(chunk)
        if (error) console.error(`[legiscan-catalog] ${state} insert err:`, error.message)
      }

      // Batch updates — upsert by id preserves untouched columns.
      for (let i = 0; i < toUpdate.length; i += 500) {
        const chunk = toUpdate.slice(i, i + 500)
        const { error } = await supabase.from('bills').upsert(chunk, { onConflict: 'id' })
        if (error) console.error(`[legiscan-catalog] ${state} update err:`, error.message)
      }

      const textInvalidated = toUpdate.filter(u => u.full_text === null).length
      console.log(`[legiscan-catalog] ${state}: +${toInsert.length} new, ${toUpdate.length} refreshed, ${textInvalidated} text-invalidated (session=${session}, ${lsBills.length} LS total)`)
      totalNew += toInsert.length
      totalUpdated += toUpdate.length
      totalTextInvalidated += textInvalidated

      // Polite pacing: 1 LegiScan call per state per second
      await new Promise(r => setTimeout(r, 1000))
    } catch (err) {
      console.error(`[legiscan-catalog] ${state} fatal:`, err.message)
    }
  }

  return { totalNew, totalUpdated, totalTextInvalidated }
}

// ─── LegiScan text gap-fill ────────────────────────────────────────────────
// Only used for bills missing full_text after Congress.gov and Open States.
// Pace: 8/min to stay well under limits.

async function syncLegiScanTexts(supabase, apiKey, options = {}) {
  const { limit: maxBills = 80 } = options
  let totalSynced = 0
  let totalCalls = 0

  // Find bills that have no text and haven't been tried recently
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() // Don't retry within 24h
  const { data: needText } = await supabase
    .from('bills')
    .select('id, jurisdiction, bill_type, bill_number, session, legiscan_bill_id, title')
    .is('full_text', null)
    .lt('synced_at', cutoff)
    .order('updated_at', { ascending: false })
    .limit(maxBills)

  if (!needText?.length) {
    console.log('[sync:legiscan] No bills need text gap-fill')
    return { synced: 0, calls: 0 }
  }

  console.log(`[sync:legiscan] Filling text for ${needText.length} bills`)

  for (const bill of needText) {
    try {
      let billData = null

      if (bill.legiscan_bill_id) {
        // Direct fetch by LegiScan ID
        const url = `https://api.legiscan.com/?key=${apiKey}&op=getBill&id=${bill.legiscan_bill_id}`
        const resp = await fetch(url)
        totalCalls++
        if (resp.ok) {
          const data = await resp.json()
          billData = data.bill
        }
      } else {
        // Search for it
        const state = bill.jurisdiction === 'US' ? 'US' : bill.jurisdiction
        const searchTerm = `${bill.bill_type.toUpperCase()} ${bill.bill_number}`
        const url = `https://api.legiscan.com/?key=${apiKey}&op=search&state=${state}&query=${encodeURIComponent(searchTerm)}`
        const resp = await fetch(url)
        totalCalls++
        if (resp.ok) {
          const data = await resp.json()
          const results = data.searchresult ? Object.values(data.searchresult).filter(r => r.bill_id) : []
          const match = results.find(r =>
            r.bill_number?.replace(/\s/g, '').toLowerCase() === `${bill.bill_type}${bill.bill_number}`
          )
          if (match) {
            // Fetch full bill
            const billUrl = `https://api.legiscan.com/?key=${apiKey}&op=getBill&id=${match.bill_id}`
            const billResp = await fetch(billUrl)
            totalCalls++
            if (billResp.ok) {
              const billResult = await billResp.json()
              billData = billResult.bill

              // Save the LegiScan ID for future syncs
              await supabase
                .from('bills')
                .update({ legiscan_bill_id: match.bill_id })
                .eq('id', bill.id)
            }
            await sleep(7500) // Extra pause for double-call
          }
        }
      }

      if (billData?.texts?.length) {
        // Get the latest text document
        const latestText = billData.texts[billData.texts.length - 1]
        if (latestText.doc_id) {
          const textUrl = `https://api.legiscan.com/?key=${apiKey}&op=getBillText&id=${latestText.doc_id}`
          const textResp = await fetch(textUrl)
          totalCalls++
          if (textResp.ok) {
            const textData = await textResp.json()
            const doc = textData.text?.doc
            if (doc) {
              // LegiScan returns base64-encoded text
              const decoded = Buffer.from(doc, 'base64').toString('utf-8')
              // Strip HTML if present
              const cleanText = decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
              const wordCount = cleanText.split(/\s+/).length

              await supabase
                .from('bills')
                .update({
                  full_text: cleanText,
                  text_word_count: wordCount,
                  text_version: latestText.type || 'Unknown',
                  structured_excerpt: extractStructuredExcerpt(cleanText),
                  section_topic_scores: computeSectionTopicScores(cleanText),
                  synced_at: new Date().toISOString(),
                })
                .eq('id', bill.id)

              totalSynced++
            }
          }
        }
      } else {
        // Mark as tried so we don't retry tomorrow
        await supabase
          .from('bills')
          .update({ synced_at: new Date().toISOString() })
          .eq('id', bill.id)
      }

      // Rate limit: 8/min = 7.5s between calls
      await sleep(7500)
    } catch (err) {
      console.error(`[sync:legiscan] Error for bill ${bill.id}:`, err.message)
    }
  }

  console.log(`[sync:legiscan] Done: ${totalSynced} texts filled, ${totalCalls} API calls`)
  return { synced: totalSynced, calls: totalCalls }
}

// ─── Main sync orchestrator ────────────────────────────────────────────────

async function runDailySync(supabase, config) {
  // LegiScan budget (30K/month free tier) is split between:
  //   1. Daily catalog sync (~51 getMasterList calls/day = ~1.5K/month) to
  //      detect change_hash diffs on state bills — invalidates full_text so
  //      our scrapers re-run on the next backfillStateTexts pass.
  //   2. Runtime fetch when a student clicks Personalize on a search result.
  //   3. On-demand text backfill when a teacher pins a bill to a classroom.
  // See api/server.js — fetchBillTextFromLegiScan and pinBillForAssignment.
  const { congressApiKey, openStatesApiKey, legiscanApiKey, states } = config
  const startTime = Date.now()
  const results = {}

  console.log('[sync] ═══════════════════════════════════════════════')
  console.log('[sync] Daily bill sync starting at', new Date().toISOString())
  console.log('[sync] ═══════════════════════════════════════════════')

  // Phase 1: Federal metadata + text (Congress.gov — unlimited)
  if (congressApiKey) {
    try {
      results.congress = await syncCongressGov(supabase, congressApiKey)
    } catch (err) {
      console.error('[sync] Congress.gov sync failed:', err.message)
      results.congress = { error: err.message }
    }
  }

  // Phase 2: State metadata (Open States)
  if (openStatesApiKey) {
    try {
      results.openstates = await syncOpenStates(supabase, openStatesApiKey, { states })
    } catch (err) {
      console.error('[sync] Open States sync failed:', err.message)
      results.openstates = { error: err.message }
    }

    // Phase 3 (state metadata historical backfill) was removed on 2026-04-16.
    // It was a one-time bootstrap helper that re-crawled 30 days of bills for
    // every state that looked "empty" — but the emptiness check at
    // runStateBackfill (see below) used `.limit(1)` which only ever captured a
    // single state's jurisdiction, so it re-ran 50 states daily even when
    // they already had years of history. Net effect: ~800 Open States calls
    // per day re-writing bills we already had. With Phase 2's updated_since=
    // yesterday incremental catching every new bill plus the new
    // include=versions ingestion filter, the bootstrap path isn't needed in
    // steady state. The function is still exported for one-off use when
    // seeding a brand-new jurisdiction.

    // Phase 3.5: LegiScan change-hash detection.
    // getMasterList per state (~51 calls) returns every bill's current
    // change_hash. When it differs from what we stored, syncLegiScanCatalog
    // nulls the row's full_text so Phase 4 below re-runs our scrapers on it.
    // Without this, state bills that already have text are never checked for
    // amendments/substitutes — our scrapers only run on first fetch.
    if (legiscanApiKey) {
      try {
        const lsStates = states || Object.keys(STATE_NAMES)
        results.legiscanCatalog = await syncLegiScanCatalog(supabase, legiscanApiKey, { states: lsStates })
      } catch (err) {
        console.error('[sync] LegiScan catalog sync failed:', err.message)
        results.legiscanCatalog = { error: err.message }
      }
    }

    // Phase 4: State text via Open States → legislature PDF/HTML.
    // Runs after Phase 3.5 so any bill whose change_hash just flipped (and
    // therefore had full_text nulled) gets re-scraped on this same run.
    // We ask for 3000 attempts but the backfill breaks early the moment
    // Open States returns 429 (see OpenStatesRateLimitError handling) — so
    // on light-Phase-2 days we capture the extra headroom, and on heavy
    // days we stop cleanly without scoring false strikes against bills.
    try {
      results.stateTexts = await backfillStateTexts(supabase, openStatesApiKey, { limit: 3000 })
    } catch (err) {
      console.error('[sync] State text backfill failed:', err.message)
      results.stateTexts = { error: err.message }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  console.log('[sync] ═══════════════════════════════════════════════')
  console.log(`[sync] Complete in ${elapsed}s:`, JSON.stringify(results))
  console.log('[sync] ═══════════════════════════════════════════════')

  return results
}

// ─── Initial backfill ──────────────────────────────────────────────────────
// Runs once when the bills table is empty. Fetches historical bills.
// Takes several days due to Open States daily limit.

async function runBackfill(supabase, config) {
  const { congressApiKey, openStatesApiKey, legiscanApiKey, states } = config

  // Check if backfill is needed
  const { count } = await supabase
    .from('bills')
    .select('id', { count: 'exact', head: true })

  if (count > 100) {
    console.log(`[backfill] Bills table has ${count} rows, skipping backfill`)
    return
  }

  console.log('[backfill] Bills table is empty/near-empty, running initial backfill')

  // Backfill federal bills (last 6 months)
  if (congressApiKey) {
    const sixMonthsAgo = new Date(Date.now() - 180 * 86400000).toISOString().slice(0, 10)
    await syncCongressGov(supabase, congressApiKey, { since: sixMonthsAgo })
  }

  // Backfill state bills (last 30 days — limited by daily quota)
  if (openStatesApiKey) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 19)
    await syncOpenStates(supabase, openStatesApiKey, { since: thirtyDaysAgo, states })
  }
}

// ─── On-demand bill text fetching (Open States → legislature PDF/HTML) ────
// For state bills missing full_text. Fetches version links from Open States,
// then pulls the actual text from the linked legislature document.
//
// PDF-FIRST strategy: most state legislatures publish PDF as the canonical
// format. Many (AL, GA, MD, FL, CT, LA, CO, MS) are PDF-only. Others
// (IL, HI) have both, but the "HTML" link is often a JS-rendered nav page
// that doesn't contain the bill text. PDFs are the single format that works
// consistently across states, so we try them first and fall back to HTML.
//
// Side effect: updates bills.text_fetch_attempts / text_fetch_last_at so
// backfillStateTexts can shelf bills that have failed repeatedly instead of
// retrying dead URLs every day.

// Query Open States GraphQL for a bill's versions. Returns:
//   { versions: [...] }    — normal response (may be empty array)
//   { rateLimited: true }  — 429 (daily GraphQL quota of 3000 hit)
//   { error: '...' }       — other HTTP / GraphQL error
// Never throws. Caller decides whether to fall back.
async function fetchVersionsGraphQL(openstatesId, apiKey) {
  const query = `query { bill(id: "${openstatesId}") { versions { note links { url mediaType } } } }`
  const resp = await fetch('https://openstates.org/graphql', {
    method: 'POST',
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(20000),
  })
  if (resp.status === 429) return { rateLimited: true }
  if (!resp.ok) return { error: `graphql ${resp.status}` }
  const json = await resp.json()
  if (json.errors?.length) return { error: `graphql: ${(json.errors[0]?.message || 'unknown').slice(0, 100)}` }
  return { versions: json.data?.bill?.versions || [] }
}

// Query Open States REST /bills/{id}?include=versions. Same return shape as
// fetchVersionsGraphQL. REST has a separate (smaller, ~500/day) daily quota,
// but returns correct media_type + full links arrays for every state — so
// we use it as the source of truth when GraphQL comes back degraded.
async function fetchVersionsREST(openstatesId, apiKey) {
  const url = `${OPENSTATES_BASE}/bills/${encodeURIComponent(openstatesId)}?include=versions&apikey=${apiKey}`
  const resp = await fetch(url, { signal: AbortSignal.timeout(20000) })
  if (resp.status === 429) return { rateLimited: true }
  if (!resp.ok) return { error: `rest ${resp.status}` }
  const json = await resp.json()
  return { versions: json.versions || [] }
}

// Walk a versions[] array newest-first (OS returns them newest at index 0),
// try PDF link then HTML for each version, return first extracted text that
// clears the 100-char minimum. Returns { text, format, url } or null.
async function walkVersionsAndExtract(versions, label) {
  for (let i = versions.length - 1; i >= 0; i--) {
    const links = versions[i].links || []
    const pdfLink = links.find(l => l.mediaType === 'application/pdf' || l.media_type === 'application/pdf' || /\.pdf(\?|$)/i.test(l.url || ''))
    const htmlLink = links.find(l => l.mediaType === 'text/html' || l.media_type === 'text/html' || (l.url && !/\.pdf(\?|$)/i.test(l.url) && !l.mediaType?.includes('pdf') && !l.media_type?.includes('pdf')))

    for (const attempt of [
      pdfLink ? { url: pdfLink.url, format: 'pdf' } : null,
      htmlLink ? { url: htmlLink.url, format: 'html' } : null,
    ]) {
      if (!attempt) continue
      const text = await fetchAndExtract(attempt.url, attempt.format)
      if (text && text.length >= 100) return { text, format: attempt.format, url: attempt.url }
    }
  }
  return null
}

// Per-state URL synthesizers: construct legislature PDF URLs directly from
// the bill metadata we already store, skipping Open States entirely. Saves
// OS quota for states where the pattern is deterministic and stable.
// Each synthesizer returns an array of candidate URLs tried in order; the
// first one that yields a real PDF wins.
const URL_SYNTHESIZERS = {
  // Federal: www.govinfo.gov/content/pkg/BILLS-{congress}{type}{num}{version}/pdf/BILLS-{congress}{type}{num}{version}.pdf
  // Static URLs, much faster than Congress.gov's 2-API-call-per-bill text fetch.
  // Version codes picked by chamber:
  //   House (hr/hres/hjres/hconres): ih (intro) → eh (engrossed) → rh (reported)
  //   Senate (s/sres/sjres/sconres): is (intro) → es (engrossed) → rs (reported)
  // Try intro first (universal); enrolled/engrossed as fresher-version fallbacks.
  // session stored as congress number string ("119").
  US: (b) => {
    const type = (b.bill_type || '').toLowerCase()
    const congress = b.session || '119'
    if (!type) return []
    const num = b.bill_number
    const isSenate = type === 's' || type.startsWith('s')
    const versions = isSenate ? ['is', 'es', 'rs', 'enr'] : ['ih', 'eh', 'rh', 'enr']
    return versions.map(v =>
      `https://www.govinfo.gov/content/pkg/BILLS-${congress}${type}${num}${v}/pdf/BILLS-${congress}${type}${num}${v}.pdf`
    )
  },

  // Connecticut: www.cga.ct.gov/{year}/TOB/{chamber}/pdf/{year}{TYPE}-{5-digit}-R00-{SUFFIX}.pdf
  // R00 is the first-introduced version. Amended bills republish under R01/R02,
  // but every bill has an R00 available once introduced. If R00 404s we fall
  // through to the OS hybrid which will find whatever later version exists.
  //
  // The filename suffix is always SB or HB, determined by chamber — even for
  // resolutions (SR → suffix SB, HR → suffix HB). Took a dry-run miss to notice.
  CT: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type) return []
    const isSenate = type.startsWith('S')
    const chamber = isSenate ? 'S' : 'H'
    const suffix = isSenate ? 'SB' : 'HB'
    const num = String(b.bill_number).padStart(5, '0')
    return [`https://www.cga.ct.gov/${b.session}/TOB/${chamber}/pdf/${b.session}${type}-${num}-R00-${suffix}.pdf`]
  },

  // Tennessee: capitol.tn.gov/Bills/{session}/Bill/{TYPE}{number}.pdf
  // Session stored as the GA number (e.g. "114"), which matches the URL slug
  // directly. Clean one-URL pattern; no padding, no version suffix.
  TN: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    return [`https://capitol.tn.gov/Bills/${b.session}/Bill/${type}${b.bill_number}.pdf`]
  },

  // Massachusetts: malegislature.gov/Bills/{GA-number}/{TYPE}{number}.pdf
  // Our DB stores session as "194th" (with ordinal suffix), URL wants "194".
  // Strip the suffix before interpolating.
  MA: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const ga = String(b.session).replace(/(?:st|nd|rd|th)$/i, '')
    return [`https://malegislature.gov/Bills/${ga}/${type}${b.bill_number}.pdf`]
  },

  // Iowa: www.legis.iowa.gov/docs/publications/LGI/{GA-number}/{TYPE}{number}.pdf
  // Our DB stores session as year-pair ("2025-2026"); URL wants the General
  // Assembly number (91 for 2025-2026). GA = floor((firstYear - 1843) / 2).
  IA: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const m = String(b.session).match(/^(\d{4})/)
    if (!m) return []
    const ga = Math.floor((parseInt(m[1], 10) - 1843) / 2)
    return [`https://www.legis.iowa.gov/docs/publications/LGI/${ga}/${type}${b.bill_number}.pdf`]
  },

  // Illinois: ilga.gov/documents/legislation/{GA}/{TYPE}/PDF/{GA}00{TYPE}{4-digit}.pdf
  // Session stored as "104th"; strip ordinal suffix. Bill number zero-padded
  // to 4 digits. HJR (joint resolutions) live under a different path — synth
  // will 404 for those and cleanly fall through to OS.
  IL: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const ga = String(b.session).replace(/(?:st|nd|rd|th)$/i, '')
    const num = String(b.bill_number).padStart(4, '0')
    // Directory uses the full bill_type, but the filename uses an abbreviated
    // 2-letter document code for joint resolutions. Non-joint types (HB/SB/
    // HR/SR) keep their type as-is. Confirmed live on ilga.gov for the 104th
    // GA: HJR→HJ, SJR→SJ, HJRCA→HC, SJRCA→SC.
    const FILE_CODE = { HJR: 'HJ', SJR: 'SJ', HJRCA: 'HC', SJRCA: 'SC' }
    const filecode = FILE_CODE[type] || type
    // Some bills are only published as the "latest version" (post-amendment)
    // with an "lv" suffix; try plain introduced first, fall back to lv.
    return [
      `https://www.ilga.gov/documents/legislation/${ga}/${type}/PDF/${ga}00${filecode}${num}.pdf`,
      `https://www.ilga.gov/documents/legislation/${ga}/${type}/PDF/${ga}00${filecode}${num}lv.pdf`,
    ]
  },

  // North Dakota: ndlegis.gov/files/resource/{assembly}-{year}/library/{type}{num}.pdf
  // Assembly # maps from the odd start-year: 69th = 2025. Covers hb/sb/hcr/scr;
  // hr/hm/sjr don't follow this pattern and will 404 (tolerable ~4% miss).
  ND: (b) => {
    const type = (b.bill_type || '').toLowerCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    const oddYr = parseInt(yr, 10) % 2 === 1 ? parseInt(yr, 10) : parseInt(yr, 10) - 1
    const assembly = Math.floor((oddYr - 1889) / 2) + 1
    return [`https://ndlegis.gov/files/resource/${assembly}-${oddYr}/library/${type}${b.bill_number}.pdf`]
  },

  // Nebraska: nebraskalegislature.gov/FloorDocs/{GA}/PDF/{Intro|Final}/{TYPE}{num}.pdf
  // Every bill has an Intro version; Final exists only for passed bills.
  // Try Intro first (universal), Final as a freshness upgrade.
  NE: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const base = `https://nebraskalegislature.gov/FloorDocs/${b.session}/PDF`
    return [`${base}/Intro/${type}${b.bill_number}.pdf`, `${base}/Final/${type}${b.bill_number}.pdf`]
  },

  // Rhode Island: webserver.rilegislature.gov/BillText/BillText{YY}/{Chamber}Text{YY}/{Letter}{num}.pdf
  // Session stored as 4-digit year ("2026"); URL uses 2-digit suffix ("26").
  // Filename uses just the chamber letter + number (S2757.pdf, not SB2757.pdf).
  // Plain http, not https — existing fetchAndExtract handles both.
  RI: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const yy = String(b.session).slice(-2)
    const chamber = type.startsWith('S') ? 'Senate' : 'House'
    const letter = type.startsWith('S') ? 'S' : 'H'
    return [`http://webserver.rilegislature.gov/BillText/BillText${yy}/${chamber}Text${yy}/${letter}${b.bill_number}.pdf`]
  },

  // Wisconsin: docs.legis.wisconsin.gov/document/proposaltext/{year}/REG/{TYPE}{number}.pdf
  // Session stored as "2025" or "2025-2026"; take the first year.
  WI: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    return [`https://docs.legis.wisconsin.gov/document/proposaltext/${yr}/REG/${type}${b.bill_number}.pdf`]
  },

  // New York: legislation.nysenate.gov/pdf/bills/{year}/{TYPE}{number}
  // Note: no .pdf extension — the URL serves PDF with application/pdf content-type
  // directly. Session stored as "2025-2026"; use the first year.
  NY: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    return [`https://legislation.nysenate.gov/pdf/bills/${yr}/${type}${b.bill_number}`]
  },

  // Texas: capitol.texas.gov/tlodocs/{session-code}/billtext/pdf/{TYPE}{num:05}I.pdf
  // Session codes: "89R" = 89th Legislature Regular, "891" = 89th 1st Called.
  // OS stores sessions as legislature+code ("892" = 89th 2nd Called); LegiScan
  // stores year-based ("2025 Regular Session"). Handle both.
  TX: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const s = String(b.session)
    let code
    const osMatch = s.match(/^(\d{2})(R|\d)$/i) // "89R", "892"
    if (osMatch) code = `${osMatch[1]}${osMatch[2].toUpperCase()}`
    else {
      const yrMatch = s.match(/^(\d{4})/)
      if (!yrMatch) return []
      code = `${Math.floor((parseInt(yrMatch[1], 10) - 1847) / 2)}R`
    }
    const num = String(b.bill_number).padStart(5, '0')
    return [`https://capitol.texas.gov/tlodocs/${code}/billtext/pdf/${type}${num}I.pdf`]
  },

  // Florida: www.flsenate.gov/Session/Bill/{year}/{num}/BillText/Filed/PDF
  // Year-only session. Bill number unpadded. Works for SB/HB/SR/HR etc.
  FL: (b) => {
    if (!b.bill_type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    return [`https://www.flsenate.gov/Session/Bill/${yr}/${b.bill_number}/BillText/Filed/PDF`]
  },

  // Idaho: legislature.idaho.gov/wp-content/uploads/sessioninfo/{year}/legislation/{TYPE}{num:04}.pdf
  // Bill numbers are 3-4 digits; pad to 4. Types h/s (LegiScan) work for
  // chamber-agnostic URLs. Joint resolutions (hjr/sjr) 404 — fall through.
  ID: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    const num = String(b.bill_number).padStart(4, '0')
    return [`https://legislature.idaho.gov/wp-content/uploads/sessioninfo/${yr}/legislation/${type}${num}.pdf`]
  },

  // Maryland: mgaleg.maryland.gov/{year}RS/bills/{type|lower}/{type|lower}{num:04}F.pdf
  // F-suffix = First Reading (introduced). Works for HB, SB, HJ, SJ.
  MD: (b) => {
    const type = (b.bill_type || '').toLowerCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    const num = String(b.bill_number).padStart(4, '0')
    return [`https://mgaleg.maryland.gov/${yr}RS/bills/${type}/${type}${num}F.pdf`]
  },

  // North Carolina: www.ncleg.gov/Sessions/{yr}/Bills/{ChamberLong}/PDF/{TYPE}{num}v{ver}.pdf
  // Session "2025-2026 Regular Session" → first year. S/H only (NC's LegiScan
  // types), v0 = first filed version.
  NC: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    const chamber = type.startsWith('S') ? 'Senate' : 'House'
    return [`https://www.ncleg.gov/Sessions/${yr}/Bills/${chamber}/PDF/${type}${b.bill_number}v0.pdf`]
  },

  // Washington: lawfilesext.leg.wa.gov/biennium/{yr1}-{yr2_2}/Pdf/Bills/{House|Senate} Bills/{num}.pdf
  // Biennium format e.g. "2025-26" (two-digit second year).
  WA: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const m = String(b.session).match(/^(\d{4})(?:-(\d{4}))?/)
    if (!m) return []
    const yr1 = m[1]
    const yr2 = String(parseInt(m[2] || String(parseInt(yr1, 10) + 1), 10)).slice(-2)
    const chamber = type.startsWith('S') ? 'Senate' : 'House'
    return [`https://lawfilesext.leg.wa.gov/biennium/${yr1}-${yr2}/Pdf/Bills/${chamber}%20Bills/${b.bill_number}.pdf`]
  },

  // Wyoming: wyoleg.gov/{year}/Introduced/{TYPE}{num:04}.pdf
  WY: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    const num = String(b.bill_number).padStart(4, '0')
    return [`https://www.wyoleg.gov/${yr}/Introduced/${type}${num}.pdf`]
  },

  // Oregon: olis.oregonlegislature.gov/liz/{yyyy}R1/Downloads/MeasureDocument/{TYPE}{num}/Introduced
  // Session slug = "{year}R1" for Regular. No .pdf extension but served as PDF.
  OR: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    return [`https://olis.oregonlegislature.gov/liz/${yr}R1/Downloads/MeasureDocument/${type}${b.bill_number}/Introduced`]
  },

  // Alaska: akleg.gov/PDF/{leg}/Bills/{TYPE}{num:04}A.PDF
  // A = initial version. Session stored as leg-number directly ("34").
  AK: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const leg = String(b.session).match(/(\d+)/)?.[1]
    if (!leg) return []
    const num = String(b.bill_number).padStart(4, '0')
    return [`https://www.akleg.gov/PDF/${leg}/Bills/${type}${num}A.PDF`]
  },

  // Kentucky: apps.legislature.ky.gov/record/{yy}{rs|ss}/{type|lower}{num}.html
  // HTML format; extractTextFromHtml handles it. Handles both session shapes:
  // OS "2026RS" → "26rs" and LegiScan "2026 Regular Session" → "26rs".
  KY: (b) => {
    const type = (b.bill_type || '').toLowerCase()
    if (!type || !b.session) return []
    const s = String(b.session)
    const yr = s.match(/^(\d{4})/)?.[1]
    if (!yr) return []
    // OS compact format "2026RS" / "2026SS" / "20261SS" → take trailing letters.
    // LegiScan long format "2026 Regular Session" / "2026 Special Session" →
    // RS for Regular, SS for Special/Extraordinary.
    let suffix
    const compact = s.match(/^\d{4}(\d*)(RS|SS)$/i)
    if (compact) {
      suffix = `${compact[1]}${compact[2].toLowerCase()}`
    } else if (/special|extraordinary/i.test(s)) {
      suffix = 'ss'
    } else {
      suffix = 'rs'
    }
    return [`https://apps.legislature.ky.gov/record/${yr.slice(-2)}${suffix}/${type}${b.bill_number}.html`]
  },

  // Arkansas: www.arkleg.state.ar.us/Bills/FTPDocument?path=/Bills/{session}/Public/{TYPE}{num}.pdf
  // Session "2026F" is used directly in the path.
  AR: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    return [`https://www.arkleg.state.ar.us/Bills/FTPDocument?path=%2FBills%2F${b.session}%2FPublic%2F${type}${b.bill_number}.pdf`]
  },

  // Hawaii: data.capitol.hawaii.gov/sessions/session{year}/bills/{TYPE}{num}_.PDF
  // Note: www.capitol.hawaii.gov 403s the same path — PDFs live on the data
  // subdomain. Trailing underscore + .PDF (uppercase) is literal.
  HI: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    return [`https://data.capitol.hawaii.gov/sessions/session${yr}/bills/${type}${b.bill_number}_.PDF`]
  },

  // New Jersey: pub.njleg.gov/bills/{year}/{FOLDER}/{num}_I1.PDF
  // FOLDER = chamber letter + bucket padded to 4 digits. Bucket is the UPPER
  // bound of a 500-bill range: ceil(num/500)*500. So bill 499 → S0500,
  // 501 → S1000, 1985 → S2000, 2500 → S2500. Only A/S chambers have this
  // layout; resolutions (AR/SR/ACR/SCR) use other paths and fall through.
  // Session "2026-2027 Regular Session" → year=2026 (first year).
  NJ: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    const n = b.bill_number
    // A/S regular bills use a 500-bucket subdirectory: bills/{yr}/A0500/95_I1.PDF.
    // Resolutions (AJR/SJR/AR/SR/ACR/SCR) live directly under the type:
    // bills/{yr}/SJR/95_I1.PDF. Confirmed both with 200s on pub.njleg.gov.
    if (type === 'A' || type === 'S') {
      const bucket = String(Math.ceil(n / 500) * 500).padStart(4, '0')
      return [`https://pub.njleg.gov/bills/${yr}/${type}${bucket}/${n}_I1.PDF`]
    }
    if (/^(AJR|SJR|AR|SR|ACR|SCR)$/.test(type)) {
      return [`https://pub.njleg.gov/bills/${yr}/${type}/${n}_I1.PDF`]
    }
    return []
  },

  // Minnesota: revisor.mn.gov/bin/bldbill.php?bill={CHAMBER}{num:04}.0.html&session=ls{leg}
  // MN is HTML not PDF — extractFromHTML handles it. Legislature number:
  // 94th = 2025-2026, leg = (firstYear - 1837) / 2.
  // Bill types: HF/SF (file) use chamber letter; resolutions (HR/SR) also work.
  MN: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    if (!type.startsWith('H') && !type.startsWith('S')) return []
    const m = String(b.session).match(/^(\d{4})/)
    if (!m) return []
    const leg = Math.floor((parseInt(m[1], 10) - 1837) / 2)
    const chamber = type[0] // H or S
    const num = String(b.bill_number).padStart(4, '0')
    return [`https://www.revisor.mn.gov/bin/bldbill.php?bill=${chamber}${num}.0.html&session=ls${leg}`]
  },

  // Oklahoma: bills vs. resolutions use different subpaths + case conventions.
  //   Bills (HB/SB):
  //     cf_pdf/{yyyy}-{yy+1}%20INT/{TYPE}/{TYPE}{num}%20INT.PDF   (caps)
  //   Resolutions (HR/SR/HJR/SJR/HCR/SCR):
  //     cf_pdf/{yyyy}-{yy+1}%20int/{h|s}res/{TYPE}{num}%20int.pdf (lowercase,
  //     shared hres/sres subdirs regardless of simple/joint/concurrent kind)
  // Session "2026 Regular Session" → 2025-26 (4-digit first year, 2-digit
  // second). OK biennium starts odd years; 2026 reg session maps to 2025-26.
  OK: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const m = String(b.session).match(/^(\d{4})/)
    if (!m) return []
    const yr = parseInt(m[1], 10)
    const yr1 = yr % 2 === 1 ? yr : yr - 1
    const yy2 = String((yr1 + 1) % 100).padStart(2, '0')
    if (type === 'HB' || type === 'SB') {
      return [`https://www.oklegislature.gov/cf_pdf/${yr1}-${yy2}%20INT/${type}/${type}${b.bill_number}%20INT.PDF`]
    }
    if (/^(HR|SR|HJR|SJR|HCR|SCR)$/.test(type)) {
      const sub = type.startsWith('S') ? 'sres' : 'hres'
      return [`https://www.oklegislature.gov/cf_pdf/${yr1}-${yy2}%20int/${sub}/${type}${b.bill_number}%20int.pdf`]
    }
    return []
  },

  // Arizona: azleg.gov/legtext/{NN}leg/{S}R/bills/{TYPE}{num}P.pdf
  // Session format "57th-2nd-regular" → 57leg/2R. Trailing P = passed/printed.
  AZ: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const m = String(b.session).match(/^(\d+)(?:st|nd|rd|th)?-(\d+)(?:st|nd|rd|th)?-/i)
    if (!m) return []
    const leg = m[1]
    const ss = m[2]
    return [`https://www.azleg.gov/legtext/${leg}leg/${ss}R/bills/${type}${b.bill_number}P.pdf`]
  },

  // Nevada: leg.state.nv.us/Session/{NNrd/th}{year}/Bills/{TYPE}/{TYPE}{num}.pdf
  // Session "2025 Regular Session" → 83rd2025. 83rd = (2025-1861)/2 + 1.
  NV: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const m = String(b.session).match(/^(\d{4})/)
    if (!m) return []
    const yr = parseInt(m[1], 10)
    const n = Math.floor((yr - 1861) / 2) + 1
    const suffix = n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th'
    const chamber = type === 'AB' || type === 'AR' || type === 'ACR' || type === 'AJR' ? 'AB' : 'SB'
    // Chamber folder uses same prefix as type; e.g. AB goes in /AB/, AR in /AR/, etc.
    return [`https://www.leg.state.nv.us/Session/${n}${suffix}${yr}/Bills/${type}/${type}${b.bill_number}.pdf`]
  },

  // Kansas: kslegislature.org/li/b{yy1}_{yy2}/measures/documents/{type|lower}{num}_00_0000.pdf
  // Session "2025-2026 Regular Session" → b2025_26. Type lowercase.
  KS: (b) => {
    const type = (b.bill_type || '').toLowerCase()
    if (!type || !b.session) return []
    const m = String(b.session).match(/^(\d{4})(?:-(\d{4}))?/)
    if (!m) return []
    const yy2 = String(parseInt(m[2] || String(parseInt(m[1], 10) + 1), 10)).slice(-2)
    return [`https://www.kslegislature.org/li/b${m[1]}_${yy2}/measures/documents/${type}${b.bill_number}_00_0000.pdf`]
  },

  // Alabama: alison.legislature.state.al.us/files/pdf/SearchableInstruments/{session}/{TYPE}{num}-int.pdf
  // Session stored as "2026rs" (year + session code). Case: SB1 → SB1-int.pdf (lowercase "int").
  AL: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    return [`https://alison.legislature.state.al.us/files/pdf/SearchableInstruments/${b.session.toUpperCase()}/${type}${b.bill_number}-int.pdf`]
  },

  // Mississippi: billstatus.ls.state.ms.us/documents/{year}/pdf/{TYPE}/[chunk/]{TYPE}{num:04}{SUFFIX}.pdf
  //   HB/SB: chunked into /0001-0099/ then /0101-0199/, /0201-0299/, ...
  //   Chunks are 99-wide starting at x001 (not x000): e.g., n=2096 → 2001-2099.
  //   Resolutions (HR/SR/HC/SC/HCR/SCR): no chunk folder, flat under /pdf/{TYPE}/
  //   Suffixes: IN = Introduced (not-yet-passed), PS = Passed, SG = Signed.
  // Try all three suffixes so enacted bills (IN PDF often removed) still resolve.
  MS: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    const n = b.bill_number
    const num = String(n).padStart(4, '0')
    const base = `https://billstatus.ls.state.ms.us/documents/${yr}/pdf/${type}`
    const isRegularBill = type === 'HB' || type === 'SB'
    // Build the path prefix (chunked or flat)
    const prefixes = []
    if (isRegularBill) {
      if (n < 100) {
        prefixes.push(`${base}/0001-0099`)
      } else {
        const start = Math.floor(n / 100) * 100 + 1
        const end = start + 98
        prefixes.push(`${base}/${String(start).padStart(4, '0')}-${String(end).padStart(4, '0')}`)
      }
    } else {
      prefixes.push(base)
    }
    // Try IN → PS → SG suffixes in order (most bills will hit IN; enacted fall through)
    const urls = []
    for (const prefix of prefixes) {
      for (const suffix of ['IN', 'PS', 'SG']) {
        urls.push(`${prefix}/${type}${num}${suffix}.pdf`)
      }
    }
    return urls
  },

  // South Carolina: scstatehouse.gov/sess{GA}_{yr1}-{yr2}/bills/{num}.htm
  // Session 2025-2026 → GA=126. (yr - 1775)/2 + 1 = 126 for 2025.
  // HTML output, extractTextFromHtml handles it. Bill types S/H are not
  // referenced in the URL — just the number.
  SC: (b) => {
    if (!b.bill_type || !b.session) return []
    const m = String(b.session).match(/^(\d{4})(?:-(\d{4}))?/)
    if (!m) return []
    const yr1 = parseInt(m[1], 10)
    const yr2 = m[2] || String(yr1 + 1)
    const ga = Math.floor((yr1 - 1775) / 2) + 1
    return [`https://www.scstatehouse.gov/sess${ga}_${yr1}-${yr2}/bills/${b.bill_number}.htm`]
  },

  // Michigan: legislature.mi.gov/documents/{yr1}-{yr2}/billintroduced/{Chamber}/pdf/{yr1}-{TypeCode}-{num:04}.pdf
  // TypeCode: SIB = Senate Introduced Bill, HIB = House Introduced Bill.
  // MI House numbers start at HB4001 (not 1); bill_number stored as-is from
  // LegiScan so num 4001 → 2025-HIB-4001.pdf.
  MI: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const m = String(b.session).match(/^(\d{4})(?:-(\d{4}))?/)
    if (!m) return []
    const yr1 = m[1]
    const yr2 = m[2] || String(parseInt(yr1, 10) + 1)
    const num = String(b.bill_number).padStart(4, '0')
    // Regular bills → /billintroduced/{Chamber}/pdf/{yr}-{SIB|HIB}-{num}.pdf
    // Resolutions → /resolutionintroduced/{Chamber}/pdf/{yr}-{SIR|HIR|SCR|HCR|SJR|HJR}-{num}.pdf
    //   SIR/HIR = simple resolutions, SCR/HCR = concurrent, SJR/HJR = joint.
    //   Chamber derived from the first letter of the type.
    if (type === 'HB' || type === 'SB') {
      const chamber = type === 'SB' ? 'Senate' : 'House'
      const code = type === 'SB' ? 'SIB' : 'HIB'
      return [`https://www.legislature.mi.gov/documents/${yr1}-${yr2}/billintroduced/${chamber}/pdf/${yr1}-${code}-${num}.pdf`]
    }
    if (/^(HR|SR|HCR|SCR|HJR|SJR)$/.test(type)) {
      const chamber = type.startsWith('S') ? 'Senate' : 'House'
      // HR → HIR, SR → SIR; HCR/SCR/HJR/SJR stay as-is in the URL code
      const code = type === 'HR' ? 'HIR' : type === 'SR' ? 'SIR' : type
      return [`https://www.legislature.mi.gov/documents/${yr1}-${yr2}/resolutionintroduced/${chamber}/pdf/${yr1}-${code}-${num}.pdf`]
    }
    return []
  },

  // West Virginia: wvlegislature.gov/Bill_Text_HTML/{year}_Sessions/RS/bills/{TYPE}{num}%20INTR.htm
  // HTML. Session "2026 Regular Session" → 2026_Sessions/RS.
  WV: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    return [`https://www.wvlegislature.gov/Bill_Text_HTML/${yr}_Sessions/RS/bills/${type}${b.bill_number}%20INTR.htm`]
  },

// Louisiana: legis.la.gov/legis/BillInfo.aspx?s={yy}{RS|ES}&b={TYPE}{num}
  // HTML landing page; extractTextFromHtml pulls the bill text content.
  // Session "2026 Regular Session" → 26RS. "2026 Extraordinary Session" → 26ES.
  LA: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const s = String(b.session)
    const yr = s.match(/^(\d{4})/)?.[1]
    if (!yr) return []
    const code = /extraordinary|special/i.test(s) ? 'ES' : 'RS'
    return [`https://www.legis.la.gov/legis/BillInfo.aspx?s=${yr.slice(-2)}${code}&b=${type}${b.bill_number}`]
  },

  // Utah: le.utah.gov/~{year}/bills/static/{TYPE}{num:04}.html
  // HTML, not PDF. Year = first year of session ("2026" for 2026 Regular).
  UT: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    const num = String(b.bill_number).padStart(4, '0')
    return [`https://le.utah.gov/~${yr}/bills/static/${type}${num}.html`]
  },

  // Vermont: two folder schemes by bill type.
  //   HB/SB: /Docs/BILLS/{TYPE}-{num:04}/{TYPE}-{num:04}%20As%20Introduced.pdf
  //   Resolutions (HR/SR/HCR/SCR/HJR/SJR/JRH/JRS): /Docs/RESOLUTN/{TYPE}{num:04}/{TYPE}{num:04}%20As%20Introduced.pdf
  //   (note: no hyphen between TYPE and num for resolutions)
  // Session "2025-2026 Regular Session" → use END year (2026), not start.
  VT: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const m = String(b.session).match(/^(\d{4})(?:-(\d{4}))?/)
    if (!m) return []
    const yr = m[2] || m[1]
    const num = String(b.bill_number).padStart(4, '0')
    const base = `https://legislature.vermont.gov/Documents/${yr}/Docs`
    if (type === 'HB' || type === 'SB') {
      return [`${base}/BILLS/${type}-${num}/${type}-${num}%20As%20Introduced.pdf`]
    }
    return [`${base}/RESOLUTN/${type}${num}/${type}${num}%20As%20Introduced.pdf`]
  },

  // New Mexico: three folder schemes by type, with different padding:
  //   HB/SB: /Sessions/{yy}%20Regular/bills/{chamber}/{TYPE}{num:04}.pdf (4-digit)
  //   Resolutions (HR/SR/HJR/SJR/HCR/SCR): /resolutions/{chamber}/{TYPE}{num:02}.pdf (2-digit)
  //   Memorials (HM/SM/HJM/SJM/HCM/SCM): /memorials/{chamber}/{TYPE}{num:03}.pdf (3-digit)
  // Chamber is 'senate' if type starts with S, else 'house'.
  NM: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    const yy = yr.slice(-2)
    const chamber = type.startsWith('S') ? 'senate' : 'house'
    const base = `https://www.nmlegis.gov/Sessions/${yy}%20Regular`
    if (type === 'HB' || type === 'SB') {
      const num4 = String(b.bill_number).padStart(4, '0')
      return [`${base}/bills/${chamber}/${type}${num4}.pdf`]
    }
    if (type.endsWith('M')) {
      const num3 = String(b.bill_number).padStart(3, '0')
      return [`${base}/memorials/${chamber}/${type}${num3}.pdf`]
    }
    // Resolutions: padding varies by series, so emit 2-digit and 3-digit candidates
    const num2 = String(b.bill_number).padStart(2, '0')
    const num3 = String(b.bill_number).padStart(3, '0')
    return [
      `${base}/resolutions/${chamber}/${type}${num2}.pdf`,
      `${base}/resolutions/${chamber}/${type}${num3}.pdf`,
    ]
  },

  // Maine: legislature.maine.gov/bills/getPDF.asp?paper={TYPE}{num:04}&item=1&snum={leg}
  // PDF endpoint. 132nd Legislature = 2025-2026. Only HP (House Paper) and
  // SP (Senate Paper) can be synthesized directly — LD (Legislative Document)
  // is an index number mapped to an HP/SP paper, so LD rows fall through.
  // leg = (firstYear - 1761) / 2 (empirical: 2025→132, 2023→131, 2021→130).
  ME: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session) return []
    if (type !== 'HP' && type !== 'SP') return []
    const m = String(b.session).match(/^(\d{4})/)
    if (!m) return []
    const leg = Math.floor((parseInt(m[1], 10) - 1761) / 2)
    const num = String(b.bill_number).padStart(4, '0')
    return [`https://legislature.maine.gov/bills/getPDF.asp?paper=${type}${num}&item=1&snum=${leg}`]
  },

  // Colorado: leg.colorado.gov/bills/{type|lower}{yy}-{num:3+}
  // HTML landing; extractTextFromHtml pulls bill text. Senate pads to 3
  // digits (sb25-001); House already starts at 1001 so 4-digit is natural.
  CO: (b) => {
    const type = (b.bill_type || '').toLowerCase()
    if (!type || !b.session) return []
    const yy = String(b.session).match(/^(\d{4})/)?.[1]?.slice(-2)
    if (!yy) return []
    const num = String(b.bill_number).padStart(3, '0')
    return [`https://leg.colorado.gov/bills/${type}${yy}-${num}`]
  },

  // California: leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id={sess}0{TYPE}{num}
  // Returns HTML inline; auto-redirects to the latest version. Session
  // stored as "20252026" (regular) or "20252026 Special Session 1" — take
  // the 8-digit prefix. PDF endpoint requires an un-derivable amendment
  // version token, so HTML is the stable choice.
  CA: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session || !b.bill_number) return []
    // Session may arrive as "20252026" (Open States) or "2025-2026 Regular
    // Session" / "2025-2026 1st Extraordinary Session" (LegiScan). Accept
    // both — collapse the hyphenated form to 8 digits before building the URL.
    let s = String(b.session).match(/^(\d{8})/)?.[1]
    if (!s) {
      const m = String(b.session).match(/^(\d{4})-(\d{4})/)
      if (m) s = m[1] + m[2]
    }
    if (!s) return []
    return [`https://leginfo.legislature.ca.gov/faces/billTextClient.xhtml?bill_id=${s}0${type}${b.bill_number}`]
  },

  // Missouri: two sub-hosts by chamber.
  //   House → documents.house.mo.gov/billtracking/bills{yy}1/sumpdf/{TYPE}{num}I.pdf
  //           (summary PDF — not full bill text, but covers title/sponsor/synopsis;
  //            the full-text URL requires an LR number we don't store)
  //   Senate → www.senate.mo.gov/{yy}info/pdf-bill/intro/{TYPE}{num}.pdf
  //           (full introduced bill text)
  // Session "2026" → yy="26". Resolutions (HCR/SCR/HJR/SJR) follow the same
  // host split as bills.
  MO: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session || !b.bill_number) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    const yy = yr.slice(-2)
    if (type.startsWith('H')) {
      return [`https://documents.house.mo.gov/billtracking/bills${yy}1/sumpdf/${type}${b.bill_number}I.pdf`]
    }
    if (type.startsWith('S')) {
      return [`https://www.senate.mo.gov/${yy}info/pdf-bill/intro/${type}${b.bill_number}.pdf`]
    }
    return []
  },

  // Ohio: search-prod.lis.state.oh.us/api/v2/general_assembly_{ga}/legislation/{type|lower}{num}/00_IN/pdf/
  // "00_IN" = Introduced version (exists for every bill). Session varies by
  // source — "136" (OpenStates, GA number) or "2025-2026 Regular Session"
  // (LegiScan, year range). GA 136 = 2025-2026 biennium, +1 per biennium.
  OH: (b) => {
    const type = (b.bill_type || '').toLowerCase()
    if (!type || !b.session || !b.bill_number) return []
    const s = String(b.session)
    let ga
    const yearMatch = s.match(/^(\d{4})/)
    if (yearMatch && parseInt(yearMatch[1], 10) > 1900) {
      ga = 136 + Math.floor((parseInt(yearMatch[1], 10) - 2025) / 2)
    } else {
      ga = parseInt(s.match(/^(\d+)/)?.[1], 10)
    }
    if (!ga || ga < 100) return []
    const num = String(b.bill_number).replace(/^[A-Za-z]+/, '')
    return [`https://search-prod.lis.state.oh.us/api/v2/general_assembly_${ga}/legislation/${type}${num}/00_IN/pdf/`]
  },

  // Indiana: iga.in.gov/pdf-documents/{ga}/{year}/{house|senate}/bills/{TYPE}{num}/{TYPE}{num}.01.INTR.pdf
  // GA 124 = 2025-2026 biennium, +1 per biennium. House bills are unpadded;
  // Senate bills are 4-digit zero-padded. Resolutions follow the same chamber
  // routing via type prefix.
  IN: (b) => {
    const type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session || !b.bill_number) return []
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    const year = parseInt(yr, 10)
    const ga = 122 + Math.floor((year - 2021) / 2)
    if (ga < 100) return []
    const chamber = type.startsWith('H') ? 'house' : type.startsWith('S') ? 'senate' : null
    if (!chamber) return []
    // HB/SB live under /bills/, everything else (HR/SR/HCR/SCR/HJR/SJR) under
    // /resolutions/. Senate bills are 4-digit padded; house bills aren't;
    // resolutions are 4-digit padded on both sides.
    const isResolution = !['HB', 'SB'].includes(type)
    const folder = isResolution ? 'resolutions' : 'bills'
    const num = (isResolution || chamber === 'senate')
      ? String(b.bill_number).padStart(4, '0')
      : String(b.bill_number)
    return [`https://iga.in.gov/pdf-documents/${ga}/${year}/${chamber}/${folder}/${type}${num}/${type}${num}.01.INTR.pdf`]
  },

  // Montana: bearbeta.legmt.gov JSON-API endpoint returns the bill PDF as
  //   application/octet-stream (the same endpoint Montana's own Bill Explorer
  //   uses). Our DB has 1,761 MT bills missing text and no scraper before
  //   this entry; Open States returns only the legmt.gov index page, not
  //   the canonical PDF.
  //
  // URL:  /docs/v1/documents/getBillText?legislatureOrdinal={N}&sessionOrdinal={YEAR}{1|2}&billType={HB|SB|HJ|SJ|HR|SR}&billNumber={num}
  //
  // Mappings:
  //   - legOrd: 69 for 2025 biennium. MT is biennial starting odd years; we
  //     derive from the session-year with (year - 1889)/2 + 1 = 69 for 2025.
  //   - sessionOrd: YYYY + 1 for regular, YYYY + 2/3/... for specials. We
  //     default to 1 (regular). If LegiScan ever emits a "Special Session"
  //     row we don't have a safe way to derive the index — skip.
  //   - billType: MT only publishes six types — HB/SB/HJ/SJ/HR/SR. Our
  //     LegiScan-sourced rows sometimes carry HJR/SJR/HCR/SCR; remap
  //     HJR→HJ, SJR→SJ, HCR→HJ, SCR→SJ (MT has no concurrent resolutions;
  //     best-effort fallback returns the joint-resolution equivalent, which
  //     may 404 for rows that were truly mis-classified).
  MT: (b) => {
    let type = (b.bill_type || '').toUpperCase()
    if (!type || !b.session || !b.bill_number) return []
    const TYPE_REMAP = { HJR: 'HJ', SJR: 'SJ', HCR: 'HJ', SCR: 'SJ' }
    type = TYPE_REMAP[type] || type
    if (!/^(HB|SB|HJ|SJ|HR|SR)$/.test(type)) return []
    // Pull the 4-digit session year (e.g., "2025 Regular Session" → 2025,
    // "69th Regular Session" → no match, bail).
    const yr = String(b.session).match(/^(\d{4})/)?.[1]
    if (!yr) return []
    const year = parseInt(yr, 10)
    if (year % 2 === 0) return [] // MT legislature only meets odd years
    const legOrd = Math.floor((year - 1889) / 2) + 1 // 1889→1, 2025→69
    const sessionOrd = `${year}1` // regular session suffix = 1
    return [`https://bearbeta.legmt.gov/docs/v1/documents/getBillText?legislatureOrdinal=${legOrd}&sessionOrdinal=${sessionOrd}&billType=${type}&billNumber=${b.bill_number}`]
  },
}

async function fetchBillText(supabase, bill) {
  if (!bill || bill.full_text) return bill.full_text || null

  // Gate: we can proceed if any of these paths is viable:
  //   - Synthesizer (URL built from metadata — zero external quota)
  //   - OpenStates hybrid (source='openstates' with openstates_id)
  //   - LegiScan-API fallback (bill has legiscan_bill_id, not in skip list)
  // Previously the gate blocked LegiScan-only states (e.g., NH) before they
  // could reach the LegiScan fallback block further down.
  const synthesizer = URL_SYNTHESIZERS[bill.jurisdiction]
  const canHybrid = bill.source === 'openstates' && bill.openstates_id
  const SKIP_LEGISCAN_FALLBACK = new Set(['ME'])
  const canLegiscan = bill.legiscan_bill_id &&
    process.env.LEGISCAN_API_KEY &&
    !SKIP_LEGISCAN_FALLBACK.has(bill.jurisdiction)
  if (!synthesizer && !canHybrid && !canLegiscan) return null

  const apiKey = process.env.OPENSTATES_API_KEY
  if (!apiKey && !synthesizer) {
    console.warn('[fetchBillText] No OPENSTATES_API_KEY configured and no synthesizer for', bill.jurisdiction)
    return null
  }

  const label = `${bill.jurisdiction} ${bill.bill_type}${bill.bill_number}`
  let lastError = null

  // Attempt 0: Direct URL synthesis (zero Open States quota burn).
  // For states with deterministic, stable URL patterns we can construct
  // the PDF URL from bill metadata and skip OS entirely. Falls through to
  // the OS hybrid below if synthesis misses (amended bill, non-R00-only
  // version, or a pattern variant we don't handle).
  if (synthesizer) {
    const synthUrls = synthesizer(bill)
    for (const url of synthUrls) {
      const text = await fetchAndExtract(url, 'pdf')
      if (text && text.length >= 100) {
        const wordCount = text.split(/\s+/).length
        console.log(`[fetchBillText] Extracted ${wordCount} words (pdf, via synth) for ${label}`)
        if (supabase && bill.id) {
          await supabase.from('bills').update({
            full_text: text,
            text_word_count: wordCount,
            text_version: 'scraped_pdf',
            structured_excerpt: extractStructuredExcerpt(text),
            section_topic_scores: computeSectionTopicScores(text),
            synced_at: new Date().toISOString(),
          }).eq('id', bill.id)
          const { error: trackErr } = await supabase.from('bills').update({
            text_fetch_attempts: 0,
            text_fetch_last_at: new Date().toISOString(),
            text_fetch_last_error: null,
          }).eq('id', bill.id)
          if (trackErr && trackErr.code !== 'PGRST204') {
            console.error('[fetchBillText] Tracking update error:', trackErr.message)
          }
        }
        return text
      }
    }
    if (synthUrls.length) {
      console.log(`[fetchBillText] Synth missed for ${label} (${synthUrls.length} candidates), falling back to Open States`)
    }
  }

  // LegiScan API fallback: for bills without openstates_id that the synth
  // can't handle. 2 API calls per bill, free-tier budget 30k/month.
  // SKIP_LEGISCAN_FALLBACK set already declared in the gate above.
  // ME is skipped: ~2,100 orphan LD bills would burn ~4,200 calls in one
  // backfill run, consuming ~14% of monthly budget for a single state that
  // isn't worth prioritizing. If we ever want ME coverage, do it via a
  // purpose-built one-shot script rather than this per-call fallback.
  if (canLegiscan && !canHybrid) {
    try {
      const apiKey = process.env.LEGISCAN_API_KEY
      const billUrl = `https://api.legiscan.com/?key=${apiKey}&op=getBill&id=${bill.legiscan_bill_id}`
      const billResp = await fetch(billUrl, { signal: AbortSignal.timeout(15000) })
      if (billResp.ok) {
        const billData = await billResp.json()
        const latestText = billData.bill?.texts?.[billData.bill.texts.length - 1]
        if (latestText?.doc_id) {
          await new Promise(r => setTimeout(r, 1500))
          const textUrl = `https://api.legiscan.com/?key=${apiKey}&op=getBillText&id=${latestText.doc_id}`
          const textResp = await fetch(textUrl, { signal: AbortSignal.timeout(15000) })
          if (textResp.ok) {
            const textData = await textResp.json()
            const doc = textData.text?.doc
            if (doc) {
              const decoded = Buffer.from(doc, 'base64').toString('utf-8')
              const isPdf = decoded.slice(0, 5) === '%PDF-'
              let cleanText
              if (isPdf) {
                const PDFParse = await loadPDFParse()
                const parser = new PDFParse({ data: new Uint8Array(Buffer.from(doc, 'base64')) })
                try {
                  const parsed = await parser.getText()
                  cleanText = (parsed.text || '').replace(/\s+/g, ' ').trim()
                } finally { await parser.destroy().catch(() => {}) }
              } else {
                cleanText = decoded.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
              }
              if (cleanText && cleanText.length >= 100) {
                const wordCount = cleanText.split(/\s+/).length
                console.log(`[fetchBillText] Extracted ${wordCount} words (via legiscan-api) for ${label}`)
                if (supabase && bill.id) {
                  await supabase.from('bills').update({
                    full_text: cleanText,
                    text_word_count: wordCount,
                    text_version: latestText.type || 'legiscan',
                    structured_excerpt: extractStructuredExcerpt(cleanText),
                    section_topic_scores: computeSectionTopicScores(cleanText),
                    synced_at: new Date().toISOString(),
                    text_fetch_attempts: 0,
                    text_fetch_last_at: new Date().toISOString(),
                    text_fetch_last_error: null,
                  }).eq('id', bill.id)
                }
                return cleanText
              }
            }
          }
        }
      }
    } catch (err) {
      console.error(`[fetchBillText] legiscan-api fallback failed for ${label}: ${err.message}`)
    }
  }

  // LegiScan-sourced bills have no openstates_id, so the hybrid path below
  // can't run. If synthesis didn't hit, give up cleanly rather than issuing
  // a malformed GraphQL query.
  if (!canHybrid) {
    if (supabase && bill.id) {
      await recordTextFetchFailure(supabase, bill.id, 'synth-miss no-os-id')
    }
    return null
  }

  // Hybrid strategy (see OS-GraphQL-vs-REST note): try GraphQL first for its
  // larger 3000/day quota. For the ~10 states where GraphQL returns degraded
  // link data (IL, NH, TN, NE, PA, IN, RI, WI, IA, MA — state-scraper bills
  // come back with missing PDF entries or null mediaType), GraphQL yields
  // nothing extractable and we fall through to REST for that bill. REST has
  // a smaller ~500/day quota but returns correct links for every state.
  //
  // Both quotas are per-day. If GraphQL is 429 we silently use REST. If REST
  // is also 429 we throw OpenStatesRateLimitError so backfillStateTexts
  // breaks its loop cleanly — at that point both daily budgets are spent
  // and further calls would just be wasted 429s.
  try {
    console.log(`[fetchBillText] Fetching versions for ${label}`)

    let result = null
    let usedSource = null

    // Attempt 1: GraphQL
    const gql = await fetchVersionsGraphQL(bill.openstates_id, apiKey)
    if (gql.versions?.length) {
      result = await walkVersionsAndExtract(gql.versions, label)
      if (result) usedSource = 'graphql'
    }

    // Attempt 2: REST fallback, when GraphQL produced nothing usable
    if (!result) {
      const reason = gql.rateLimited ? '429' : (gql.error || `${gql.versions?.length || 0} versions produced no text`)
      console.log(`[fetchBillText] GraphQL insufficient for ${label} (${reason}), trying REST`)
      const rest = await fetchVersionsREST(bill.openstates_id, apiKey)
      if (rest.rateLimited) {
        // Both GraphQL and REST rate-limited = both daily quotas spent.
        // Bubble up to stop the backfill loop; today's bill keeps its
        // attempt counter untouched so tomorrow's run picks it up fresh.
        if (gql.rateLimited) throw new OpenStatesRateLimitError(429)
        // REST quota alone hit; record a soft failure and move on.
        lastError = 'rest 429'
        await recordTextFetchFailure(supabase, bill.id, lastError)
        return null
      }
      if (rest.versions?.length) {
        result = await walkVersionsAndExtract(rest.versions, label)
        if (result) usedSource = 'rest'
      }

      // Both endpoints returned empty or no-parseable-links
      if (!result) {
        const hadAny = (gql.versions?.length || 0) + (rest.versions?.length || 0)
        lastError = hadAny ? 'no parseable version' : 'no versions'
        console.log(`[fetchBillText] ${lastError} for ${label}`)
        await recordTextFetchFailure(supabase, bill.id, lastError)
        return null
      }
    }

    const wordCount = result.text.split(/\s+/).length
    console.log(`[fetchBillText] Extracted ${wordCount} words (${result.format}, via ${usedSource}) for ${label}`)

    // Save to Supabase. Split into two calls so that if the text-fetch-tracking
    // migration (supabase/add_bill_text_fetch_tracking.sql) hasn't been applied
    // yet, the text still persists — we just skip the tracking reset. Prevents
    // a migration-ordering deploy from silently dropping every successfully-
    // fetched bill text.
    if (supabase && bill.id) {
      const { error } = await supabase
        .from('bills')
        .update({
          full_text: result.text,
          text_word_count: wordCount,
          text_version: result.format === 'pdf' ? 'scraped_pdf' : 'scraped_html',
          structured_excerpt: extractStructuredExcerpt(result.text),
          section_topic_scores: computeSectionTopicScores(result.text),
          synced_at: new Date().toISOString(),
        })
        .eq('id', bill.id)
      if (error) console.error(`[fetchBillText] Supabase update error:`, error.message)

      const { error: trackErr } = await supabase
        .from('bills')
        .update({
          text_fetch_attempts: 0,
          text_fetch_last_at: new Date().toISOString(),
          text_fetch_last_error: null,
        })
        .eq('id', bill.id)
      if (trackErr && trackErr.code !== 'PGRST204') {
        console.error('[fetchBillText] Tracking update error:', trackErr.message)
      }
    }

    return result.text
  } catch (err) {
    // Let rate-limit errors bubble up so backfillStateTexts can break its
    // loop without scoring a strike against this bill.
    if (err instanceof OpenStatesRateLimitError) throw err
    console.error(`[fetchBillText] Error for ${bill.openstates_id}:`, err.message)
    await recordTextFetchFailure(supabase, bill.id, err.message?.slice(0, 200) || 'unknown')
    return null
  }
}

// Fetch a single URL and extract text. Returns null on any failure so the
// caller can try the next format/version. Falls back to a loose-TLS raw
// https.get for sites with broken cert chains (CT, MS, etc. — see
// fetchInsecure block comment).
async function fetchAndExtract(url, format) {
  // Some legislature hosts serve an obfuscated-JS anti-bot challenge to
  // non-browser clients on the canonical URL, but the older "mirror" host
  // for the same legislature serves the real file directly. Rewrite before
  // the fetch so the magic-byte sniff below sees actual PDF bytes.
  //   NH: gc.nh.gov/bill_Status/pdf.aspx?id=X  →  2.6 KB eval(function(p,a,c)) shim
  //       www.gencourt.state.nh.us/bill_status/pdf.aspx?id=X  →  real PDF
  url = url.replace(
    /^https?:\/\/gc\.nh\.gov\/bill_Status\//i,
    'https://www.gencourt.state.nh.us/bill_status/',
  )

  let body = null
  let contentType = ''

  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        'Accept': format === 'pdf' ? 'application/pdf,*/*' : 'text/html,application/xhtml+xml,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(20000),
    })

    if (!resp.ok) {
      console.error(`[fetchBillText] ${format.toUpperCase()} fetch error: ${resp.status} for ${url.slice(0, 100)}`)
      return null
    }

    const contentLength = parseInt(resp.headers.get('content-length') || '0', 10)
    if (contentLength && contentLength > MAX_PDF_BYTES) {
      console.error(`[fetchBillText] ${format.toUpperCase()} too large (${contentLength} bytes) for ${url.slice(0, 100)}`)
      return null
    }

    contentType = resp.headers.get('content-type') || ''
    body = Buffer.from(await resp.arrayBuffer())
  } catch (err) {
    if (!isCertError(err)) {
      console.error(`[fetchBillText] ${format.toUpperCase()} fetch failed: ${err.message} (${err.cause?.code || 'no-cause'})`)
      return null
    }
    // TLS verification failed — retry with loose verification for this one
    // fetch. See fetchInsecure block comment for why this is safe.
    try {
      console.log(`[fetchBillText] Retrying ${url.slice(0, 80)} with loose TLS (${err.cause?.code})`)
      const result = await fetchInsecure(url)
      body = result.body
      contentType = result.contentType
    } catch (innerErr) {
      console.error(`[fetchBillText] ${format.toUpperCase()} loose-TLS fallback failed: ${innerErr.message}`)
      return null
    }
  }

  if (!body || body.byteLength === 0) return null
  if (body.byteLength > MAX_PDF_BYTES) {
    console.error(`[fetchBillText] Response too large after download (${body.byteLength} bytes)`)
    return null
  }

  try {
    // Sniff magic bytes to decide which parser to use. Content-type and the
    // caller's `format` hint both lie frequently — gov sites serve PDFs with
    // text/plain content-type, or HTML via .pdf extensions. Magic bytes are
    // the only signal we can trust. Synthesizers for states like UT/SC/WV/
    // LA/CO/ME return HTML URLs; forcing PDF-parse on them fails the whole
    // synth path with "Invalid PDF structure".
    const looksLikePdf = body.slice(0, 5).toString('latin1') === '%PDF-'
    if (looksLikePdf) {
      const PDFParse = await loadPDFParse()
      const parser = new PDFParse({ data: new Uint8Array(body) })
      try {
        const parsed = await parser.getText()
        return (parsed.text || '').replace(/\s+/g, ' ').trim()
      } finally {
        await parser.destroy().catch(() => {})
      }
    }

    const html = body.toString('utf-8')
    return extractTextFromHtml(html)
  } catch (err) {
    console.error(`[fetchBillText] ${format.toUpperCase()} extraction failed: ${err.message}`)
    return null
  }
}

// Increment the failed-attempt counter for a bill so backfillStateTexts can
// shelf it rather than hammering the same dead URL every day. Best-effort:
// silently no-ops if the tracking migration hasn't been applied yet.
async function recordTextFetchFailure(supabase, billId, errorText) {
  if (!supabase || !billId) return
  try {
    const { data, error: readErr } = await supabase
      .from('bills')
      .select('text_fetch_attempts')
      .eq('id', billId)
      .maybeSingle()
    // PGRST204 = column not in schema cache (migration pending). Skip silently.
    if (readErr?.code === 'PGRST204') return
    const prev = data?.text_fetch_attempts || 0
    const { error: writeErr } = await supabase
      .from('bills')
      .update({
        text_fetch_attempts: prev + 1,
        text_fetch_last_at: new Date().toISOString(),
        text_fetch_last_error: (errorText || 'unknown').slice(0, 200),
      })
      .eq('id', billId)
    if (writeErr && writeErr.code !== 'PGRST204') {
      console.error('[fetchBillText] Failed to record attempt:', writeErr.message)
    }
  } catch (err) {
    console.error('[fetchBillText] Failed to record attempt:', err.message)
  }
}

/**
 * Strips HTML tags and extracts readable text from a legislature page.
 * Uses balanced-div extraction to handle nested containers (e.g., California's
 * leginfo.legislature.ca.gov which nests bill text inside div#bill_all).
 */
function extractTextFromHtml(html) {
  // Remove script and style blocks entirely
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')

  // Try to extract from known content containers using balanced-div parsing
  // These IDs/classes are common across state legislature sites
  const containerIds = ['bill_all', 'bill_text', 'billTextContainer', 'billtext', 'bill-text', 'content_main', 'legislation']
  const containerClasses = ['bill-content', 'bill-text', 'legislation-text', 'billText']

  let extracted = null

  // Try ID-based containers first
  for (const id of containerIds) {
    const marker = text.indexOf(`id="${id}"`)
    if (marker === -1) continue
    const section = extractBalancedDiv(text, marker)
    if (section && section.length > 500) {
      extracted = section
      break
    }
  }

  // Try class-based containers
  if (!extracted) {
    for (const cls of containerClasses) {
      const marker = text.indexOf(`class="${cls}"`) !== -1
        ? text.indexOf(`class="${cls}"`)
        : text.indexOf(cls)
      if (marker === -1 || !text.slice(marker - 50, marker).includes('<div')) continue
      const section = extractBalancedDiv(text, marker)
      if (section && section.length > 500) {
        extracted = section
        break
      }
    }
  }

  // Try <article> or <main> tags
  if (!extracted) {
    const articleMatch = text.match(/<article[^>]*>([\s\S]*)<\/article>/i)
    if (articleMatch && articleMatch[1].length > 500) extracted = articleMatch[1]
  }
  if (!extracted) {
    const mainMatch = text.match(/<main[^>]*>([\s\S]*)<\/main>/i)
    if (mainMatch && mainMatch[1].length > 500) extracted = mainMatch[1]
  }

  if (extracted) text = extracted

  // Strip all remaining HTML tags
  text = text
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')

  // Decode HTML entities
  text = text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#\d+;/g, '')

  // Normalize whitespace
  text = text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()

  return text
}

/**
 * Extracts content from a balanced div starting near the given marker position.
 * Handles arbitrarily nested divs by counting open/close tags.
 */
function extractBalancedDiv(html, markerIndex) {
  // Find the opening <div that contains this marker
  let start = html.lastIndexOf('<div', markerIndex)
  if (start === -1) return null

  let depth = 0
  let i = start
  while (i < html.length) {
    if (html.slice(i, i + 4).toLowerCase() === '<div') {
      depth++
      i += 4
    } else if (html.slice(i, i + 6).toLowerCase() === '</div>') {
      depth--
      if (depth === 0) {
        return html.slice(start, i + 6)
      }
      i += 6
    } else {
      i++
    }
  }
  // If unbalanced, return what we have from start to end
  return html.slice(start)
}

// ─── State backfill queue ────────────────────────────────────────────────────
// Automatically backfills 30 days of state bills over ~12 days, respecting
// the Open States 1,000/day limit. Called after daily sync completes.

async function runStateBackfill(supabase, apiKey, dailyCallBudget = 800) {
  if (!supabase || !apiKey) return { synced: 0, calls: 0, statesCompleted: [] }

  console.log(`[backfill] Starting state backfill with budget of ${dailyCallBudget} calls`)

  // Determine which states need backfill:
  // A state needs backfill if it has no bills older than 7 days
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString()
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)

  // Get the oldest bill date per state
  const { data: stateStats, error: statsError } = await supabase
    .from('bills')
    .select('jurisdiction')
    .eq('source', 'openstates')
    .lt('updated_at', sevenDaysAgo)
    .limit(1)

  // Get all states that have bills in our DB
  const { data: existingStates } = await supabase
    .from('bills')
    .select('jurisdiction')
    .eq('source', 'openstates')

  const statesWithOldBills = new Set((stateStats || []).map(r => r.jurisdiction))
  const statesInDb = new Set((existingStates || []).map(r => r.jurisdiction))

  // States that need backfill = all 51 states minus those that already have old bills
  const allStates = Object.keys(STATE_NAMES)
  const statesNeedingBackfill = allStates.filter(s => !statesWithOldBills.has(s))

  if (!statesNeedingBackfill.length) {
    console.log('[backfill] All states have historical bills, no backfill needed')
    return { synced: 0, calls: 0, statesCompleted: [] }
  }

  // Sort: states already in DB first (we know they work), then alphabetical
  statesNeedingBackfill.sort((a, b) => {
    const aInDb = statesInDb.has(a) ? 0 : 1
    const bInDb = statesInDb.has(b) ? 0 : 1
    if (aInDb !== bInDb) return aInDb - bInDb
    return a.localeCompare(b)
  })

  console.log(`[backfill] ${statesNeedingBackfill.length} states need backfill: ${statesNeedingBackfill.slice(0, 10).join(', ')}...`)

  let totalSynced = 0
  let totalCalls = 0
  const statesCompleted = []

  for (const stateCode of statesNeedingBackfill) {
    if (totalCalls >= dailyCallBudget) {
      console.log(`[backfill] Daily budget exhausted (${totalCalls}/${dailyCallBudget} calls). Stopping.`)
      break
    }

    const remainingBudget = dailyCallBudget - totalCalls

    try {
      console.log(`[backfill] Backfilling ${stateCode} (${STATE_NAMES[stateCode]}), ~${remainingBudget} calls remaining`)

      const result = await syncOpenStates(supabase, apiKey, {
        since: thirtyDaysAgo,
        states: [stateCode],
      })

      totalSynced += result.synced
      totalCalls += result.calls
      statesCompleted.push(stateCode)

      console.log(`[backfill] ${stateCode}: synced ${result.synced} bills in ${result.calls} calls`)
    } catch (err) {
      console.error(`[backfill] Error backfilling ${stateCode}:`, err.message)
    }
  }

  console.log(`[backfill] Done: ${statesCompleted.length} states completed, ${totalSynced} bills synced, ${totalCalls} API calls`)
  return { synced: totalSynced, calls: totalCalls, statesCompleted }
}

// ─── Batch text fetch for state bills ────────────────────────────────────────
// Fetches full_text for state bills that don't have it. Runs after daily sync.
// Limited by Open States API quota.

async function backfillStateTexts(supabase, apiKey, options = {}) {
  const { limit: maxBills = 50 } = options
  if (!supabase || !apiKey) return { synced: 0, calls: 0 }

  // Cooldown threshold: after 5 consecutive failed attempts, skip the bill
  // for 14 days before trying again. This stops us from burning Open States
  // quota on permanently-dead URLs (withdrawn drafts, scanned PDFs with no
  // extractable text, expired legislature links) while still giving the bill
  // a second chance if anything changes upstream.
  const COOLDOWN_STRIKES = 5
  const cooldownCutoff = new Date(Date.now() - 14 * 86400000).toISOString()

  // Find state bills without full_text that are NOT currently in cooldown.
  // Two populations are eligible:
  //   - attempts < COOLDOWN_STRIKES  (fresh or lightly tried)
  //   - attempts >= COOLDOWN_STRIKES AND last attempt was > 14d ago
  // Supabase silently caps .limit() at ~1000 rows per query, so paginate with
  // .range() and stop once we have enough post-filter candidates. At maxBills
  // = 3000 this is typically 3–4 round trips.
  const PAGE_SIZE = 1000
  const candidates = []
  for (let from = 0; candidates.length < maxBills * 3; from += PAGE_SIZE) {
    const { data: page } = await supabase
      .from('bills')
      .select('id, openstates_id, jurisdiction, bill_type, bill_number, session, source, text_fetch_attempts, text_fetch_last_at')
      .eq('source', 'openstates')
      .is('full_text', null)
      .not('openstates_id', 'is', null)
      .order('text_fetch_attempts', { ascending: true })
      .order('updated_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)
    if (!page?.length) break
    candidates.push(...page)
    if (page.length < PAGE_SIZE) break
  }

  const needText = candidates.filter(b => {
    const attempts = b.text_fetch_attempts || 0
    if (attempts < COOLDOWN_STRIKES) return true
    return !b.text_fetch_last_at || b.text_fetch_last_at < cooldownCutoff
  }).slice(0, maxBills)

  if (!needText.length) {
    console.log('[backfill:text] No state bills eligible for text fetch (all in cooldown)')
    return { synced: 0, calls: 0, skippedCooldown: candidates.length }
  }

  const shelved = candidates.length - needText.length
  console.log(`[backfill:text] Fetching text for ${needText.length} state bills (${shelved} shelved in cooldown)`)
  let synced = 0
  let calls = 0
  let rateLimited = false

  for (const bill of needText) {
    try {
      const text = await fetchBillText(supabase, bill)
      calls++ // Each fetchBillText uses 1 Open States API call
      if (text) synced++
      // Rate limit: 500ms between calls (GraphQL limit is 2 req/sec)
      await sleep(500)
    } catch (err) {
      if (err instanceof OpenStatesRateLimitError) {
        // Daily quota exhausted — stop now. Remaining bills keep their
        // attempt counters untouched so tomorrow's run picks them up fresh.
        console.log(`[backfill:text] Open States daily quota exhausted after ${calls} calls; stopping early with ${synced} fetched`)
        rateLimited = true
        break
      }
      console.error(`[backfill:text] Error for ${bill.jurisdiction} ${bill.bill_type}${bill.bill_number}:`, err.message)
    }
  }

  console.log(`[backfill:text] Done: ${synced}/${needText.length} texts fetched, ${calls} API calls${rateLimited ? ' (rate-limited)' : ''}`)
  return { synced, calls, rateLimited }
}

// ─── Change-hash refresh: catch amendments on hot bills ─────────────────────
// Bills that already have text can still become stale — amendments, new
// versions, etc. Running this daily for pinned bills + the top ~200 most
// recently-active feed-eligible bills keeps the cache honest without burning
// the whole Congress.gov budget.
//
// Strategy:
//   1. Pinned bills (classroom assignments): always check, they're small in
//      number and students are actively reading them.
//   2. Top feed-eligible federal bills by recency: re-pull Congress.gov text
//      index; if latest version's action_date > our text_refreshed_at, refetch.
//
// State bills are skipped here — Open States quota is already saturated by
// the daily sync. The daily sync's existing `backfillStateTexts` will catch
// state changes on its own rotation.

async function refreshHotBillTexts(supabase, congressApiKey, options = {}) {
  if (!supabase || !congressApiKey) return { checked: 0, refreshed: 0 }
  const { maxFederal = 200 } = options
  const BASE = 'https://api.congress.gov/v3'
  const headers = { 'X-Api-Key': congressApiKey }

  // Pull pinned bills + top-recent feed-eligible federal bills
  const { data: pinned } = await supabase
    .from('bills')
    .select('id, bill_type, bill_number, session, jurisdiction, latest_action_date, text_refreshed_at')
    .gt('pinned_classroom_count', 0)
    .eq('jurisdiction', 'US')

  const { data: topFederal } = await supabase
    .from('bills')
    .select('id, bill_type, bill_number, session, jurisdiction, latest_action_date, text_refreshed_at')
    .eq('feed_eligible', true)
    .eq('jurisdiction', 'US')
    .order('latest_action_date', { ascending: false })
    .limit(maxFederal)

  // De-dupe by id (pinned bills may already be in topFederal)
  const byId = new Map()
  for (const row of [...(pinned || []), ...(topFederal || [])]) {
    if (row.jurisdiction === 'US' && !byId.has(row.id)) byId.set(row.id, row)
  }
  const candidates = [...byId.values()]
  if (!candidates.length) return { checked: 0, refreshed: 0 }

  console.log(`[refresh] Checking ${candidates.length} hot federal bills for text updates`)
  let checked = 0
  let refreshed = 0

  for (const bill of candidates) {
    checked++
    // If we already refreshed this bill within the last 24h, skip
    if (bill.text_refreshed_at && Date.now() - new Date(bill.text_refreshed_at).getTime() < 86400000) continue
    // If the bill hasn't had legislative action in 90 days, skip — text won't change
    if (bill.latest_action_date && Date.now() - new Date(bill.latest_action_date).getTime() > 90 * 86400000) continue

    try {
      const textUrl = `${BASE}/bill/${bill.session}/${bill.bill_type}/${bill.bill_number}/text?format=json`
      const resp = await fetch(textUrl, { headers })
      if (!resp.ok) continue
      const data = await resp.json()
      const latest = data.textVersions?.[0]
      if (!latest) continue

      // Re-fetch text content
      const fmt = latest.formats?.find(f => f.type === 'Formatted Text') || latest.formats?.[0]
      if (!fmt?.url) continue
      const txtResp = await fetch(fmt.url, { headers })
      if (!txtResp.ok) continue
      const fullText = (await txtResp.text()).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
      const wordCount = fullText.split(/\s+/).length

      await supabase.from('bills').update({
        full_text: fullText,
        text_word_count: wordCount,
        text_version: latest.type || 'Unknown',
        structured_excerpt: extractStructuredExcerpt(fullText),
        section_topic_scores: computeSectionTopicScores(fullText),
        text_refreshed_at: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      }).eq('id', bill.id)

      refreshed++
      await sleep(500)
    } catch (err) {
      console.error(`[refresh] Error for bill ${bill.id}:`, err.message)
    }
  }

  console.log(`[refresh] ${refreshed}/${checked} hot bills had text updates applied`)
  return { checked, refreshed }
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

export {
  runDailySync,
  runBackfill,
  syncCongressGov,
  syncOpenStates,
  syncLegiScanTexts,
  syncLegiScanCatalog,
  fetchBillText,
  runStateBackfill,
  backfillStateTexts,
  refreshHotBillTexts,
  extractTextFromHtml,
  classifyTopics,
  normalizeStatus,
  STATE_NAMES,
  URL_SYNTHESIZERS,
}
