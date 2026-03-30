// api/server.js — CivicLens Backend
// All API keys live here, never in the frontend

import express from 'express'
import cors from 'cors'
import { createClient } from '@supabase/supabase-js'
import cron from 'node-cron'
import { Resend } from 'resend'
import { billUpdateEmail } from './emailTemplates.js'

const app = express()

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allows the Vercel web frontend, the Capacitor iOS/Android app (capacitor://
// and https://localhost), and local dev. Add origins via FRONTEND_URL on Railway.
const EXTRA_ORIGIN = process.env.FRONTEND_URL

const ALLOWED_ORIGINS = new Set([
  'capacitor://localhost',              // iOS Capacitor app
  'https://localhost',                  // Android Capacitor app
  'http://localhost:5173',              // Vite dev server
  'http://localhost:4173',              // Vite preview
  'https://civiclens-six.vercel.app',  // Vercel deployment
  ...(EXTRA_ORIGIN ? [EXTRA_ORIGIN] : []),
])

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman, server-to-server)
    if (!origin || ALLOWED_ORIGINS.has(origin)) return callback(null, true)
    callback(new Error(`CORS: origin ${origin} not allowed`))
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type'],
}))

app.use(express.json())

const CONGRESS_KEY = process.env.CONGRESS_API_KEY
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY
const CONGRESS_BASE = 'https://api.congress.gov/v3'
const RESEND_KEY = process.env.RESEND_API_KEY
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'GovDecoded <onboarding@resend.dev>'
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
  res.json({ status: 'ok', service: 'CivicLens API', timestamp: new Date().toISOString() })
})

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// ─── Fetch bills from Congress.gov ───────────────────────────────────────────
// Searches recent bills filtered by student-relevant topics
app.post('/api/legislation', async (req, res) => {
  const { interests = [], grade, state } = req.body

  const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
  const cacheKey = `bills-${interests.sort().join('-')}-${grade}-${today}`
  const cached = getCache(cacheKey)
  if (cached) return res.json(cached)

  try {
    // Build search terms from student interests
    const searchTerms = buildSearchTerms(interests)
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

// ─── Anthropic personalization endpoint ──────────────────────────────────────
app.post('/api/personalize', async (req, res) => {
  const { bill, profile } = req.body

  const sortedInterests = (profile.interests || []).sort()
  const cacheKey = `personalize-${bill.type}${bill.number}-${bill.congress}-${profile.grade}-${sortedInterests.join('-')}`

  // Check Supabase persistent cache first, fall back to in-memory
  const cached = await getSupabaseCache(cacheKey) || getCache(cacheKey)
  if (cached) return res.json(cached)

  const systemPrompt = `You are CivicLens, a strictly nonpartisan civic education tool built for American high school students.

Your only job is to explain how a real piece of legislation could affect a specific student's daily life.

ABSOLUTE RULES — never break these:
1. Never say a bill is good, bad, right, wrong, or use any evaluative language about its merits.
2. Never tell the student what to think or how to feel about the bill.
3. Explain IMPACT only — concrete, factual changes to their life if it passes or fails.
4. Use plain language a 9th grader can understand. No jargon.
5. Be specific to their actual profile (grade, state, job, interests).
6. If the bill has no meaningful impact on this student, say so directly.
7. Never invent facts or speculate beyond what the bill title and action suggest.

Always return a valid JSON object with exactly these fields — no other text, no markdown:
{
  "headline": "One plain sentence (max 12 words) on the single most relevant impact to this student",
  "summary": "2-3 sentences explaining concretely what this bill does and why it matters to someone with this student's profile. Mention their specific situation.",
  "if_it_passes": "1-2 sentences: what specifically changes for this student if it becomes law.",
  "if_it_fails": "1-2 sentences: what stays the same for this student if it doesn't pass.",
  "relevance": number from 1 to 10 representing how relevant this bill is to this specific student,
  "topic_tag": one of: "Education" | "Healthcare" | "Economy" | "Environment" | "Technology" | "Housing" | "Civil Rights" | "Other",
  "civic_actions": [
    {
      "action": "Short title of the action (e.g. Contact your Senator)",
      "how": "One concrete sentence: exactly what to do and where to go.",
      "time": "e.g. 5 minutes"
    }
  ]
}

Return ONLY the JSON. No preamble, no explanation, no markdown fences.`

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
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 900,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }]
      })
    })

    const data = await resp.json()

    if (!data.content?.[0]?.text) {
      return res.status(500).json({ error: 'No response from Claude', detail: data })
    }

    try {
      let text = data.content[0].text.trim()
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
      res.json({ analysis: null, raw: data.content[0].text })
    }

  } catch (err) {
    console.error('Anthropic error:', err)
    res.status(500).json({ error: 'Personalization failed', detail: err.message })
  }
})

// ─── Notification preferences ────────────────────────────────────────────────

app.get('/api/notifications/preferences', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !supabase) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' })

    const { data, error } = await supabase
      .from('user_profiles')
      .select('email_notifications')
      .eq('id', user.id)
      .single()

    if (error || !data) return res.json({ email_notifications: true }) // default on
    res.json({ email_notifications: data.email_notifications ?? true })
  } catch {
    res.status(500).json({ error: 'Failed to fetch preferences' })
  }
})

app.post('/api/notifications/preferences', async (req, res) => {
  const authHeader = req.headers.authorization
  if (!authHeader || !supabase) return res.status(401).json({ error: 'Unauthorized' })

  try {
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token)
    if (authErr || !user) return res.status(401).json({ error: 'Invalid token' })

    const { email_notifications } = req.body
    if (typeof email_notifications !== 'boolean') {
      return res.status(400).json({ error: 'email_notifications must be a boolean' })
    }

    await supabase
      .from('user_profiles')
      .upsert({
        id: user.id,
        email_notifications,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })

    res.json({ email_notifications })
  } catch {
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
  if (!resend) {
    console.log('[cron] Skipping bill check — Resend not configured')
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
  for (const [userId, changes] of userChanges) {
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

  console.log(`[cron] Bill check complete. ${bookmarkUpdates.length} bookmarks updated, ${emailsSent} emails sent.`)
}

// Schedule: daily at 8:00 AM UTC
if (supabase && resend) {
  cron.schedule('0 8 * * *', () => {
    checkBillUpdates().catch(err => console.error('[cron] Unhandled error:', err))
  })
  console.log('   Bill-update cron: \u2713 scheduled (daily 8:00 AM UTC)')
} else {
  console.log(`   Bill-update cron: \u2717 disabled (${!supabase ? 'no Supabase' : 'no Resend key'})`)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function gradeToAge(grade) {
  const map = { '9': 14, '10': 15, '11': 16, '12': 17 }
  return map[String(grade)] || 16
}

function buildSearchTerms(interests = []) {
  // Always search for student/youth bills
  const base = ['student loan', 'education funding', 'youth']

  const interestMap = {
    environment:  ['climate change', 'clean energy', 'environmental protection'],
    economy:      ['minimum wage', 'workforce training', 'student debt'],
    healthcare:   ['mental health', 'student health', 'medicaid'],
    technology:   ['artificial intelligence', 'data privacy', 'broadband'],
    housing:      ['affordable housing', 'rent assistance'],
    immigration:  ['DACA', 'student visa', 'immigration'],
    civil_rights: ['voting rights', 'civil rights', 'discrimination'],
    community:    ['national service', 'community grants', 'AmeriCorps'],
  }

  const terms = [...base]
  for (const interest of interests) {
    if (interestMap[interest]) terms.push(...interestMap[interest])
  }

  // Shuffle so repeated sessions with same interests surface different bills
  const unique = [...new Set(terms)]
  for (let i = unique.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [unique[i], unique[j]] = [unique[j], unique[i]]
  }

  return unique.slice(0, 5)
}

const PORT = process.env.PORT || 3001
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ CivicLens server running on http://0.0.0.0:${PORT}`)
  console.log(`   Congress key: ${process.env.CONGRESS_API_KEY ? '✓ loaded' : '✗ MISSING'}`)
  console.log(`   Anthropic key: ${process.env.ANTHROPIC_API_KEY ? '✓ loaded' : '✗ MISSING'}`)
  console.log(`   Supabase cache: ${supabase ? '✓ connected' : '✗ disabled (in-memory fallback)'}`)
  console.log(`   Resend email: ${resend ? '✓ configured' : '✗ disabled'}`)
})
