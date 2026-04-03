// api/server.js — CapitolKey Backend
// All API keys live here, never in the frontend

import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import rateLimit from 'express-rate-limit'
import { createClient } from '@supabase/supabase-js'
import cron from 'node-cron'
import { Resend } from 'resend'
import { GoogleAuth } from 'google-auth-library'
import { billUpdateEmail } from './emailTemplates.js'

const app = express()

// Trust Railway's reverse proxy so express-rate-limit reads the real client IP
app.set('trust proxy', 1)

// ─── Security headers ────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: false, // CSP handled by frontend / Capacitor
  crossOriginEmbedderPolicy: false, // allow loading external resources
}))

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allows the Vercel web frontend, the Capacitor iOS/Android app (capacitor://
// and https://localhost), and local dev. Add origins via FRONTEND_URL on Railway.
const EXTRA_ORIGIN = process.env.FRONTEND_URL

const ALLOWED_ORIGINS = new Set([
  'capacitor://localhost',              // iOS Capacitor app
  'https://localhost',                  // Android Capacitor app
  'http://localhost:5173',              // Vite dev server
  'http://localhost:4173',              // Vite preview
  'https://civiclens-six.vercel.app', // Vercel deployment
  ...(EXTRA_ORIGIN ? [EXTRA_ORIGIN] : []),
])

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman, server-to-server)
    if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true)
    callback(new Error(`CORS: origin ${origin} not allowed`))
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.use(express.json())

// ─── Rate limiting ───────────────────────────────────────────────────────────
// Protects expensive endpoints from abuse (AI personalization, LegiScan proxy)
const legislationLimiter = rateLimit({
  windowMs: 60 * 1000,     // 1 minute
  max: 15,                  // 15 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please wait a moment and try again.' },
})

const personalizeLimiter = rateLimit({
  windowMs: 60 * 1000,     // 1 minute
  max: 30,                  // 30 personalizations per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many personalization requests — please slow down.' },
})

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50,                   // 50 auth-related requests per 15 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests — please try again later.' },
})

const LEGISCAN_KEY = process.env.LEGISCAN_API_KEY
const GROQ_KEY = process.env.GROQ_API_KEY
const LEGISCAN_BASE = 'https://api.legiscan.com/'
// FCM V1 API — uses a service account JSON (set as env var FCM_SERVICE_ACCOUNT)
const FCM_SERVICE_ACCOUNT = process.env.FCM_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FCM_SERVICE_ACCOUNT) : null
const FCM_PROJECT_ID = FCM_SERVICE_ACCOUNT?.project_id || null
const fcmAuth = FCM_SERVICE_ACCOUNT
  ? new GoogleAuth({
      credentials: FCM_SERVICE_ACCOUNT,
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    })
  : null

const RESEND_KEY = process.env.RESEND_API_KEY
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'CapitolKey <onboarding@resend.dev>'
const resend = RESEND_KEY ? new Resend(RESEND_KEY) : null

// ─── Supabase client (persistent cache for Claude personalizations) ──────────
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const supabase = SUPABASE_URL && SUPABASE_KEY
  ? createClient(SUPABASE_URL, SUPABASE_KEY)
  : null

// ─── In-memory cache for cheap/volatile Congress.gov calls ───────────────────
const cache = new Map()
const CACHE_TTL = 1000 * 60 * 60 // 1 hour

function getCache(key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key)
    return null
  }
  return entry.data
}

function setCache(key, data) {
  cache.set(key, { data, timestamp: Date.now() })
}

// ─── Supabase-backed persistent cache for personalizations ──────────────────
async function getSupabaseCache(key) {
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('personalization_cache')
      .select('response')
      .eq('cache_key', key)
      .single()
    if (error || !data) return null
    return data.response
  } catch {
    return null
  }
}

async function setSupabaseCache(key, billId, grade, interests, response) {
  if (!supabase) return
  try {
    await supabase
      .from('personalization_cache')
      .upsert({
        cache_key: key,
        bill_id: billId,
        grade,
        interests,
        response,
      }, { onConflict: 'cache_key' })
  } catch (err) {
    console.error('Supabase cache write error:', err.message)
  }
}

// ─── LegiScan API helpers ───────────────────────────────────────────────────
async function legiscanRequest(op, params = {}) {
  const url = new URL(LEGISCAN_BASE)
  url.searchParams.set('key', LEGISCAN_KEY)
  url.searchParams.set('op', op)
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v)
  }
  const resp = await fetch(url.toString())
  if (!resp.ok) throw new Error(`LegiScan ${op} failed: ${resp.status}`)
  const data = await resp.json()
  if (data.status === 'ERROR') throw new Error(`LegiScan ${op}: ${JSON.stringify(data)}`)
  return data
}

// Transform LegiScan search result → frontend bill object
function transformLegiScanBill(hit, searchTerm = '') {
  const billNum = hit.bill_number || ''
  // Parse bill type and number from e.g. "HB2275", "SB123", "HJR45"
  const match = billNum.match(/^([A-Z]+?)(\d+)$/)
  const rawType = match ? match[1] : billNum
  const number = match ? parseInt(match[2], 10) : 0
  // Map LegiScan type prefixes to Congress.gov style lowercase types
  const typeMap = { HB: 'hr', SB: 's', HR: 'hres', SR: 'sres', HJR: 'hjres', SJR: 'sjres', HCR: 'hconres', SCR: 'sconres' }
  const type = typeMap[rawType] || rawType.toLowerCase()

  // Derive chamber from type prefix
  const chamber = rawType.startsWith('S') ? 'Senate' : 'House'

  // Determine congress number from the session or default to current
  const congress = 119 // Current congress — LegiScan doesn't expose this directly for federal

  return {
    congress,
    type,
    number,
    title: hit.title || '',
    originChamber: chamber,
    latestAction: hit.last_action || 'No recent action',
    latestActionDate: hit.last_action_date || '',
    url: hit.url || '',
    updateDate: hit.last_action_date || '',
    searchTerm,
    legiscan_bill_id: hit.bill_id,
    state: hit.state || 'US',
  }
}

// Transform a LegiScan state bill (CT, NY, etc.) → frontend bill object
function transformLegiScanStateBill(hit, searchTerm = '') {
  const billNum = hit.bill_number || ''
  const match = billNum.match(/^([A-Z]+?)(\d+)$/)
  const rawType = match ? match[1] : billNum
  const number = match ? parseInt(match[2], 10) : 0

  const chamber = rawType.startsWith('S') ? 'Senate' : 'House'

  return {
    congress: 0, // Not a federal bill
    type: rawType.toLowerCase(),
    number,
    title: hit.title || '',
    originChamber: chamber,
    latestAction: hit.last_action || 'No recent action',
    latestActionDate: hit.last_action_date || '',
    url: hit.url || '',
    updateDate: hit.last_action_date || '',
    searchTerm,
    legiscan_bill_id: hit.bill_id,
    state: hit.state || '',
    isStateBill: true,
  }
}

// ─── Health checks ────────────────────────────────────────────────────────────
// Railway's proxy verifies GET / to confirm the service is up
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'CapitolKey API', timestamp: new Date().toISOString() })
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── App version check (force-update mechanism) ─────────────────────────────
// Native apps check this on launch to see if they need to update.
// Bump MIN_VERSION when you ship a breaking API change.
const CURRENT_VERSION = '1.0.0'
const MIN_VERSION = '1.0.0'

app.get('/api/version', (req, res) => {
  res.json({
    currentVersion: CURRENT_VERSION,
    minVersion: MIN_VERSION,
    updateUrl: {
      ios: 'https://apps.apple.com/app/capitolkey/id0000000000',
      android: 'https://play.google.com/store/apps/details?id=com.danieljacius.capitolkey',
    },
  })
})

// ─── Input validation helpers ───────────────────────────────────────────────
const VALID_GRADES = ['9', '10', '11', '12']
const VALID_INTERESTS = ['education', 'environment', 'economy', 'healthcare', 'technology', 'housing', 'immigration', 'civil_rights', 'community']
const US_STATES = ['AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC']

function validateLegislationBody(body) {
  const errors = []
  if (body.grade && !VALID_GRADES.includes(String(body.grade))) errors.push('Invalid grade')
  if (body.state && !US_STATES.includes(body.state)) errors.push('Invalid state')
  if (body.interests && !Array.isArray(body.interests)) errors.push('Interests must be an array')
  if (body.interests?.some(i => !VALID_INTERESTS.includes(i))) errors.push('Invalid interest value')
  return errors
}

function validatePersonalizeBody(body) {
  const errors = []
  if (!body.bill) errors.push('bill is required')
  if (!body.profile) errors.push('profile is required')
  if (body.bill && (!body.bill.type || !body.bill.number)) {
    errors.push('bill must include type and number')
  }
  return errors
}

// ─── Fetch bills from LegiScan ──────────────────────────────────────────────
// Searches recent federal + state bills filtered by student-relevant topics
app.post('/api/legislation', legislationLimiter, async (req, res) => {
  const valErrors = validateLegislationBody(req.body)
  if (valErrors.length) return res.status(400).json({ error: valErrors.join(', ') })

  const { interests = [], grade, state, interactionSummary } = req.body

  // ── Optional auth: enables server-side interaction scoring ──
  const user = await getOptionalUser(req)
  const userId = user?.id || null

  const today = new Date().toISOString().slice(0, 10)

  // For anonymous users, use in-memory cache (no interaction data to personalize)
  if (!userId) {
    const anonCacheKey = `ls-bills-${interests.sort().join('-')}-${grade}-${state || 'US'}-${today}`
    const cached = getCache(anonCacheKey)
    if (cached) return res.json(cached)
  }

  try {
    // ── 1. Fetch interaction history server-side for auth'd users ──
    const { interactionMap, topicCounts } = await getUserInteractions(userId)

    // Build interaction summary from server data (or fall back to client-sent)
    const effectiveTopicCounts = Object.keys(topicCounts).length > 0
      ? topicCounts
      : (interactionSummary?.topicCounts || {})

    // ── 2. Build search terms: interest terms + discovery terms ──
    const searchTerms = Object.keys(effectiveTopicCounts).length > 0
      ? buildWeightedSearchTerms(interests, effectiveTopicCounts)
      : buildSearchTerms(interests)

    const discoveryTerms = pickDiscoveryTerms(interests)
    const discoveryTermSet = new Set(discoveryTerms)
    const popularBillIds = await getPopularBillIds()
    const allBills = []

    // ── 3. Fetch from LegiScan: interest terms + discovery terms ──
    // Interest-matched federal bills (6 terms × 10 results)
    const federalFetches = searchTerms.slice(0, 6).map(term =>
      legiscanRequest('search', { state: 'US', query: term, year: '2' })
        .then(data => {
          if (!data.searchresult) return []
          return Object.values(data.searchresult)
            .filter(r => r.bill_id)
            .slice(0, 10)
            .map(hit => transformLegiScanBill(hit, term))
        })
        .catch(err => {
          console.error(`LegiScan search error for US "${term}":`, err.message)
          return []
        })
    )

    // Discovery federal bills (3 trending terms × 6 results)
    const discoveryFetches = discoveryTerms.map(term =>
      legiscanRequest('search', { state: 'US', query: term, year: '2' })
        .then(data => {
          if (!data.searchresult) return []
          return Object.values(data.searchresult)
            .filter(r => r.bill_id)
            .slice(0, 6)
            .map(hit => ({ ...transformLegiScanBill(hit, term), _isDiscovery: true }))
        })
        .catch(err => {
          console.error(`LegiScan discovery search error "${term}":`, err.message)
          return []
        })
    )

    // State bills (3 interest terms × 4 results)
    const stateFetches = state && state !== 'DC' ? searchTerms.slice(0, 3).map(term =>
      legiscanRequest('search', { state, query: term, year: '2' })
        .then(data => {
          if (!data.searchresult) return []
          return Object.values(data.searchresult)
            .filter(r => r.bill_id)
            .slice(0, 4)
            .map(hit => transformLegiScanStateBill(hit, term))
        })
        .catch(err => {
          console.error(`LegiScan search error for ${state} "${term}":`, err.message)
          return []
        })
    ) : []

    const [federalResults, discoveryResults, stateResults] = await Promise.all([
      Promise.all(federalFetches),
      Promise.all(discoveryFetches),
      Promise.all(stateFetches),
    ])
    for (const bills of federalResults) allBills.push(...bills)
    for (const bills of discoveryResults) allBills.push(...bills)
    for (const bills of stateResults) allBills.push(...bills)

    // ── 4. Deduplicate (keep newest version) ──
    allBills.sort((a, b) => new Date(b.updateDate) - new Date(a.updateDate))
    const seen = new Set()
    const uniqueById = allBills.filter(b => {
      const id = b.legiscan_bill_id || `${b.state}-${b.type}${b.number}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })

    // Also deduplicate companion bills (same bill in Senate vs House) and
    // amended versions by comparing normalized titles
    const unique = deduplicateCompanionBills(uniqueById)

    // ── 5. Build scoring context ──
    const interestTerms = new Set()
    for (const interest of interests) {
      if (INTEREST_MAP[interest]) {
        for (const t of INTEREST_MAP[interest]) interestTerms.add(t)
      }
    }
    // Mark emerging-interest bills (user engages but not in profile)
    const emergingInterests = new Set()
    for (const [tag, count] of Object.entries(effectiveTopicCounts)) {
      const key = TAG_TO_INTEREST[tag]
      if (key && !interests.includes(key) && count > 3 && INTEREST_MAP[key]) {
        for (const t of INTEREST_MAP[key]) emergingInterests.add(t)
      }
    }
    for (const bill of unique) {
      if (emergingInterests.has(bill.searchTerm)) bill._isEmerging = true
    }

    const scoringCtx = { interestTerms, interactionMap, discoveryTermSet, popularBillIds }

    // ── 6. Score every bill ──
    for (const bill of unique) computeBillScore(bill, scoringCtx)

    // ── 7. 70/30 interest-discovery split with federal/state balance ──
    const interestPool = unique.filter(b => !b._isDiscovery)
    const discoveryPool = unique.filter(b => b._isDiscovery)
    interestPool.sort((a, b) => b._score - a._score)
    discoveryPool.sort((a, b) => b._score - a._score)

    // Target: 15 bills total, ~80% interest (~12), ~20% discovery (~3)
    const TARGET_TOTAL = 15
    const targetInterest = Math.round(TARGET_TOTAL * 0.8)
    const targetDiscovery = TARGET_TOTAL - targetInterest

    // Pick top interest bills, balanced federal/state
    const interestFederal = interestPool.filter(b => !b.isStateBill)
    const interestState = interestPool.filter(b => b.isStateBill)
    const maxInterestState = Math.min(interestState.length, Math.round(targetInterest * 0.35))
    const maxInterestFederal = targetInterest - maxInterestState
    const pickedInterest = [
      ...interestFederal.slice(0, maxInterestFederal),
      ...interestState.slice(0, maxInterestState),
    ]

    // Pick top discovery bills
    const pickedDiscovery = discoveryPool
      .filter(b => !pickedInterest.some(p => (p.legiscan_bill_id || '') === (b.legiscan_bill_id || '')))
      .slice(0, targetDiscovery)

    // Combine and sort by score
    const balanced = [...pickedInterest, ...pickedDiscovery]
    balanced.sort((a, b) => b._score - a._score)

    // Clean internal fields but keep _score as `rankScore` for frontend re-ranking
    for (const bill of balanced) {
      bill.rankScore = bill._score
      delete bill._score
      delete bill._isDiscovery
      delete bill._isEmerging
    }

    const result = { bills: balanced }

    // Cache for anonymous users only (auth'd feeds are personalized per interaction history)
    if (!userId) {
      const anonCacheKey = `ls-bills-${interests.sort().join('-')}-${grade}-${state || 'US'}-${today}`
      setCache(anonCacheKey, result)
    }

    res.json(result)

    // Pre-fetch bill texts in background so they're cached before personalization
    prefetchBillTexts(result.bills).catch(err =>
      console.error('[prefetch] Background bill text fetch error:', err.message)
    )

  } catch (err) {
    console.error('Legislation fetch error:', err)
    res.status(500).json({ error: 'Failed to fetch legislation', detail: err.message })
  }
})

// ─── Search bills by keyword ─────────────────────────────────────────────────
// Free-text search for bills via LegiScan — powers the /search page
app.get('/api/search', legislationLimiter, async (req, res) => {
  const q = (req.query.q || '').trim()
  if (!q || q.length < 2) return res.status(400).json({ error: 'Search query must be at least 2 characters' })
  if (q.length > 200) return res.status(400).json({ error: 'Search query must be under 200 characters' })

  const state = req.query.state || 'US'
  if (state !== 'US' && !US_STATES.includes(state)) return res.status(400).json({ error: 'Invalid state' })

  const page = Math.max(1, Math.min(20, parseInt(req.query.page, 10) || 1))

  const cacheKey = `search-${q.toLowerCase()}-${state}-${page}`
  const cached = getCache(cacheKey)
  if (cached) return res.json(cached)

  try {
    // Detect bill number patterns like "HR 1234", "H.R. 1234", "S 5678", "SB123"
    const normalized = q.replace(/\./g, '').replace(/\s+/g, ' ').trim().toUpperCase()
    const billNumMatch = normalized.match(
      /^(HR|S|HB|SB|HRES|SRES|HJRES|SJRES|HCONRES|SCONRES|HJR|SJR|HCR|SCR)\s*(\d+)$/
    )

    // For bill number searches, convert to natural language so LegiScan keyword search
    // finds the bill. Direct bill number formats (SB310, SB00310) don't reliably match.
    // "senate bill 310" works for both federal (SB310) and state (SB00310).
    let searchQuery = q
    let targetBillNum = null // The number to match in results for exact-match promotion
    if (billNumMatch) {
      const prefix = billNumMatch[1]
      const num = billNumMatch[2]
      targetBillNum = parseInt(num, 10)
      // Map prefix to chamber keyword for natural language search
      const chamberMap = {
        S: 'senate bill', SB: 'senate bill',
        HR: 'house bill', HB: 'house bill', H: 'house bill',
        HRES: 'house resolution', SRES: 'senate resolution',
        HJR: 'house joint resolution', HJRES: 'house joint resolution',
        SJR: 'senate joint resolution', SJRES: 'senate joint resolution',
        HCR: 'house concurrent resolution', HCONRES: 'house concurrent resolution',
        SCR: 'senate concurrent resolution', SCONRES: 'senate concurrent resolution',
      }
      searchQuery = `${chamberMap[prefix] || prefix.toLowerCase()} ${num}`
    }

    const data = await legiscanRequest('search', { state, query: searchQuery, year: '2', page })
    if (!data.searchresult) return res.json({ bills: [], pagination: { page, totalResults: 0, hasMore: false } })

    const summary = data.searchresult.summary || {}
    const totalResults = summary.count || 0

    const hits = Object.values(data.searchresult).filter(r => r.bill_id)
    const transform = state === 'US' ? transformLegiScanBill : transformLegiScanStateBill
    const bills = hits.map(hit => transform(hit, q))

    // Deduplicate by legiscan_bill_id then by similar titles (companion bills)
    const seen = new Set()
    const uniqueById = bills.filter(b => {
      const id = b.legiscan_bill_id || `${b.state}-${b.type}${b.number}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })
    const unique = deduplicateCompanionBills(uniqueById)

    // Sort: title-match relevance first, then recency. If bill number search, exact match goes first.
    const termLower = q.toLowerCase()
    unique.sort((a, b) => {
      // Exact bill number match gets highest priority
      if (targetBillNum) {
        const aExact = a.number === targetBillNum ? 1 : 0
        const bExact = b.number === targetBillNum ? 1 : 0
        if (aExact !== bExact) return bExact - aExact
      }
      // Title contains search term gets next priority
      const aInTitle = a.title.toLowerCase().includes(termLower) ? 1 : 0
      const bInTitle = b.title.toLowerCase().includes(termLower) ? 1 : 0
      if (aInTitle !== bInTitle) return bInTitle - aInTitle
      // Then by recency
      return new Date(b.updateDate) - new Date(a.updateDate)
    })

    const pageSize = hits.length
    const hasMore = page * pageSize < totalResults

    const result = { bills: unique, pagination: { page, totalResults, hasMore } }
    setCache(cacheKey, result)
    res.json(result)

  } catch (err) {
    console.error('Search error:', err)
    res.status(500).json({ error: 'Search failed', detail: err.message })
  }
})

// ─── Get single bill detail ───────────────────────────────────────────────────
// Supports both LegiScan bill ID (?legiscan_id=123) and legacy congress/type/number URL
app.get('/api/bill/:congress/:type/:number', async (req, res) => {
  const { congress, type, number } = req.params
  const legiscanId = req.query.legiscan_id

  if (legiscanId) {
    const cacheKey = `bill-ls-${legiscanId}`
    const cached = getCache(cacheKey)
    if (cached) return res.json(cached)

    try {
      const data = await legiscanRequest('getBill', { id: legiscanId })
      const b = data.bill
      // Transform to a shape the frontend expects
      const result = {
        bill: {
          congress: b.state === 'US' ? 119 : 0,
          type: type,
          number: parseInt(number),
          title: b.title,
          description: b.description || '',
          originChamber: b.body_id === 1 ? 'House' : 'Senate',
          latestAction: { text: b.status_desc || b.last_action || '', actionDate: b.status_date || b.last_action_date || '' },
          url: b.url || '',
          sponsors: (b.sponsors || []).map(s => ({
            firstName: s.first_name || s.name?.split(' ')[0] || '',
            lastName: s.last_name || s.name?.split(' ').slice(1).join(' ') || '',
            party: s.party || '',
            state: s.state || '',
          })),
          cosponsors: { count: (b.sponsors || []).length > 1 ? (b.sponsors.length - 1) : 0 },
          policyArea: { name: b.subjects?.[0]?.subject_name || '' },
          introducedDate: b.status_date || '',
          committees: { count: (b.committee || []).length },
          state: b.state || 'US',
          legiscan_bill_id: b.bill_id,
        },
      }
      setCache(cacheKey, result)
      res.json(result)
    } catch (err) {
      console.error('LegiScan getBill error:', err.message)
      res.status(500).json({ error: 'Failed to fetch bill detail' })
    }
  } else {
    // Fallback: try to search LegiScan for this bill by number
    const cacheKey = `bill-${congress}-${type}-${number}`
    const cached = getCache(cacheKey)
    if (cached) return res.json(cached)

    try {
      const billNumber = `${type.toUpperCase()}${number}`
      const data = await legiscanRequest('search', { state: 'US', query: billNumber, year: '2' })
      const results = data.searchresult ? Object.values(data.searchresult).filter(r => r.bill_id) : []
      const match = results.find(r => r.bill_number === billNumber)
      if (match) {
        const detailData = await legiscanRequest('getBill', { id: match.bill_id })
        const b = detailData.bill
        const result = {
          bill: {
            congress: 119,
            type,
            number: parseInt(number),
            title: b.title,
            description: b.description || '',
            originChamber: b.body_id === 1 ? 'House' : 'Senate',
            latestAction: { text: b.status_desc || b.last_action || '', actionDate: b.status_date || '' },
            url: b.url || '',
            sponsors: (b.sponsors || []).map(s => ({
              firstName: s.first_name || s.name?.split(' ')[0] || '',
              lastName: s.last_name || s.name?.split(' ').slice(1).join(' ') || '',
              party: s.party || '',
              state: s.state || '',
            })),
            cosponsors: { count: Math.max(0, (b.sponsors || []).length - 1) },
            policyArea: { name: b.subjects?.[0]?.subject_name || '' },
            introducedDate: b.status_date || '',
            committees: { count: (b.committee || []).length },
            legiscan_bill_id: b.bill_id,
          },
        }
        setCache(cacheKey, result)
        res.json(result)
      } else {
        res.status(404).json({ error: 'Bill not found' })
      }
    } catch (err) {
      console.error('Bill detail fetch error:', err.message)
      res.status(500).json({ error: 'Failed to fetch bill detail' })
    }
  }
})

// ─── Personalization endpoint (Groq GPT-OSS 120B) ──────────────────────────
app.post('/api/personalize', personalizeLimiter, async (req, res) => {
  const valErrors = validatePersonalizeBody(req.body)
  if (valErrors.length) return res.status(400).json({ error: valErrors.join(', ') })

  const { bill, profile } = req.body

  const sortedInterests = (profile.interests || []).sort()
  // v3 cache key — invalidates v2 results cached before format string fix
  const cacheKey = `v3-personalize-${bill.type}${bill.number}-${bill.congress}-${profile.grade}-${sortedInterests.join('-')}`

  // Check Supabase persistent cache first, fall back to in-memory
  const cached = await getSupabaseCache(cacheKey) || getCache(cacheKey)
  if (cached) return res.json(cached)

  // Fetch full bill content for accurate personalization
  const billType = bill.type?.toLowerCase().replace(/\./g, '') || ''
  const billData = await fetchBillContent(bill.congress, billType, bill.number, bill.legiscan_bill_id)
  const { billContent, sources } = buildBillContent(billData)
  console.log(`[personalize] ${bill.type}${bill.number}-${bill.congress}: sources=[${sources.join(', ')}], contentLen=${billContent.length}`)

  const systemPrompt = `You are CapitolKey, a strictly nonpartisan civic education tool that makes U.S. legislation personal and real for high school students.

Your job: show ONE specific student how a federal or state bill touches THEIR life — not abstract policy talk.

═══ ABSOLUTE RULES ═══
1. NEVER evaluate: no "good," "bad," "important," "needed," "harmful." Zero opinion.
2. NEVER tell them what to think, feel, or do about the bill's merits.
3. IMPACT ONLY: concrete, factual changes to THIS student's daily reality.
4. Plain language a 9th grader understands. No jargon, no legalese, no acronyms without explanation.
5. HYPER-PERSONALIZE: reference their state, grade, job, family, interests BY NAME. Generic summaries = failure.
6. STATE CONTEXT MATTERS: if their state already has a relevant law (e.g. California minimum wage is $16.50/hr, higher than federal), SAY SO and explain how the federal bill interacts with it.
7. USE REAL NUMBERS when possible: dollar amounts, percentages, dates, ages affected.
8. If the bill has no meaningful impact on this student, say so directly with relevance ≤ 2.
9. ONLY use facts from the provided bill text and CRS summary. Never invent provisions or details not in the source material. If the bill text was not available, say "based on available information" and keep claims conservative.
10. Include 2-3 civic_actions that are genuinely actionable — with real websites (congress.gov, senate.gov, house.gov) or specific steps.
11. NEVER instruct the student to take personal action (like "delete the app" or "change your password") in headline, summary, if_it_passes, or if_it_fails. Those fields describe WHAT CHANGES, not what the student should do. Save all actionable steps for civic_actions only.

═══ RELEVANCE SCORING ═══
- 9-10: Bill directly changes something in their daily life right now (their paycheck, their school, their healthcare)
- 7-8: Bill affects something they'll encounter within 1-2 years (college costs, job market)
- 5-6: Bill affects their broader community or future (state funding, industry shifts)
- 3-4: Tangential connection through interests or family
- 1-2: No meaningful connection to this student's life

═══ JSON OUTPUT — return ONLY this, no other text ═══
{
  "headline": "Max 12 words. The single most concrete impact on THIS student. Not a bill title rewrite.",
  "summary": "2-3 sentences. What does this bill actually DO? Why should THIS specific student care? Reference their state, job, family, or interests directly. Include a real number or specific detail.",
  "if_it_passes": "1-2 sentences. What SPECIFICALLY changes for THIS student? Be concrete — 'your paycheck goes up $X' not 'wages may increase.'",
  "if_it_fails": "1-2 sentences. What stays the same? Make the status quo concrete too.",
  "relevance": <number 1-10 using the scoring guide above>,
  "topic_tag": "Education" | "Healthcare" | "Economy" | "Environment" | "Technology" | "Housing" | "Civil Rights" | "Other",
  "civic_actions": [
    {
      "action": "Short imperative title (e.g. Call Senator Padilla's office)",
      "how": "One sentence with a specific step: URL, phone number, or exact action. e.g. 'Visit congress.gov/bill/119th-congress/senate-bill/567 to read the full text and track its status.'",
      "time": "Realistic estimate: '5 minutes' / '15 minutes' / '1 hour'"
    }
  ]
}`

  const userPrompt = `STUDENT PROFILE:
- State: ${profile.state}
- Grade: ${profile.grade} (approximately ${gradeToAge(profile.grade)} years old)
- Has a part-time job: ${profile.hasJob ? 'Yes' : 'No'}
- Family situation: ${profile.familySituation || 'Not specified'}
- Top interests: ${(profile.interests || []).join(', ') || 'Not specified'}
- Other context: ${profile.additionalContext || 'None provided'}

BILL:
- Bill: ${bill.type} ${bill.number} (${bill.isStateBill ? `${bill.state} State Legislature` : `${bill.congress}th Congress`})
- Title: ${bill.title}
- Chamber: ${bill.originChamber || 'Congress'}
- Latest Action: ${bill.latestAction}
- Date of Last Action: ${bill.latestActionDate}
${billContent ? `\n${billContent}` : '\nNote: Full bill text was not available. Base your analysis on the bill title and your knowledge, but flag any uncertainty.'}
Analyze how this bill could affect this specific student. Follow the JSON schema exactly.`

  try {
    const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${GROQ_KEY}`
      },
      body: JSON.stringify({
        model: 'openai/gpt-oss-120b',
        max_tokens: 900,
        temperature: 0.6,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    })

    const data = await resp.json()

    if (!data.choices?.[0]?.message?.content) {
      return res.status(500).json({ error: 'No response from Groq', detail: data })
    }

    try {
      let text = data.choices[0].message.content.trim()
      // Strip markdown code fences if the model added them
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(text)
      // Attach source attribution so the frontend can display it
      parsed.sources = sources
      const result = { analysis: parsed }
      const billId = `${bill.type}${bill.number}-${bill.congress}`
      await setSupabaseCache(cacheKey, billId, profile.grade, sortedInterests, result)
      setCache(cacheKey, result)
      res.json(result)
    } catch (parseErr) {
      // JSON parse failed — return error so frontend can show retry
      console.error(`[personalize] JSON parse error for ${bill.type}${bill.number}:`, parseErr.message)
      res.status(502).json({ error: 'Personalization returned invalid format', retryable: true })
    }

  } catch (err) {
    console.error('Groq error:', err)
    res.status(500).json({ error: 'Personalization failed', detail: err.message })
  }
})

// ─── Batch personalization endpoint ─────────────────────────────────────────
// Personalizes multiple bills in a single request, parallelizing all Groq calls.
app.post('/api/personalize-batch', personalizeLimiter, async (req, res) => {
  const { bills, profile } = req.body
  if (!Array.isArray(bills) || !bills.length || !profile) {
    return res.status(400).json({ error: 'bills (array) and profile are required' })
  }
  if (bills.length > 10) {
    return res.status(400).json({ error: 'Maximum 10 bills per batch' })
  }

  const sortedInterests = (profile.interests || []).sort()
  const interestsKey = sortedInterests.join('-')
  const results = {}
  const errors = {}
  const billsToPersonalize = [] // { bill, cacheKey, billType }

  // 1. Batch-check personalization cache (Supabase)
  const cacheKeys = bills.map(b =>
    `v3-personalize-${b.type}${b.number}-${b.congress}-${profile.grade}-${interestsKey}`
  )

  let cachedResults = new Map()
  if (supabase) {
    try {
      const { data } = await supabase
        .from('personalization_cache')
        .select('cache_key, response')
        .in('cache_key', cacheKeys)
      if (data) cachedResults = new Map(data.map(d => [d.cache_key, d.response]))
    } catch {}
  }

  // Also check in-memory cache
  for (let i = 0; i < bills.length; i++) {
    const bill = bills[i]
    const cacheKey = cacheKeys[i]
    const billId = makeBillId(bill)

    const cached = cachedResults.get(cacheKey) || getCache(cacheKey)
    if (cached) {
      results[billId] = cached
    } else {
      billsToPersonalize.push({
        bill,
        cacheKey,
        billId,
        billType: bill.type?.toLowerCase().replace(/\./g, '') || '',
      })
    }
  }

  if (!billsToPersonalize.length) {
    return res.json({ results, errors })
  }

  // 2. Fetch bill texts for uncached bills (check Supabase text cache first)
  const textCacheKeys = billsToPersonalize.map(b =>
    b.bill.legiscan_bill_id ? `bt-ls-${b.bill.legiscan_bill_id}` : `bt-${b.bill.congress}-${b.billType}-${b.bill.number}`
  )
  const textCache = await getBillTextsFromSupabase(textCacheKeys)

  // For any missing from Supabase text cache, fetch from LegiScan in parallel
  const textFetches = billsToPersonalize.map(async (b, i) => {
    const key = textCacheKeys[i]
    const memCached = getCache(key)
    if (memCached) return { ...b, billData: memCached }

    const dbCached = textCache.get(key)
    if (dbCached && (dbCached.bill_text || dbCached.crs_summary)) {
      const billData = {
        text: dbCached.bill_text || null,
        wordCount: dbCached.word_count || 0,
        version: dbCached.version || '',
        crsSummary: dbCached.crs_summary || null,
        crsVersion: dbCached.crs_version || '',
      }
      setCache(key, billData)
      return { ...b, billData }
    }

    // Fetch from LegiScan
    const billData = await fetchBillContent(b.bill.congress, b.billType, b.bill.number, b.bill.legiscan_bill_id)
    return { ...b, billData }
  })

  const billsWithText = await Promise.all(textFetches)

  // 3. Fire ALL Groq personalization calls in parallel
  const groqPromises = billsWithText.map(async ({ bill, cacheKey, billId, billData }) => {
    const { billContent, sources } = buildBillContent(billData)

    const systemPrompt = `You are CapitolKey, a strictly nonpartisan civic education tool that makes U.S. legislation personal and real for high school students.

Your job: show ONE specific student how a federal or state bill touches THEIR life — not abstract policy talk.

═══ ABSOLUTE RULES ═══
1. NEVER evaluate: no "good," "bad," "important," "needed," "harmful." Zero opinion.
2. NEVER tell them what to think, feel, or do about the bill's merits.
3. IMPACT ONLY: concrete, factual changes to THIS student's daily reality.
4. Plain language a 9th grader understands. No jargon, no legalese, no acronyms without explanation.
5. HYPER-PERSONALIZE: reference their state, grade, job, family, interests BY NAME. Generic summaries = failure.
6. STATE CONTEXT MATTERS: if their state already has a relevant law (e.g. California minimum wage is $16.50/hr, higher than federal), SAY SO and explain how the federal bill interacts with it.
7. USE REAL NUMBERS when possible: dollar amounts, percentages, dates, ages affected.
8. If the bill has no meaningful impact on this student, say so directly with relevance ≤ 2.
9. ONLY use facts from the provided bill text and CRS summary. Never invent provisions or details not in the source material. If the bill text was not available, say "based on available information" and keep claims conservative.
10. Include 2-3 civic_actions that are genuinely actionable — with real websites (congress.gov, senate.gov, house.gov) or specific steps.
11. NEVER instruct the student to take personal action (like "delete the app" or "change your password") in headline, summary, if_it_passes, or if_it_fails. Those fields describe WHAT CHANGES, not what the student should do. Save all actionable steps for civic_actions only.

═══ RELEVANCE SCORING ═══
- 9-10: Bill directly changes something in their daily life right now (their paycheck, their school, their healthcare)
- 7-8: Bill affects something they'll encounter within 1-2 years (college costs, job market)
- 5-6: Bill affects their broader community or future (state funding, industry shifts)
- 3-4: Tangential connection through interests or family
- 1-2: No meaningful connection to this student's life

═══ JSON OUTPUT — return ONLY this, no other text ═══
{
  "headline": "Max 12 words. The single most concrete impact on THIS student. Not a bill title rewrite.",
  "summary": "2-3 sentences. What does this bill actually DO? Why should THIS specific student care? Reference their state, job, family, or interests directly. Include a real number or specific detail.",
  "if_it_passes": "1-2 sentences. What SPECIFICALLY changes for THIS student? Be concrete — 'your paycheck goes up $X' not 'wages may increase.'",
  "if_it_fails": "1-2 sentences. What stays the same? Make the status quo concrete too.",
  "relevance": <number 1-10 using the scoring guide above>,
  "topic_tag": "Education" | "Healthcare" | "Economy" | "Environment" | "Technology" | "Housing" | "Civil Rights" | "Other",
  "civic_actions": [
    {
      "action": "Short imperative title (e.g. Call Senator Padilla's office)",
      "how": "One sentence with a specific step: URL, phone number, or exact action. e.g. 'Visit congress.gov/bill/119th-congress/senate-bill/567 to read the full text and track its status.'",
      "time": "Realistic estimate: '5 minutes' / '15 minutes' / '1 hour'"
    }
  ]
}`

    const userPrompt = `STUDENT PROFILE:
- State: ${profile.state}
- Grade: ${profile.grade} (approximately ${gradeToAge(profile.grade)} years old)
- Has a part-time job: ${profile.hasJob ? 'Yes' : 'No'}
- Family situation: ${profile.familySituation || 'Not specified'}
- Top interests: ${(profile.interests || []).join(', ') || 'Not specified'}
- Other context: ${profile.additionalContext || 'None provided'}

BILL:
- Bill: ${bill.type} ${bill.number} (${bill.isStateBill ? `${bill.state} State Legislature` : `${bill.congress}th Congress`})
- Title: ${bill.title}
- Chamber: ${bill.originChamber || 'Congress'}
- Latest Action: ${bill.latestAction}
- Date of Last Action: ${bill.latestActionDate}
${billContent ? `\n${billContent}` : '\nNote: Full bill text was not available. Base your analysis on the bill title and your knowledge, but flag any uncertainty.'}
Analyze how this bill could affect this specific student. Follow the JSON schema exactly.`

    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_KEY}`
        },
        body: JSON.stringify({
          model: 'openai/gpt-oss-120b',
          max_tokens: 900,
          temperature: 0.6,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ]
        })
      })

      const data = await resp.json()
      if (!data.choices?.[0]?.message?.content) {
        throw new Error(data.error?.message || 'No response from Groq')
      }

      let text = data.choices[0].message.content.trim()
      text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
      const parsed = JSON.parse(text)
      parsed.sources = sources
      const result = { analysis: parsed }

      // Cache in both layers
      setCache(cacheKey, result)
      setSupabaseCache(cacheKey, billId, profile.grade, sortedInterests, result)

      return { billId, result }
    } catch (err) {
      console.error(`[batch] Groq error for ${billId}:`, err.message)
      return { billId, error: err.message }
    }
  })

  const settled = await Promise.allSettled(groqPromises)
  for (const s of settled) {
    if (s.status === 'fulfilled' && s.value) {
      if (s.value.error) {
        errors[s.value.billId] = s.value.error
      } else {
        results[s.value.billId] = s.value.result
      }
    } else if (s.status === 'rejected') {
      // Promise itself rejected — find which bill by checking reason
      console.error('[batch] Promise rejected:', s.reason)
    }
  }

  // Ensure every bill appears in either results or errors (no bill left in limbo)
  for (const { billId } of billsToPersonalize) {
    if (!results[billId] && !errors[billId]) {
      errors[billId] = 'Personalization failed unexpectedly'
    }
  }

  console.log(`[personalize-batch] ${Object.keys(results).length} ok, ${Object.keys(errors).length} errors`)
  res.json({ results, errors })
})

// ─── Auth helper ─────────────────────────────────────────────────────────────
async function requireAuth(req) {
  const authHeader = req.headers.authorization
  if (!authHeader || !supabase) throw new Error('Unauthorized')
  const token = authHeader.replace('Bearer ', '')
  const { data: { user }, error } = await supabase.auth.getUser(token)
  if (error || !user) throw new Error('Invalid token')
  return user
}

// ─── Interaction tracking (interest refinement) ─────────────────────────────

app.post('/api/interactions', authLimiter, async (req, res) => {
  try {
    const user = await requireAuth(req)

    // Support single or batch interactions
    const items = req.body.interactions || [req.body]
    const rows = items
      .filter(i => i.bill_id && i.action_type)
      .map(i => ({
        user_id: user.id,
        bill_id: i.bill_id,
        action_type: i.action_type,
        topic_tag: i.topic_tag || null,
      }))

    if (rows.length && supabase) {
      await supabase.from('bill_interactions').insert(rows)
    }

    res.json({ recorded: rows.length })
  } catch (err) {
    if (err.message === 'Unauthorized' || err.message === 'Invalid token') {
      return res.status(401).json({ error: err.message })
    }
    res.status(500).json({ error: 'Failed to record interaction' })
  }
})

app.get('/api/interactions/summary', async (req, res) => {
  try {
    const user = await requireAuth(req)

    if (!supabase) return res.json({ topicCounts: {}, recentTopics: [], totalInteractions: 0 })

    const { data, error } = await supabase
      .from('bill_interactions')
      .select('topic_tag')
      .eq('user_id', user.id)
      .not('topic_tag', 'is', null)

    if (error) return res.json({ topicCounts: {}, recentTopics: [], totalInteractions: 0 })

    const topicCounts = {}
    for (const row of data) {
      topicCounts[row.topic_tag] = (topicCounts[row.topic_tag] || 0) + 1
    }

    const recentTopics = Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([topic]) => topic)

    res.json({ topicCounts, recentTopics, totalInteractions: data.length })
  } catch (err) {
    if (err.message === 'Unauthorized' || err.message === 'Invalid token') {
      return res.status(401).json({ error: err.message })
    }
    res.status(500).json({ error: 'Failed to fetch interaction summary' })
  }
})

// ─── Push notification token management ─────────────────────────────────────

app.post('/api/push/register', async (req, res) => {
  try {
    const user = await requireAuth(req)
    const { token, platform } = req.body

    if (!token || !platform) return res.status(400).json({ error: 'token and platform required' })
    if (!['ios', 'android'].includes(platform)) return res.status(400).json({ error: 'platform must be ios or android' })

    if (supabase) {
      await supabase
        .from('push_tokens')
        .upsert({ user_id: user.id, token, platform }, { onConflict: 'user_id,token' })
    }

    res.json({ registered: true })
  } catch (err) {
    if (err.message === 'Unauthorized' || err.message === 'Invalid token') {
      return res.status(401).json({ error: err.message })
    }
    res.status(500).json({ error: 'Failed to register push token' })
  }
})

app.delete('/api/push/register', async (req, res) => {
  try {
    const user = await requireAuth(req)
    const { token } = req.body

    if (supabase && token) {
      await supabase
        .from('push_tokens')
        .delete()
        .eq('user_id', user.id)
        .eq('token', token)
    }

    res.json({ removed: true })
  } catch (err) {
    if (err.message === 'Unauthorized' || err.message === 'Invalid token') {
      return res.status(401).json({ error: err.message })
    }
    res.status(500).json({ error: 'Failed to remove push token' })
  }
})

// ─── Test push notification (dev only) ───────────────────────────────────────

app.post('/api/push/test', async (req, res) => {
  try {
    const user = await requireAuth(req)

    if (!fcmAuth || !FCM_PROJECT_ID) {
      return res.status(503).json({ error: 'FCM not configured' })
    }

    const { data: tokens } = await supabase
      .from('push_tokens')
      .select('token')
      .eq('user_id', user.id)

    if (!tokens?.length) {
      return res.status(404).json({ error: 'No device tokens found. Open the app and allow notifications first.' })
    }

    const client = await fcmAuth.getClient()
    const { token: accessToken } = await client.getAccessToken()
    let sent = 0

    for (const { token } of tokens) {
      const fcmResp = await fetch(
        `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            message: {
              token,
              notification: {
                title: 'CapitolKey',
                body: 'Test notification — push notifications are working!',
              },
              data: { url: '/bookmarks' },
            },
          }),
        }
      )
      if (fcmResp.ok) sent++
    }

    res.json({ sent, total: tokens.length })
  } catch (err) {
    if (err.message === 'Unauthorized' || err.message === 'Invalid token') {
      return res.status(401).json({ error: err.message })
    }
    console.error('[push/test]', err)
    res.status(500).json({ error: 'Failed to send test notification' })
  }
})

// ─── Notification preferences ────────────────────────────────────────────────

app.get('/api/notifications/preferences', async (req, res) => {
  try {
    const user = await requireAuth(req)

    const { data, error } = await supabase
      .from('user_profiles')
      .select('email_notifications, push_notifications')
      .eq('id', user.id)
      .single()

    if (error || !data) return res.json({ email_notifications: false, push_notifications: true })
    res.json({
      email_notifications: data.email_notifications ?? false,
      push_notifications: data.push_notifications ?? true,
    })
  } catch (err) {
    if (err.message === 'Unauthorized' || err.message === 'Invalid token') {
      return res.status(401).json({ error: err.message })
    }
    res.status(500).json({ error: 'Failed to fetch preferences' })
  }
})

app.post('/api/notifications/preferences', async (req, res) => {
  try {
    const user = await requireAuth(req)

    const update = { id: user.id, updated_at: new Date().toISOString() }
    if (typeof req.body.email_notifications === 'boolean') {
      update.email_notifications = req.body.email_notifications
    }
    if (typeof req.body.push_notifications === 'boolean') {
      update.push_notifications = req.body.push_notifications
    }

    await supabase
      .from('user_profiles')
      .upsert(update, { onConflict: 'id' })

    res.json({
      email_notifications: update.email_notifications,
      push_notifications: update.push_notifications,
    })
  } catch (err) {
    if (err.message === 'Unauthorized' || err.message === 'Invalid token') {
      return res.status(401).json({ error: err.message })
    }
    res.status(500).json({ error: 'Failed to update preferences' })
  }
})

// ─── Bill-update notification cron job ──────────────────────────────────────
// Runs daily at 8:00 AM UTC. Checks each bookmarked bill for status changes
// on Congress.gov and sends grouped email notifications via Resend.

async function checkBillUpdates() {
  if (!supabase) {
    console.log('[cron] Skipping bill check — Supabase not configured')
    return
  }
  if (!resend && !fcmAuth) {
    console.log('[cron] Skipping bill check — neither Resend nor FCM configured')
    return
  }

  console.log('[cron] Starting daily bill-update check...')

  // 1. Fetch all bookmarks with user info
  const { data: bookmarks, error: bmErr } = await supabase
    .from('bookmarks')
    .select('id, user_id, bill_id, bill_data, last_known_action')

  if (bmErr || !bookmarks?.length) {
    console.log('[cron] No bookmarks to check', bmErr?.message || '')
    return
  }

  // 2. Deduplicate bills (many users may bookmark the same bill)
  const uniqueBills = new Map()
  for (const bm of bookmarks) {
    if (!uniqueBills.has(bm.bill_id)) {
      uniqueBills.set(bm.bill_id, bm.bill_data?.bill || {})
    }
  }

  // 3. Fetch current status for each unique bill from LegiScan
  const currentStatuses = new Map()
  for (const [billId, billInfo] of uniqueBills) {
    try {
      const legiscanId = billInfo.legiscan_bill_id
      if (!legiscanId) continue

      const data = await legiscanRequest('getBill', { id: legiscanId })
      const b = data.bill
      currentStatuses.set(billId, {
        latestAction: b.last_action || b.status_desc || '',
        latestActionDate: b.last_action_date || b.status_date || '',
      })

      // Small delay to respect rate limits
      await new Promise(r => setTimeout(r, 200))
    } catch (err) {
      console.error(`[cron] Failed to fetch bill ${billId}:`, err.message)
    }
  }

  // 4. Find bookmarks with changed statuses
  //    Group changes by user_id for batched emails
  const userChanges = new Map() // userId → [{ ...billInfo, oldAction, newAction }]
  const bookmarkUpdates = []    // [{ id, last_known_action }]

  for (const bm of bookmarks) {
    const current = currentStatuses.get(bm.bill_id)
    if (!current) continue

    const oldAction = bm.last_known_action || bm.bill_data?.bill?.latestAction || ''
    const newAction = current.latestAction

    // If no stored action yet, seed it without sending a notification
    if (!bm.last_known_action) {
      bookmarkUpdates.push({ id: bm.id, last_known_action: newAction })
      continue
    }

    if (newAction && newAction !== oldAction) {
      const bill = bm.bill_data?.bill || {}
      const change = {
        type: bill.type || '?',
        number: bill.number || '?',
        congress: bill.congress || '?',
        title: bill.title || 'Unknown bill',
        oldAction,
        newAction,
      }

      if (!userChanges.has(bm.user_id)) userChanges.set(bm.user_id, [])
      userChanges.get(bm.user_id).push(change)

      bookmarkUpdates.push({ id: bm.id, last_known_action: newAction })
    }
  }

  // 5. Update last_known_action for all processed bookmarks
  for (const upd of bookmarkUpdates) {
    await supabase
      .from('bookmarks')
      .update({ last_known_action: upd.last_known_action })
      .eq('id', upd.id)
  }

  // 6. Send emails to users with changes (respecting notification preferences)
  let emailsSent = 0
  if (!resend) console.log('[cron] Email sending skipped — Resend not configured')
  for (const [userId, changes] of resend ? userChanges : []) {
    try {
      // Check if user wants notifications
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('email_notifications')
        .eq('id', userId)
        .single()

      if (profile?.email_notifications === false) continue

      // Get user's email from Supabase Auth
      const { data: { user }, error: userErr } = await supabase.auth.admin.getUserById(userId)
      if (userErr || !user?.email) continue

      const { subject, html } = billUpdateEmail(
        user.user_metadata?.full_name || user.user_metadata?.name || '',
        changes,
      )

      await resend.emails.send({
        from: RESEND_FROM,
        to: user.email,
        subject,
        html,
      })
      emailsSent++
    } catch (err) {
      console.error(`[cron] Failed to email user ${userId}:`, err.message)
    }
  }

  // 7. Send push notifications to users with changes (FCM V1 API)
  let pushSent = 0
  if (fcmAuth) {
    const client = await fcmAuth.getClient()
    const { token: accessToken } = await client.getAccessToken()

    for (const [userId, changes] of userChanges) {
      try {
        const { data: profile } = await supabase
          .from('user_profiles')
          .select('push_notifications')
          .eq('id', userId)
          .single()

        if (profile?.push_notifications === false) continue

        const { data: tokens } = await supabase
          .from('push_tokens')
          .select('token')
          .eq('user_id', userId)

        if (!tokens?.length) continue

        const count = changes.length
        const body = count === 1
          ? `${changes[0].type} ${changes[0].number} has a new status update`
          : `${count} of your saved bills have new status updates`

        for (const { token } of tokens) {
          try {
            const fcmResp = await fetch(
              `https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${accessToken}`,
                },
                body: JSON.stringify({
                  message: {
                    token,
                    notification: { title: 'Bill Update', body },
                    data: { url: '/bookmarks' },
                  },
                }),
              }
            )

            if (fcmResp.ok) {
              pushSent++
            } else {
              const errData = await fcmResp.json().catch(() => ({}))
              // Clean up stale tokens (UNREGISTERED or NOT_FOUND)
              const errCode = errData.error?.details?.[0]?.errorCode || ''
              if (errCode === 'UNREGISTERED' || fcmResp.status === 404) {
                await supabase.from('push_tokens').delete().eq('token', token)
              }
            }
          } catch {
            // individual push failure is non-fatal
          }
        }
      } catch (err) {
        console.error(`[cron] Push failed for user ${userId}:`, err.message)
      }
    }
  }

  console.log(`[cron] Bill check complete. ${bookmarkUpdates.length} bookmarks updated, ${emailsSent} emails sent, ${pushSent} push notifications sent.`)
}

// Schedule: daily at 8:00 AM UTC (needs Supabase; Resend and FCM are optional)
if (supabase) {
  cron.schedule('0 8 * * *', () => {
    checkBillUpdates().catch(err => console.error('[cron] Unhandled error:', err))
  })
  console.log('   Bill-update cron: \u2713 scheduled (daily 8:00 AM UTC)')
} else {
  console.log('   Bill-update cron: \u2717 disabled (no Supabase)')
}

// ─── Bill text & CRS summary fetching ───────────────────────────────────────
// Fetches the full legislative text from Congress.gov and strips HTML to plain text.
// Also fetches CRS (Congressional Research Service) expert summaries when available.
// Caches persistently in Supabase so Congress.gov is only hit once per bill.

const BILL_TEXT_WORD_LIMIT = 4000

function stripHtml(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Supabase bill text cache (persistent) ──
async function getBillTextFromSupabase(cacheKey) {
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('bill_text_cache')
      .select('bill_text, word_count, version, crs_summary, crs_version')
      .eq('cache_key', cacheKey)
      .single()
    if (error || !data) return null
    return data
  } catch { return null }
}

async function setBillTextToSupabase(cacheKey, billText, wordCount, version, crsSummary, crsVersion) {
  if (!supabase) return
  try {
    await supabase
      .from('bill_text_cache')
      .upsert({
        cache_key: cacheKey,
        bill_text: billText || '',
        word_count: wordCount || 0,
        version: version || '',
        crs_summary: crsSummary || '',
        crs_version: crsVersion || '',
      }, { onConflict: 'cache_key' })
  } catch (err) {
    console.error('[bill_text_cache] Write error:', err.message)
  }
}

// Batch-fetch multiple bill texts from Supabase in one query
async function getBillTextsFromSupabase(cacheKeys) {
  if (!supabase || !cacheKeys.length) return new Map()
  try {
    const { data, error } = await supabase
      .from('bill_text_cache')
      .select('cache_key, bill_text, word_count, version, crs_summary, crs_version')
      .in('cache_key', cacheKeys)
    if (error || !data) return new Map()
    return new Map(data.map(d => [d.cache_key, d]))
  } catch { return new Map() }
}

// Fetch bill text from LegiScan using getBill (to get doc_id) then getBillText
async function fetchBillTextFromLegiScan(legiscanBillId) {
  try {
    // First get the bill to find available text documents
    const billData = await legiscanRequest('getBill', { id: legiscanBillId })
    const texts = billData.bill?.texts || []
    if (!texts.length) return null

    // Get the latest text version
    const latest = texts[texts.length - 1]
    if (!latest.doc_id) return null

    const textData = await legiscanRequest('getBillText', { id: latest.doc_id })
    const doc = textData.text?.doc
    const mime = textData.text?.mime || ''

    if (!doc) return null

    // doc is base64-encoded — decode it
    const decoded = Buffer.from(doc, 'base64')
    let plainText = ''

    if (mime.includes('html') || mime.includes('htm')) {
      plainText = stripHtml(decoded.toString('utf-8'))
    } else if (mime.includes('text')) {
      plainText = decoded.toString('utf-8').replace(/\s+/g, ' ').trim()
    } else {
      // PDF or RTF — use the bill description as fallback
      plainText = billData.bill?.description || ''
    }

    if (!plainText) return null

    const wordCount = plainText.split(/\s+/).length
    return { text: plainText, wordCount, version: latest.type || 'Latest version' }
  } catch (err) {
    console.error(`[billtext] LegiScan failed for bill ${legiscanBillId}:`, err.message)
    return null
  }
}

// Fetch bill content, checking caches first, then LegiScan
// Accepts either legiscanBillId (preferred) or congress/type/number (legacy)
async function fetchBillContent(congress, type, number, legiscanBillId) {
  const cacheKey = legiscanBillId ? `bt-ls-${legiscanBillId}` : `bt-${congress}-${type}-${number}`

  // L1: in-memory
  const memCached = getCache(cacheKey)
  if (memCached) return memCached

  // L2: Supabase persistent
  const dbCached = await getBillTextFromSupabase(cacheKey)
  if (dbCached && (dbCached.bill_text || dbCached.crs_summary)) {
    const result = {
      text: dbCached.bill_text || null,
      wordCount: dbCached.word_count || 0,
      version: dbCached.version || '',
      crsSummary: dbCached.crs_summary || null,
      crsVersion: dbCached.crs_version || '',
    }
    setCache(cacheKey, result)
    return result
  }

  // L3: LegiScan API
  let textResult = null
  if (legiscanBillId) {
    textResult = await fetchBillTextFromLegiScan(legiscanBillId)
  } else {
    // Try to find the bill on LegiScan by searching
    try {
      const billNumber = `${type.toUpperCase()}${number}`
      const searchData = await legiscanRequest('search', { state: 'US', query: billNumber, year: '2' })
      const hits = searchData.searchresult ? Object.values(searchData.searchresult).filter(r => r.bill_id) : []
      const match = hits.find(r => r.bill_number === billNumber)
      if (match) {
        textResult = await fetchBillTextFromLegiScan(match.bill_id)
      }
    } catch (err) {
      console.error(`[billtext] LegiScan search fallback failed:`, err.message)
    }
  }

  const result = {
    text: textResult?.text || null,
    wordCount: textResult?.wordCount || 0,
    version: textResult?.version || '',
    crsSummary: null, // LegiScan doesn't have CRS summaries
    crsVersion: '',
  }

  // Persist to Supabase + in-memory
  setCache(cacheKey, result)
  setBillTextToSupabase(cacheKey, result.text, result.wordCount, result.version, result.crsSummary, result.crsVersion)

  return result
}

// Build the content string for the personalization prompt
function buildBillContent(billData) {
  let billContent = ''
  let sources = []

  if (billData.crsSummary) {
    billContent += `CONGRESSIONAL RESEARCH SERVICE SUMMARY:\n${billData.crsSummary}\n\n`
    sources.push('Congressional Research Service summary')
  }

  if (billData.text) {
    if (billData.wordCount <= BILL_TEXT_WORD_LIMIT) {
      billContent += `FULL BILL TEXT (${billData.version}):\n${billData.text}\n`
      sources.push('full bill text via LegiScan')
    } else {
      const truncated = billData.text.split(/\s+/).slice(0, BILL_TEXT_WORD_LIMIT).join(' ')
      billContent += `BILL TEXT (first ${BILL_TEXT_WORD_LIMIT} words of ${billData.wordCount.toLocaleString()}, ${billData.version}):\n${truncated}\n`
      sources.push('bill text via LegiScan')
    }
  }

  if (!billContent) {
    sources.push('bill title and metadata only')
  }

  return { billContent, sources }
}

// Fire-and-forget: pre-fetch bill texts for all returned bills
async function prefetchBillTexts(bills) {
  const fetches = bills.map(b => {
    const type = b.type?.toLowerCase().replace(/\./g, '') || ''
    return fetchBillContent(b.congress, type, b.number, b.legiscan_bill_id).catch(() => null)
  })
  await Promise.allSettled(fetches)
}

// ─── Deduplicate companion bills (Senate/House versions, amended versions) ──
// Bills with very similar titles are likely companion bills or amended versions.
// Keep the one with the most recent action date.
function normalizeTitleForDedup(title) {
  return title
    .toLowerCase()
    .replace(/\b(act of \d{4})\b/g, 'act')     // "Act of 2025" → "act"
    .replace(/\b(a bill|an act|a resolution)\b/g, '')
    .replace(/[^a-z0-9\s]/g, '')                 // strip punctuation
    .replace(/\s+/g, ' ')
    .trim()
}

function titleSimilarity(a, b) {
  const wordsA = new Set(a.split(' ').filter(w => w.length > 2))
  const wordsB = new Set(b.split(' ').filter(w => w.length > 2))
  if (wordsA.size === 0 || wordsB.size === 0) return 0
  let overlap = 0
  for (const w of wordsA) if (wordsB.has(w)) overlap++
  const smaller = Math.min(wordsA.size, wordsB.size)
  return overlap / smaller
}

function deduplicateCompanionBills(bills) {
  const result = []
  const usedIndices = new Set()

  for (let i = 0; i < bills.length; i++) {
    if (usedIndices.has(i)) continue
    const normA = normalizeTitleForDedup(bills[i].title)

    // Check remaining bills for near-duplicate titles
    for (let j = i + 1; j < bills.length; j++) {
      if (usedIndices.has(j)) continue
      // Only compare bills in the same state/scope (both federal or same state)
      if (bills[i].state !== bills[j].state) continue
      const normB = normalizeTitleForDedup(bills[j].title)
      if (titleSimilarity(normA, normB) >= 0.85) {
        usedIndices.add(j) // drop the later (less recent) duplicate
      }
    }
    result.push(bills[i])
  }
  return result
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeBillId(bill) {
  if (bill.legiscan_bill_id) return `ls-${bill.legiscan_bill_id}`
  return `${bill.type}${bill.number}-${bill.congress}`
}

function gradeToAge(grade) {
  const map = { '9': 14, '10': 15, '11': 16, '12': 17 }
  return map[String(grade)] || 16
}

const INTEREST_MAP = {
  education:    ['student loan', 'education funding', 'youth'],
  environment:  ['climate change', 'clean energy', 'environmental protection'],
  economy:      ['minimum wage', 'workforce training', 'student debt'],
  healthcare:   ['mental health', 'student health', 'medicaid'],
  technology:   ['artificial intelligence', 'data privacy', 'broadband'],
  housing:      ['affordable housing', 'rent assistance'],
  immigration:  ['immigration reform', 'DACA', 'student visa'],
  civil_rights: ['voting rights', 'civil rights', 'discrimination'],
  community:    ['national service', 'community grants', 'AmeriCorps'],
}

// ─── Hybrid Interest-Discovery scoring ──────────────────────────────────────

const INTERACTION_PENALTY_WEIGHTS = { view_detail: 0.8, expand_card: 0.4, bookmark: 0.2 }

// Env-configurable scoring weights — tune in production without redeploying
const SCORE_WEIGHTS = {
  interest:   parseFloat(process.env.W_INTEREST)   || 0.35,
  freshness:  parseFloat(process.env.W_FRESHNESS)  || 0.20,
  serendipity:parseFloat(process.env.W_SERENDIPITY)|| 0.15,
  penalty:    parseFloat(process.env.W_PENALTY)    || 0.15,
  popularity: parseFloat(process.env.W_POPULARITY) || 0.15,
}
const FRESHNESS_HALFLIFE = parseFloat(process.env.FRESHNESS_HALFLIFE) || 60 // days

function computeBillScore(bill, { interestTerms, interactionMap, discoveryTermSet, popularBillIds }) {
  // InterestScore (0–1): how well does this bill match the user's interests?
  let interestScore = 0.3 // base/default
  if (interestTerms.has(bill.searchTerm)) interestScore = 1.0
  else if (bill._isEmerging) interestScore = 0.7
  else if (bill._isDiscovery) interestScore = 0.5

  // FreshnessScore (0–1): exponential decay over FRESHNESS_HALFLIFE days
  const daysSinceUpdate = Math.max(0, (Date.now() - new Date(bill.updateDate).getTime()) / 86400000)
  const freshnessScore = Math.exp(-daysSinceUpdate / FRESHNESS_HALFLIFE)

  // InteractionPenalty (0–1): de-rank bills the user already saw
  let interactionPenalty = 0
  const billKey = bill.legiscan_bill_id || `${bill.state}-${bill.type}${bill.number}`
  const interactions = interactionMap.get(billKey)
  if (interactions) {
    for (const { action_type, daysSince } of interactions) {
      const base = INTERACTION_PENALTY_WEIGHTS[action_type] || 0
      const decayed = base * Math.exp(-daysSince / 14) // penalty halves every ~2 weeks
      interactionPenalty = Math.max(interactionPenalty, decayed)
    }
  }

  // SerendipityBonus (0–1): reward bills from discovery terms
  const serendipityBonus = discoveryTermSet.has(bill.searchTerm) ? 0.8 : 0

  // PopularityBoost (0–1): collaborative signal from other students
  const popularityBoost = popularBillIds.has(billKey) ? 0.7 : 0

  const total = (interestScore * SCORE_WEIGHTS.interest)
    + (freshnessScore * SCORE_WEIGHTS.freshness)
    + (serendipityBonus * SCORE_WEIGHTS.serendipity)
    + (popularityBoost * SCORE_WEIGHTS.popularity)
    - (interactionPenalty * SCORE_WEIGHTS.penalty)

  bill._score = total
  return total
}

// Fetch user's last 60 days of interactions for server-side scoring
async function getUserInteractions(userId) {
  if (!supabase || !userId) return { interactionMap: new Map(), topicCounts: {} }

  const cutoff = new Date(Date.now() - 60 * 86400000).toISOString()
  const { data, error } = await supabase
    .from('bill_interactions')
    .select('bill_id, action_type, topic_tag, created_at')
    .eq('user_id', userId)
    .gte('created_at', cutoff)

  if (error || !data) return { interactionMap: new Map(), topicCounts: {} }

  const interactionMap = new Map()
  const topicCounts = {}

  for (const row of data) {
    const daysSince = (Date.now() - new Date(row.created_at).getTime()) / 86400000
    if (!interactionMap.has(row.bill_id)) interactionMap.set(row.bill_id, [])
    interactionMap.get(row.bill_id).push({ action_type: row.action_type, daysSince })
    if (row.topic_tag) topicCounts[row.topic_tag] = (topicCounts[row.topic_tag] || 0) + 1
  }

  return { interactionMap, topicCounts }
}

// Collaborative filtering: find bills popular among all students in the last 30 days
// Returns a Set of bill_ids with high engagement (bookmarks weighted 3×, views 1×)
const _popularBillsCache = { data: null, ts: 0 }
async function getPopularBillIds() {
  // Cache for 1 hour to avoid hammering Supabase
  if (_popularBillsCache.data && Date.now() - _popularBillsCache.ts < 3600000) {
    return _popularBillsCache.data
  }
  if (!supabase) return new Set()

  const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data, error } = await supabase
    .from('bill_interactions')
    .select('bill_id, action_type')
    .gte('created_at', cutoff)

  if (error || !data) return new Set()

  // Weight: bookmark = 3, view_detail = 1, expand_card = 0.5
  const scores = {}
  for (const row of data) {
    const w = row.action_type === 'bookmark' ? 3 : row.action_type === 'view_detail' ? 1 : 0.5
    scores[row.bill_id] = (scores[row.bill_id] || 0) + w
  }

  // Top 20 most popular bills
  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]).slice(0, 20)
  const result = new Set(sorted.map(([id]) => id))
  _popularBillsCache.data = result
  _popularBillsCache.ts = Date.now()
  return result
}

// Optional auth — returns user or null (never throws)
async function getOptionalUser(req) {
  const authHeader = req.headers.authorization
  if (!authHeader || !supabase) return null
  try {
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error } = await supabase.auth.getUser(token)
    return error ? null : user
  } catch { return null }
}

// Pick discovery terms from interest categories the user DOESN'T have
// Falls back to general civic terms if user has all categories
const FALLBACK_DISCOVERY = ['bipartisan', 'appropriations', 'federal budget']

function pickDiscoveryTerms(userInterests = []) {
  const allKeys = Object.keys(INTEREST_MAP)
  const unused = allKeys.filter(k => !userInterests.includes(k))

  if (unused.length === 0) {
    // User has every interest — use fallback civic terms
    return FALLBACK_DISCOVERY
  }

  // Shuffle unused interests, pick 2-3, grab one search term from each
  const shuffled = [...unused]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }

  const terms = []
  const count = Math.min(2, shuffled.length)
  for (let i = 0; i < count; i++) {
    const mapped = INTEREST_MAP[shuffled[i]]
    // Pick a random term from this interest category
    terms.push(mapped[Math.floor(Math.random() * mapped.length)])
  }
  return terms
}

// Reverse mapping: topic tag → interest key
const TAG_TO_INTEREST = {
  'Education': 'education',
  'Environment': 'environment',
  'Economy': 'economy',
  'Healthcare': 'healthcare',
  'Technology': 'technology',
  'Housing': 'housing',
  'Civil Rights': 'civil_rights',
  'Other': null,
}

function buildSearchTerms(interests = []) {
  const base = ['student loan', 'education funding', 'youth']

  // Only use base terms when user has no selected interests
  const terms = interests.length === 0 ? [...base] : []
  for (const interest of interests) {
    if (INTEREST_MAP[interest]) terms.push(...INTEREST_MAP[interest])
  }

  const unique = [...new Set(terms)]
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]]
  }

  return unique.slice(0, 5)
}

function buildWeightedSearchTerms(interests = [], topicCounts = {}) {
  const base = ['student loan', 'education funding', 'youth']
  // Only use base terms when user has no selected interests
  const terms = interests.length === 0 ? [...base] : []

  // Map topic tags to interest keys with interaction counts
  const interestCounts = {}
  for (const [tag, count] of Object.entries(topicCounts)) {
    const key = TAG_TO_INTEREST[tag]
    if (key) interestCounts[key] = (interestCounts[key] || 0) + count
  }

  // High-engagement interests (>5 interactions): include all terms
  // Medium (1-5): include 1-2 terms
  // Zero but in profile: include 1 discovery term
  for (const interest of interests) {
    const mapped = INTEREST_MAP[interest]
    if (!mapped) continue

    const count = interestCounts[interest] || 0
    if (count > 5) {
      terms.push(...mapped) // all terms
    } else if (count >= 1) {
      terms.push(...mapped.slice(0, 2)) // 1-2 terms
    } else {
      terms.push(mapped[0]) // 1 discovery term
    }
  }

  // Also boost topics the user engages with that aren't in their profile
  for (const [interest, count] of Object.entries(interestCounts)) {
    if (!interests.includes(interest) && count > 3 && INTEREST_MAP[interest]) {
      terms.push(INTEREST_MAP[interest][0])
    }
  }

  const unique = [...new Set(terms)]
  // Light shuffle to add variety without destroying relevance order
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]]
  }

  return unique.slice(0, 7)
}

// ─── Auto-create bill_text_cache table if missing ──────────────────────────
async function ensureBillTextCache() {
  if (!supabase) return
  try {
    const { error } = await supabase.from('bill_text_cache').select('cache_key').limit(1)
    if (error && error.message.includes('does not exist')) {
      console.log('[startup] Creating bill_text_cache table...')
      // Use Supabase's rpc to run DDL — requires a helper function or manual creation
      // Fallback: the table must be created via Supabase SQL Editor
      console.log('[startup] ⚠ bill_text_cache table missing — run supabase/create_bill_text_cache.sql in the SQL Editor')
      console.log('[startup]   Bill text will still work (cached in-memory only until table is created)')
    } else {
      console.log('   Bill text cache: ✓ table exists')
    }
  } catch {
    console.log('   Bill text cache: ✗ check failed (in-memory fallback)')
  }
}

const PORT = process.env.PORT || 3001
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`✅ CapitolKey server running on http://0.0.0.0:${PORT}`)
  console.log(`   LegiScan key: ${process.env.LEGISCAN_API_KEY ? '✓ loaded' : '✗ MISSING'}`)
  console.log(`   Groq key: ${process.env.GROQ_API_KEY ? '✓ loaded' : '✗ MISSING'}`)
  console.log(`   Supabase cache: ${supabase ? '✓ connected' : '✗ disabled (in-memory fallback)'}`)
  console.log(`   Resend email: ${resend ? '✓ configured' : '✗ disabled'}`)
  console.log(`   FCM push: ${fcmAuth ? '✓ configured (V1 API)' : '✗ disabled'}`)
  await ensureBillTextCache()
})
