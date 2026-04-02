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
  crossOriginEmbedderPolicy: false, // allow loading Congress.gov resources
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
// Protects expensive endpoints from abuse (AI personalization, Congress.gov proxy)
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

const CONGRESS_KEY = process.env.CONGRESS_API_KEY
const GROQ_KEY = process.env.GROQ_API_KEY
const CONGRESS_BASE = 'https://api.congress.gov/v3'
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
  if (body.bill && (!body.bill.type || !body.bill.number || !body.bill.congress)) {
    errors.push('bill must include type, number, and congress')
  }
  return errors
}

// ─── Fetch bills from Congress.gov ───────────────────────────────────────────
// Searches recent bills filtered by student-relevant topics
app.post('/api/legislation', legislationLimiter, async (req, res) => {
  const valErrors = validateLegislationBody(req.body)
  if (valErrors.length) return res.status(400).json({ error: valErrors.join(', ') })

  const { interests = [], grade, state, interactionSummary } = req.body

  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const summaryHash = interactionSummary ? Object.keys(interactionSummary.topicCounts || {}).sort().join(',') : ''
  const cacheKey = `bills-${interests.sort().join('-')}-${grade}-${today}-${summaryHash}`
  const cached = getCache(cacheKey)
  if (cached) return res.json(cached)

  try {
    // Build search terms, weighted by interaction history if available
    const searchTerms = interactionSummary
      ? buildWeightedSearchTerms(interests, interactionSummary)
      : buildSearchTerms(interests)
    const allBills = []

    // Fetch bills for each relevant search term (limit to 5 for more variety)
    for (const term of searchTerms.slice(0, 5)) {
      const url = `${CONGRESS_BASE}/bill?query=${encodeURIComponent(term)}&sort=updateDate+desc&limit=8&api_key=${CONGRESS_KEY}`
      const resp = await fetch(url)

      if (!resp.ok) {
        console.error(`Congress API error: ${resp.status} for term "${term}"`)
        continue
      }

      const data = await resp.json()
      if (data.bills) {
        allBills.push(...data.bills.map(b => ({
          congress: b.congress,
          type: b.type,
          number: b.number,
          title: b.title,
          originChamber: b.originChamber,
          latestAction: b.latestAction?.text || 'No recent action',
          latestActionDate: b.latestAction?.actionDate || '',
          url: b.url,
          updateDate: b.updateDate,
          searchTerm: term,
        })))
      }
    }

    // Deduplicate by bill number
    const seen = new Set()
    const unique = allBills.filter(b => {
      const id = `${b.type}${b.number}-${b.congress}`
      if (seen.has(id)) return false
      seen.add(id)
      return true
    })

    // Take top 8 most recently updated
    unique.sort((a, b) => new Date(b.updateDate) - new Date(a.updateDate))
    const result = { bills: unique.slice(0, 8) }

    setCache(cacheKey, result)
    res.json(result)

  } catch (err) {
    console.error('Legislation fetch error:', err)
    res.status(500).json({ error: 'Failed to fetch legislation', detail: err.message })
  }
})

// ─── Get single bill detail ───────────────────────────────────────────────────
app.get('/api/bill/:congress/:type/:number', async (req, res) => {
  const { congress, type, number } = req.params
  const cacheKey = `bill-${congress}-${type}-${number}`
  const cached = getCache(cacheKey)
  if (cached) return res.json(cached)

  try {
    const url = `${CONGRESS_BASE}/bill/${congress}/${type.toLowerCase()}/${number}?api_key=${CONGRESS_KEY}`
    const resp = await fetch(url)
    const data = await resp.json()

    setCache(cacheKey, data)
    res.json(data)
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch bill detail' })
  }
})

// ─── Personalization endpoint (Groq GPT-OSS 120B) ──────────────────────────
app.post('/api/personalize', personalizeLimiter, async (req, res) => {
  const valErrors = validatePersonalizeBody(req.body)
  if (valErrors.length) return res.status(400).json({ error: valErrors.join(', ') })

  const { bill, profile } = req.body

  const sortedInterests = (profile.interests || []).sort()
  const cacheKey = `personalize-${bill.type}${bill.number}-${bill.congress}-${profile.grade}-${sortedInterests.join('-')}`

  // Check Supabase persistent cache first, fall back to in-memory
  const cached = await getSupabaseCache(cacheKey) || getCache(cacheKey)
  if (cached) return res.json(cached)

  const systemPrompt = `You are CapitolKey, a strictly nonpartisan civic education tool that makes U.S. legislation personal and real for high school students.

Your job: show ONE specific student how a bill touches THEIR life — not abstract policy talk.

═══ ABSOLUTE RULES ═══
1. NEVER evaluate: no "good," "bad," "important," "needed," "harmful." Zero opinion.
2. NEVER tell them what to think, feel, or do about the bill's merits.
3. IMPACT ONLY: concrete, factual changes to THIS student's daily reality.
4. Plain language a 9th grader understands. No jargon, no legalese, no acronyms without explanation.
5. HYPER-PERSONALIZE: reference their state, grade, job, family, interests BY NAME. Generic summaries = failure.
6. STATE CONTEXT MATTERS: if their state already has a relevant law (e.g. California minimum wage is $16.50/hr, higher than federal), SAY SO and explain how the federal bill interacts with it.
7. USE REAL NUMBERS when possible: dollar amounts, percentages, dates, ages affected.
8. If the bill has no meaningful impact on this student, say so directly with relevance ≤ 2.
9. Never invent facts. If you're unsure, say "based on the bill title" or "details pending."
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
- Bill: ${bill.type} ${bill.number} (${bill.congress}th Congress)
- Title: ${bill.title}
- Chamber: ${bill.originChamber || 'Congress'}
- Latest Action: ${bill.latestAction}
- Date of Last Action: ${bill.latestActionDate}

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
      const result = { analysis: parsed }
      const billId = `${bill.type}${bill.number}-${bill.congress}`
      await setSupabaseCache(cacheKey, billId, profile.grade, sortedInterests, result)
      setCache(cacheKey, result)
      res.json(result)
    } catch {
      // JSON parse failed — return raw for debugging
      res.json({ analysis: null, raw: data.choices[0].message.content })
    }

  } catch (err) {
    console.error('Groq error:', err)
    res.status(500).json({ error: 'Personalization failed', detail: err.message })
  }
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

  // 3. Fetch current status for each unique bill from Congress.gov
  const currentStatuses = new Map()
  for (const [billId, billInfo] of uniqueBills) {
    try {
      const { congress, type, number } = billInfo
      if (!congress || !type || !number) continue

      const url = `${CONGRESS_BASE}/bill/${congress}/${type.toLowerCase()}/${number}?api_key=${CONGRESS_KEY}`
      const resp = await fetch(url)
      if (!resp.ok) continue

      const data = await resp.json()
      const latestAction = data.bill?.latestAction?.text || ''
      currentStatuses.set(billId, {
        latestAction,
        latestActionDate: data.bill?.latestAction?.actionDate || '',
      })

      // Rate-limit: Congress.gov asks for max ~1 req/sec
      await new Promise(r => setTimeout(r, 1100))
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

// ─── Helpers ──────────────────────────────────────────────────────────────────
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
  immigration:  ['DACA', 'student visa', 'immigration'],
  civil_rights: ['voting rights', 'civil rights', 'discrimination'],
  community:    ['national service', 'community grants', 'AmeriCorps'],
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

  const terms = [...base]
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

function buildWeightedSearchTerms(interests = [], interactionSummary = {}) {
  const { topicCounts = {} } = interactionSummary
  const base = ['student loan', 'education funding', 'youth']
  const terms = [...base]

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
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]]
  }

  return unique.slice(0, 7) // increased from 5 for more variety
}

const PORT = process.env.PORT || 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ CapitolKey server running on http://0.0.0.0:${PORT}`)
  console.log(`   Congress key: ${process.env.CONGRESS_API_KEY ? '✓ loaded' : '✗ MISSING'}`)
  console.log(`   Anthropic key: ${process.env.ANTHROPIC_API_KEY ? '✓ loaded' : '✗ MISSING'}`)
  console.log(`   Supabase cache: ${supabase ? '✓ connected' : '✗ disabled (in-memory fallback)'}`)
  console.log(`   Resend email: ${resend ? '✓ configured' : '✗ disabled'}`)
  console.log(`   FCM push: ${fcmAuth ? '✓ configured (V1 API)' : '✗ disabled'}`)
})
