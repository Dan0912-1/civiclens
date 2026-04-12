/**
 * Bill Sync Module — Populates local bills table from three sources:
 *   1. Congress.gov (federal, free, unlimited)
 *   2. Open States / Plural (state, 1000/day, 40/min)
 *   3. LegiScan (text gap-fill only, 30K/month)
 *
 * Designed to run as a daily cron. After initial backfill, only fetches
 * bills that changed since last sync.
 */

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
const TITLE_KEYWORDS_TO_TOPIC = [
  { keywords: ['student', 'school', 'education', 'teacher', 'college', 'university', 'tuition', 'pell grant'], topic: 'education' },
  { keywords: ['climate', 'environment', 'clean energy', 'carbon', 'pollution', 'renewable', 'electric vehicle', 'wildlife'], topic: 'environment' },
  { keywords: ['minimum wage', 'workforce', 'small business', 'unemployment', 'tax', 'cost of living', 'wage'], topic: 'economy' },
  { keywords: ['health', 'mental', 'medicaid', 'drug', 'insurance', 'telehealth', 'substance'], topic: 'healthcare' },
  { keywords: ['artificial intelligence', 'data privacy', 'broadband', 'social media', 'cyber', 'algorithm', 'internet'], topic: 'technology' },
  { keywords: ['housing', 'rent', 'homeless', 'mortgage', 'tenant', 'zoning'], topic: 'housing' },
  { keywords: ['immigration', 'daca', 'visa', 'asylum', 'citizen', 'border', 'refugee', 'deportat'], topic: 'immigration' },
  { keywords: ['voting', 'civil rights', 'discrimination', 'police', 'racial', 'disability', 'lgbtq', 'equal pay'], topic: 'civil_rights' },
  { keywords: ['americorps', 'volunteer', 'nonprofit', 'community', 'food assistance', 'library', 'rural'], topic: 'community' },
]

function classifyTopics(subjects, title) {
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

  // 2. Keyword fallback from title if no subjects matched
  if (topics.size === 0 && title) {
    const lowerTitle = title.toLowerCase()
    for (const { keywords, topic } of TITLE_KEYWORDS_TO_TOPIC) {
      if (keywords.some(kw => lowerTitle.includes(kw))) {
        topics.add(topic)
      }
    }
  }

  return [...topics]
}

// ─── Status normalization ──────────────────────────────────────────────────
function normalizeStatus(rawStatus, latestAction) {
  const s = (rawStatus || '').toLowerCase()
  const a = (latestAction || '').toLowerCase()

  if (s.includes('enacted') || s.includes('signed') || a.includes('became public law')) return 'enacted'
  if (s.includes('vetoed') || a.includes('vetoed')) return 'vetoed'
  if (s.includes('passed') && s.includes('both')) return 'passed_both'
  if (a.includes('passed house') || a.includes('passed senate') || s.includes('passed')) return 'passed_one'
  if (a.includes('committee') || s.includes('committee') || a.includes('referred')) return 'in_committee'
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
    .limit(100) // Process 100 per run max

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
    .limit(50)

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
        const params = new URLSearchParams({
          jurisdiction: stateName,
          updated_since: sinceDate,
          per_page: '20',
          page: String(page),
          include: 'sponsorships',
          apikey: apiKey,
        })

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

        for (const bill of bills) {
          // Parse bill identifier (e.g., "HB 1234", "SB 42", "AB 2447")
          const match = bill.identifier?.match(/^([A-Z]+)\s*(\d+)$/i)
          if (!match) continue

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
  const { congressApiKey, openStatesApiKey, legiscanApiKey, states } = config
  const startTime = Date.now()
  const results = {}

  console.log('[sync] ═══════════════════════════════════════════════')
  console.log('[sync] Daily bill sync starting at', new Date().toISOString())
  console.log('[sync] ═══════════════════════════════════════════════')

  // Phase 1: Federal (Congress.gov)
  if (congressApiKey) {
    try {
      results.congress = await syncCongressGov(supabase, congressApiKey)
    } catch (err) {
      console.error('[sync] Congress.gov sync failed:', err.message)
      results.congress = { error: err.message }
    }
  }

  // Phase 2: State bills (Open States)
  if (openStatesApiKey) {
    try {
      results.openstates = await syncOpenStates(supabase, openStatesApiKey, { states })
    } catch (err) {
      console.error('[sync] Open States sync failed:', err.message)
      results.openstates = { error: err.message }
    }
  }

  // Phase 3: Text gap-fill (LegiScan)
  if (legiscanApiKey) {
    try {
      results.legiscan = await syncLegiScanTexts(supabase, legiscanApiKey)
    } catch (err) {
      console.error('[sync] LegiScan text sync failed:', err.message)
      results.legiscan = { error: err.message }
    }
  }

  // Phase 4: State backfill (spread over ~12 days)
  if (openStatesApiKey) {
    try {
      results.stateBackfill = await runStateBackfill(supabase, openStatesApiKey)
    } catch (err) {
      console.error('[sync] State backfill failed:', err.message)
      results.stateBackfill = { error: err.message }
    }

    // Phase 5: Fetch text for state bills that are missing it
    try {
      results.stateTexts = await backfillStateTexts(supabase, openStatesApiKey, { limit: 30 })
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

// ─── On-demand bill text fetching (Open States → legislature HTML) ────────
// For state bills missing full_text. Fetches version links from Open States,
// then scrapes the legislature HTML page to extract bill text.

async function fetchBillText(supabase, bill) {
  if (!bill || bill.source !== 'openstates' || bill.full_text) return bill.full_text || null
  if (!bill.openstates_id) return null

  const apiKey = process.env.OPENSTATES_API_KEY
  if (!apiKey) {
    console.warn('[fetchBillText] No OPENSTATES_API_KEY configured')
    return null
  }

  try {
    // Step 1: Query Open States for bill versions using the OCD bill ID
    const billId = encodeURIComponent(bill.openstates_id)
    const url = `${OPENSTATES_BASE}/bills/${billId}?include=versions&apikey=${apiKey}`
    console.log(`[fetchBillText] Fetching versions for ${bill.jurisdiction} ${bill.bill_type}${bill.bill_number}`)

    const resp = await fetch(url)
    if (!resp.ok) {
      console.error(`[fetchBillText] Open States API error: ${resp.status}`)
      return null
    }

    const data = await resp.json()
    const versions = data.versions || []
    if (!versions.length) {
      console.log(`[fetchBillText] No versions available for ${bill.openstates_id}`)
      return null
    }

    // Step 2: Find the latest version with an HTML link
    // Versions are usually ordered chronologically; take the last one (most recent)
    let htmlUrl = null
    for (let i = versions.length - 1; i >= 0; i--) {
      const version = versions[i]
      const links = version.links || []
      // Prefer text/html over application/pdf
      const htmlLink = links.find(l =>
        l.media_type === 'text/html' ||
        (l.url && !l.url.endsWith('.pdf') && !l.media_type?.includes('pdf'))
      )
      if (htmlLink?.url) {
        htmlUrl = htmlLink.url
        break
      }
    }

    if (!htmlUrl) {
      console.log(`[fetchBillText] No HTML version found for ${bill.openstates_id} (PDF-only or no links)`)
      return null
    }

    // Step 3: Fetch the HTML page from the state legislature site (free, no API cost)
    console.log(`[fetchBillText] Scraping text from: ${htmlUrl}`)
    const htmlResp = await fetch(htmlUrl, {
      headers: {
        'User-Agent': 'CapitolKey/1.0 (civic education platform)',
        'Accept': 'text/html',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!htmlResp.ok) {
      console.error(`[fetchBillText] Legislature site error: ${htmlResp.status} for ${htmlUrl}`)
      return null
    }

    const html = await htmlResp.text()

    // Step 4: Extract text from HTML
    const fullText = extractTextFromHtml(html)
    if (!fullText || fullText.length < 100) {
      console.log(`[fetchBillText] Extracted text too short (${fullText?.length || 0} chars), skipping`)
      return null
    }

    const wordCount = fullText.split(/\s+/).length
    console.log(`[fetchBillText] Extracted ${wordCount} words for ${bill.jurisdiction} ${bill.bill_type}${bill.bill_number}`)

    // Step 5: Save to Supabase
    if (supabase && bill.id) {
      const { error } = await supabase
        .from('bills')
        .update({
          full_text: fullText,
          text_word_count: wordCount,
          text_version: 'scraped_html',
          synced_at: new Date().toISOString(),
        })
        .eq('id', bill.id)

      if (error) {
        console.error(`[fetchBillText] Supabase update error:`, error.message)
      }
    }

    return fullText
  } catch (err) {
    console.error(`[fetchBillText] Error for ${bill.openstates_id}:`, err.message)
    return null
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

  // Find state bills without full_text
  const { data: needText } = await supabase
    .from('bills')
    .select('id, openstates_id, jurisdiction, bill_type, bill_number, session, source')
    .eq('source', 'openstates')
    .is('full_text', null)
    .not('openstates_id', 'is', null)
    .order('updated_at', { ascending: false })
    .limit(maxBills)

  if (!needText?.length) {
    console.log('[backfill:text] No state bills need text fetching')
    return { synced: 0, calls: 0 }
  }

  console.log(`[backfill:text] Fetching text for ${needText.length} state bills`)
  let synced = 0
  let calls = 0

  for (const bill of needText) {
    try {
      const text = await fetchBillText(supabase, bill)
      calls++ // Each fetchBillText uses 1 Open States API call
      if (text) synced++
      // Rate limit: 1.5s between calls (Open States limit is 40/min)
      await sleep(1500)
    } catch (err) {
      console.error(`[backfill:text] Error for ${bill.jurisdiction} ${bill.bill_type}${bill.bill_number}:`, err.message)
    }
  }

  console.log(`[backfill:text] Done: ${synced}/${needText.length} texts fetched, ${calls} API calls`)
  return { synced, calls }
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
  extractTextFromHtml,
  classifyTopics,
  normalizeStatus,
  STATE_NAMES,
}
