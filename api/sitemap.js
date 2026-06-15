// Dynamic XML sitemaps so search engines discover every federal bill page.
//
// The app is a client-rendered SPA, so without these a crawler only ever learns
// about the ~8 static routes hardcoded in the old public/sitemap.xml. Googlebot
// executes JavaScript, so once a bill URL is listed here it gets crawled and its
// client-rendered summary indexed. That turns our ~15k-page federal catalog into
// a compounding organic-acquisition surface instead of an invisible one.
//
// State bills are now included too. They used to be excluded because their
// detail route needed a ?legiscan_id query param to resolve, so a bare URL would
// soft-404. That blocker is fixed: state bills have a clean, path-resolvable URL
// (/states/:state/:session/:type/:number — see api/stateBills.js) backed by a
// table lookup, so they are safe to emit. This roughly multiplies the indexable
// surface (federal ~13k, state ~215k). NH is excluded (it blocks scraping).

import { SITE_URL } from './seoConfig.js'
import { TOPIC_SLUGS } from './topics.js'
import { stateBillPath, EXCLUDED_SITEMAP_JURISDICTIONS } from './stateBills.js'

const BILLS_PER_SITEMAP = 10000          // well under the 50k-URL / 50MB per-file cap
const DB_PAGE = 1000                     // Supabase returns ~1k rows/request; page through
const SITEMAP_TTL = 1000 * 60 * 60 * 6   // 6h — the bill catalog changes slowly

// Public, crawlable routes that render without auth. Mirrors the routes a logged
// -out visitor (and therefore a crawler) can actually reach and get content on.
const STATIC_ROUTES = [
  { path: '/',          changefreq: 'daily',   priority: '1.0' },
  { path: '/search',    changefreq: 'weekly',  priority: '0.8' },
  { path: '/classroom', changefreq: 'monthly', priority: '0.9' },
  { path: '/about',     changefreq: 'monthly', priority: '0.7' },
  { path: '/contact',   changefreq: 'monthly', priority: '0.6' },
  { path: '/privacy',   changefreq: 'yearly',  priority: '0.3' },
  { path: '/terms',     changefreq: 'yearly',  priority: '0.3' },
]

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// "119-s-4242" -> "/bill/119/s/4242". Returns null for anything unparseable so
// a malformed congress_bill_id never lands a broken URL in the sitemap.
function federalBillPath(congressBillId) {
  if (!congressBillId) return null
  const m = /^(\d+)-([a-z]+)-(\d+)$/i.exec(String(congressBillId).trim())
  if (!m) return null
  const [, congress, type, number] = m
  return `/bill/${congress}/${type.toLowerCase()}/${number}`
}

function urlTag(loc, lastmod, changefreq, priority) {
  let s = `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n`
  if (lastmod)    s += `    <lastmod>${lastmod}</lastmod>\n`
  if (changefreq) s += `    <changefreq>${changefreq}</changefreq>\n`
  if (priority)   s += `    <priority>${priority}</priority>\n`
  s += `  </url>\n`
  return s
}

function sendXml(res, body) {
  res.set('Content-Type', 'application/xml; charset=utf-8')
  // Let Vercel's edge cache the proxied response so crawler bursts don't each
  // hit Railway + Supabase. max-age for browsers, s-maxage for the CDN.
  res.set('Cache-Control', 'public, max-age=3600, s-maxage=21600')
  res.send(body)
}

// Federal sitemap pool: US bills with a parseable congress id, gated to the
// curated feed_eligible "hot pool" (ranker-promoted, full_text present — see
// billRanker.js). Advertising only these keeps the sitemap to bills that render
// as real content and that Google will actually index, instead of every thin
// stub that just lands in "Crawled, currently not indexed". Count and chunk MUST
// share this filter or offset pagination drifts.
function federalBillsFilter(query) {
  return query
    .eq('jurisdiction', 'US')
    .not('congress_bill_id', 'is', null)
    .eq('feed_eligible', true)
}

async function countFederalBills(supabase) {
  const { count, error } = await federalBillsFilter(
    supabase.from('bills').select('congress_bill_id', { count: 'exact', head: true })
  )
  if (error) throw error
  return count || 0
}

// Pull one sitemap chunk's worth of federal bills, paging the DB in 1k batches
// so we never depend on PostgREST returning a 10k range in a single response.
async function fetchFederalBillChunk(supabase, offset, limit) {
  const rows = []
  while (rows.length < limit) {
    const from = offset + rows.length
    const to = from + Math.min(DB_PAGE, limit - rows.length) - 1
    const { data, error } = await federalBillsFilter(
      supabase.from('bills').select('congress_bill_id, latest_action_date, synced_at')
    ).order('congress_bill_id', { ascending: true }).range(from, to)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < (to - from + 1)) break // ran out of rows
  }
  return rows
}

// State-bill sitemap pool: non-federal jurisdictions we don't exclude, gated to
// the curated feed_eligible "hot pool" (ranker-promoted, full_text present — see
// billRanker.js). This drops ~215k thin stubs that would only land in "Crawled,
// currently not indexed" and dilute crawl budget, leaving the ~13k state bills
// that render as real content. As the ranker promotes bills heating up during a
// session, they enter the sitemap automatically and cool ones drop out, so the
// advertised surface tracks quality instead of raw catalog size. Count and chunk
// MUST apply the identical filter or offset pagination drifts. Returns the
// chained query so callers add their own count/order/range.
function stateBillsFilter(query) {
  let q = query.neq('jurisdiction', 'US').not('title', 'is', null).eq('feed_eligible', true)
  for (const j of EXCLUDED_SITEMAP_JURISDICTIONS) q = q.neq('jurisdiction', j)
  return q
}

async function countStateBills(supabase) {
  const { count, error } = await stateBillsFilter(
    supabase.from('bills').select('id', { count: 'exact', head: true })
  )
  if (error) throw error
  return count || 0
}

// Page the DB in 1k batches, ordered by the stable PK so offsets are consistent
// across requests within a cache window.
async function fetchStateBillChunk(supabase, offset, limit) {
  const rows = []
  while (rows.length < limit) {
    const from = offset + rows.length
    const to = from + Math.min(DB_PAGE, limit - rows.length) - 1
    const { data, error } = await stateBillsFilter(
      supabase.from('bills').select('jurisdiction, session, bill_type, bill_number, latest_action_date, synced_at')
    ).order('id', { ascending: true }).range(from, to)
    if (error) throw error
    if (!data || data.length === 0) break
    rows.push(...data)
    if (data.length < (to - from + 1)) break // ran out of rows
  }
  return rows
}

function lastmodFor(row) {
  if (row.latest_action_date) return String(row.latest_action_date).slice(0, 10)
  if (row.synced_at) return String(row.synced_at).slice(0, 10)
  return null
}

// Registers GET /sitemap.xml (the index) and GET /sitemaps/:file (static.xml +
// bills-<n>.xml chunks). Dependencies are injected so this stays decoupled from
// server.js internals.
export function registerSitemapRoutes(app, { supabase, getCache, setCache }) {
  if (!app) return

  // ── Sitemap index: static sitemap + one bill sitemap per BILLS_PER_SITEMAP ──
  app.get('/sitemap.xml', async (req, res) => {
    try {
      let xml = getCache('sitemap-index')
      if (!xml) {
        let billCount = 0
        let stateBillCount = 0
        if (supabase) {
          try { billCount = await countFederalBills(supabase) }
          catch (e) { console.error('[sitemap] federal count error:', e.message) }
          try { stateBillCount = await countStateBills(supabase) }
          catch (e) { console.error('[sitemap] state count error:', e.message) }
        }
        const pages = billCount > 0 ? Math.ceil(billCount / BILLS_PER_SITEMAP) : 0
        const statePages = stateBillCount > 0 ? Math.ceil(stateBillCount / BILLS_PER_SITEMAP) : 0
        const now = new Date().toISOString()
        let body = `<?xml version="1.0" encoding="UTF-8"?>\n`
        body += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
        body += `  <sitemap>\n    <loc>${SITE_URL}/sitemaps/static.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>\n`
        body += `  <sitemap>\n    <loc>${SITE_URL}/sitemaps/topics.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>\n`
        for (let i = 1; i <= pages; i++) {
          body += `  <sitemap>\n    <loc>${SITE_URL}/sitemaps/bills-${i}.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>\n`
        }
        for (let i = 1; i <= statePages; i++) {
          body += `  <sitemap>\n    <loc>${SITE_URL}/sitemaps/state-${i}.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>\n`
        }
        body += `</sitemapindex>\n`
        xml = body
        setCache('sitemap-index', xml, SITEMAP_TTL)
      }
      sendXml(res, xml)
    } catch (e) {
      console.error('[sitemap] index error:', e.message)
      res.status(500).type('text/plain').send('sitemap error')
    }
  })

  // ── Sub-sitemaps: static.xml, bills-<n>.xml (federal), state-<n>.xml (state) ──
  app.get('/sitemaps/:file', async (req, res) => {
    const file = req.params.file

    if (file === 'static.xml') {
      let body = `<?xml version="1.0" encoding="UTF-8"?>\n`
      body += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
      for (const r of STATIC_ROUTES) {
        body += urlTag(`${SITE_URL}${r.path}`, null, r.changefreq, r.priority)
      }
      body += `</urlset>\n`
      return sendXml(res, body)
    }

    if (file === 'topics.xml') {
      let body = `<?xml version="1.0" encoding="UTF-8"?>\n`
      body += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
      // The topics index hub first, then one URL per topic landing page.
      body += urlTag(`${SITE_URL}/topics`, null, 'weekly', '0.8')
      for (const slug of TOPIC_SLUGS) {
        body += urlTag(`${SITE_URL}/topics/${slug}`, null, 'daily', '0.7')
      }
      body += `</urlset>\n`
      return sendXml(res, body)
    }

    // Federal (bills-<n>) and state (state-<n>) chunks share one code path; they
    // differ only in which rows they pull and how each row maps to a path.
    const federalMatch = /^bills-(\d+)\.xml$/.exec(file)
    const stateMatch = /^state-(\d+)\.xml$/.exec(file)
    if (!federalMatch && !stateMatch) {
      return res.status(404).type('text/plain').send('not found')
    }
    const isState = Boolean(stateMatch)
    const page = parseInt((federalMatch || stateMatch)[1], 10)
    if (!Number.isInteger(page) || page < 1) {
      return res.status(404).type('text/plain').send('not found')
    }

    try {
      const cacheKey = isState ? `sitemap-state-${page}` : `sitemap-bills-${page}`
      let xml = getCache(cacheKey)
      if (!xml) {
        if (!supabase) return res.status(503).type('text/plain').send('storage unavailable')
        const offset = (page - 1) * BILLS_PER_SITEMAP
        const rows = isState
          ? await fetchStateBillChunk(supabase, offset, BILLS_PER_SITEMAP)
          : await fetchFederalBillChunk(supabase, offset, BILLS_PER_SITEMAP)
        let body = `<?xml version="1.0" encoding="UTF-8"?>\n`
        body += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
        for (const row of rows) {
          const path = isState ? stateBillPath(row) : federalBillPath(row.congress_bill_id)
          if (!path) continue
          body += urlTag(`${SITE_URL}${path}`, lastmodFor(row), 'weekly', '0.6')
        }
        body += `</urlset>\n`
        xml = body
        setCache(cacheKey, xml, SITEMAP_TTL)
      }
      sendXml(res, xml)
    } catch (e) {
      console.error(`[sitemap] ${isState ? 'state' : 'bills'} page ${page} error:`, e.message)
      res.status(500).type('text/plain').send('sitemap error')
    }
  })
}
