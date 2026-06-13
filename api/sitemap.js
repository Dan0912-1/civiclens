// Dynamic XML sitemaps so search engines discover every federal bill page.
//
// The app is a client-rendered SPA, so without these a crawler only ever learns
// about the ~8 static routes hardcoded in the old public/sitemap.xml. Googlebot
// executes JavaScript, so once a bill URL is listed here it gets crawled and its
// client-rendered summary indexed. That turns our ~15k-page federal catalog into
// a compounding organic-acquisition surface instead of an invisible one.
//
// State bills are intentionally excluded for now: their detail route needs a
// ?legiscan_id query param to resolve, so a bare /bill/0/<type>/<number> would
// soft-404 and hurt us. Federal bills resolve from the path alone, so they are
// safe to emit. (A cleaner state-bill URL contract is a follow-up.)

const SITE_URL = 'https://capitolkey.org'
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

async function countFederalBills(supabase) {
  const { count, error } = await supabase
    .from('bills')
    .select('congress_bill_id', { count: 'exact', head: true })
    .eq('jurisdiction', 'US')
    .not('congress_bill_id', 'is', null)
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
    const { data, error } = await supabase
      .from('bills')
      .select('congress_bill_id, latest_action_date, synced_at')
      .eq('jurisdiction', 'US')
      .not('congress_bill_id', 'is', null)
      .order('congress_bill_id', { ascending: true })
      .range(from, to)
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
        if (supabase) {
          try { billCount = await countFederalBills(supabase) }
          catch (e) { console.error('[sitemap] count error:', e.message) }
        }
        const pages = billCount > 0 ? Math.ceil(billCount / BILLS_PER_SITEMAP) : 0
        const now = new Date().toISOString()
        let body = `<?xml version="1.0" encoding="UTF-8"?>\n`
        body += `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
        body += `  <sitemap>\n    <loc>${SITE_URL}/sitemaps/static.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>\n`
        for (let i = 1; i <= pages; i++) {
          body += `  <sitemap>\n    <loc>${SITE_URL}/sitemaps/bills-${i}.xml</loc>\n    <lastmod>${now}</lastmod>\n  </sitemap>\n`
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

  // ── Sub-sitemaps: static.xml and bills-<n>.xml ──
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

    const m = /^bills-(\d+)\.xml$/.exec(file)
    if (!m) return res.status(404).type('text/plain').send('not found')
    const page = parseInt(m[1], 10)
    if (!Number.isInteger(page) || page < 1) {
      return res.status(404).type('text/plain').send('not found')
    }

    try {
      const cacheKey = `sitemap-bills-${page}`
      let xml = getCache(cacheKey)
      if (!xml) {
        if (!supabase) return res.status(503).type('text/plain').send('storage unavailable')
        const offset = (page - 1) * BILLS_PER_SITEMAP
        const rows = await fetchFederalBillChunk(supabase, offset, BILLS_PER_SITEMAP)
        let body = `<?xml version="1.0" encoding="UTF-8"?>\n`
        body += `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
        for (const row of rows) {
          const path = federalBillPath(row.congress_bill_id)
          if (!path) continue
          body += urlTag(`${SITE_URL}${path}`, lastmodFor(row), 'weekly', '0.6')
        }
        body += `</urlset>\n`
        xml = body
        setCache(cacheKey, xml, SITEMAP_TTL)
      }
      sendXml(res, xml)
    } catch (e) {
      console.error(`[sitemap] bills page ${page} error:`, e.message)
      res.status(500).type('text/plain').send('sitemap error')
    }
  })
}
