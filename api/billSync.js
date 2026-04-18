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
  // legiscanApiKey intentionally NOT used in bulk sync anymore. LegiScan's
  // 30K/month quota is reserved for:
  //   1. runtime fetch when a student clicks Personalize on a search result
  //   2. on-demand text backfill when a teacher pins a bill via classroom assignment
  // See api/server.js — fetchBillTextFromLegiScan and pinBillForAssignment.
  const { congressApiKey, openStatesApiKey, states } = config
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

    // Phase 4: State text via Open States → legislature PDF/HTML.
    // With Phase 3 retired, the full Open States daily budget (minus ~100-300
    // consumed by Phase 2 metadata sync) is available for text fetching.
    // We ask for 1000 attempts but the backfill breaks early the moment
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
}

async function fetchBillText(supabase, bill) {
  if (!bill || bill.source !== 'openstates' || bill.full_text) return bill.full_text || null
  if (!bill.openstates_id) return null

  const apiKey = process.env.OPENSTATES_API_KEY
  if (!apiKey) {
    console.warn('[fetchBillText] No OPENSTATES_API_KEY configured')
    return null
  }

  const label = `${bill.jurisdiction} ${bill.bill_type}${bill.bill_number}`
  let lastError = null

  // Attempt 0: Direct URL synthesis (zero Open States quota burn).
  // For states with deterministic, stable URL patterns we can construct
  // the PDF URL from bill metadata and skip OS entirely. Falls through to
  // the OS hybrid below if synthesis misses (amended bill, non-R00-only
  // version, or a pattern variant we don't handle).
  const synthesizer = URL_SYNTHESIZERS[bill.jurisdiction]
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
    // Some gov sites return PDF with a generic content-type, or HTML links
    // that actually serve PDF. Sniff the magic bytes to decide which parser
    // to use regardless of what the caller expected.
    const looksLikePdf = body.slice(0, 5).toString('latin1') === '%PDF-'
    if (format === 'pdf' || looksLikePdf) {
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
  fetchBillText,
  runStateBackfill,
  backfillStateTexts,
  refreshHotBillTexts,
  extractTextFromHtml,
  classifyTopics,
  normalizeStatus,
  STATE_NAMES,
}
