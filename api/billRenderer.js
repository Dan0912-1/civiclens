// Dynamic rendering for crawlers and social unfurlers.
//
// The app is a client-rendered SPA, so a bot fetching /bill/119/hr/2847 gets an
// empty shell: no per-bill <title>, no description, and the generic homepage OG
// card. Search snippets are weak and every shared link unfurls as the homepage.
// This module serves bots an equivalent, server-rendered HTML page with real
// per-bill meta tags, JSON-LD, and the bill's official summary.
//
// Humans never reach this: a Vercel rewrite (see vercel.json) routes only bot
// user-agents to /render/bill/*, so the human hot path stays the untouched
// static SPA. Serving crawlers content equivalent to the public bill view is
// "dynamic rendering," which Google supports; it is not cloaking because the
// text matches what a logged-out visitor sees.
//
// Two bill families are served:
//   • Federal: /render/bill/:congress/:type/:number, keyed by congress_bill_id
//     ("119-hr-2847").
//   • State:   /render/states/:state/:session/:type/:number, resolved from the
//     bills table by jurisdiction+type+number (+ session slug). The description
//     names the state, e.g. "California Assembly Bill 1234, 2025-2026 session...".
// Unknown bills fall back to a valid generic page so a bot always gets clean meta
// instead of an empty shell.

import { SITE_URL } from './seoConfig.js'
import {
  resolveStateBillRow, slugifySession, stateName, stateBillTypeLabel, sessionPhrase,
} from './stateBills.js'

const RENDER_TTL = 1000 * 60 * 60 * 6 // 6h — bill metadata changes slowly

const BILL_TYPE_LABELS = {
  hr: 'H.R.', s: 'S.',
  hjres: 'H.J.Res.', sjres: 'S.J.Res.',
  hconres: 'H.Con.Res.', sconres: 'S.Con.Res.',
  hres: 'H.Res.', sres: 'S.Res.',
}

const STAGE_LABELS = {
  introduced: 'Introduced',
  in_committee: 'In committee',
  passed_one: 'Passed one chamber',
  passed_both: 'Passed both chambers',
  enacted: 'Signed into law',
  vetoed: 'Vetoed',
}

function htmlEscape(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Collapse whitespace and truncate on a word boundary with an ellipsis.
function clamp(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'
}

function billLabel(type, number) {
  const t = BILL_TYPE_LABELS[String(type).toLowerCase()] || String(type).toUpperCase()
  return `${t} ${number}`
}

function congressOrdinal(congress) {
  const n = parseInt(congress, 10)
  if (!Number.isInteger(n) || n <= 0) return ''
  const mod100 = n % 100
  const suffix = mod100 >= 11 && mod100 <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'
  return `${n}${suffix} Congress`
}

// Build the bot-facing HTML for one bill. `bill` may be null (unknown bill).
function renderBillHtml({ congress, type, number, bill }) {
  const lcType = String(type).toLowerCase()
  const canonical = `${SITE_URL}/bill/${congress}/${lcType}/${number}`
  const label = billLabel(type, number)
  const ordinal = congressOrdinal(congress)
  const rawTitle = (bill?.title || '').trim()

  const titleText = rawTitle
    ? `${label}: ${clamp(rawTitle, 70)}`
    : `${label}${ordinal ? ` (${ordinal})` : ''}`
  const pageTitle = `${titleText} | CapitolKey`

  const summary = (bill?.crs_summary || bill?.description || '').trim()
  const stageLabel = STAGE_LABELS[bill?.status_stage] || ''
  const metaDesc = summary
    ? clamp(summary, 155)
    : `${label}${ordinal ? `, ${ordinal},` : ''} explained in plain language: what it does, where it stands, and how it could affect you. Nonpartisan and free to read.`

  const ogImage = `${SITE_URL}/og/bill/${congress}/${lcType}/${number}`

  const legislation = {
    '@type': 'Legislation',
    name: rawTitle || label,
    legislationIdentifier: label,
    legislationType: 'Bill',
    legislationJurisdiction: 'United States',
    url: canonical,
  }
  if (bill?.latest_action_date) legislation.legislationDate = String(bill.latest_action_date).slice(0, 10)
  if (summary) legislation.description = clamp(summary, 300)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      legislation,
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'CapitolKey', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Bills', item: `${SITE_URL}/search` },
          { '@type': 'ListItem', position: 3, name: label, item: canonical },
        ],
      },
    ],
  }

  const body = []
  body.push(`<h1>${htmlEscape(rawTitle ? `${label}: ${rawTitle}` : label)}</h1>`)
  if (ordinal) body.push(`<p><strong>${htmlEscape(ordinal)}</strong></p>`)
  if (stageLabel) body.push(`<p>Status: ${htmlEscape(stageLabel)}</p>`)
  if (summary) body.push(`<h2>What it does</h2>\n<p>${htmlEscape(clamp(summary, 1200))}</p>`)
  if (bill?.latest_action) {
    const when = bill.latest_action_date ? ` (${htmlEscape(String(bill.latest_action_date).slice(0, 10))})` : ''
    body.push(`<h2>Latest action</h2>\n<p>${htmlEscape(clamp(bill.latest_action, 300))}${when}</p>`)
  }
  body.push(`<p><a href="${canonical}">See how ${htmlEscape(label)} affects you on CapitolKey</a></p>`)
  body.push(`<p><a href="${SITE_URL}/search">Browse more bills</a> &middot; <a href="${SITE_URL}/">CapitolKey home</a></p>`)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${htmlEscape(pageTitle)}</title>
<meta name="description" content="${htmlEscape(metaDesc)}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="CapitolKey" />
<meta property="og:title" content="${htmlEscape(titleText)}" />
<meta property="og:description" content="${htmlEscape(metaDesc)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${ogImage}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${htmlEscape(titleText)}" />
<meta name="twitter:description" content="${htmlEscape(metaDesc)}" />
<meta name="twitter:image" content="${ogImage}" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
${body.join('\n')}
</body>
</html>
`
}

async function lookupFederalBill(supabase, congress, type, number) {
  if (!supabase) return null
  const congressBillId = `${congress}-${String(type).toLowerCase()}-${number}`
  const { data, error } = await supabase
    .from('bills')
    .select('title, description, crs_summary, status_stage, latest_action, latest_action_date')
    .eq('congress_bill_id', congressBillId)
    .maybeSingle()
  if (error) {
    console.error('[render] bill lookup error:', error.message)
    return null
  }
  return data || null
}

// Build the bot-facing HTML for one state bill. `row` may be null (unknown bill).
// Mirrors renderBillHtml but keys off jurisdiction/session and names the state in
// the title + description (e.g. "California Assembly Bill 1234, 2025-2026 session").
function renderStateBillHtml({ state, session, type, number, row }) {
  const code = String(row?.jurisdiction || state || '').toUpperCase()
  const lcState = code.toLowerCase()
  const lcType = String(row?.bill_type || type || '').toLowerCase()
  const num = row?.bill_number ?? number
  const sessionSlug = slugifySession(row?.session || session)
  const canonical = `${SITE_URL}/states/${lcState}/${sessionSlug}/${lcType}/${num}`

  const stName = stateName(code)                       // "California"
  const typeLabel = stateBillTypeLabel(lcType)         // "Assembly Bill"
  const shortLabel = `${lcType.toUpperCase()} ${num}`  // "AB 1234"
  const longLabel = `${stName} ${typeLabel} ${num}`    // "California Assembly Bill 1234"
  const sessionTxt = sessionPhrase(row?.session || session) // "2025-2026 session"

  const rawTitle = (row?.title || '').trim()
  const titleText = rawTitle ? `${longLabel}: ${clamp(rawTitle, 60)}` : longLabel
  const pageTitle = `${titleText} | CapitolKey`

  const summary = (row?.crs_summary || row?.description || '').trim()
  const stageLabel = STAGE_LABELS[row?.status_stage] || ''
  const metaDesc = summary
    ? clamp(summary, 155)
    : `${longLabel}${sessionTxt ? `, ${sessionTxt},` : ''} explained in plain language: what it does, where it stands, and how it could affect you. Nonpartisan and free to read.`

  const ogImage = `${SITE_URL}/og-image.png`

  const legislation = {
    '@type': 'Legislation',
    name: rawTitle || longLabel,
    legislationIdentifier: shortLabel,
    legislationType: 'Bill',
    legislationJurisdiction: stName,
    url: canonical,
  }
  if (row?.latest_action_date) legislation.legislationDate = String(row.latest_action_date).slice(0, 10)
  if (summary) legislation.description = clamp(summary, 300)

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      legislation,
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'CapitolKey', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Bills', item: `${SITE_URL}/search` },
          { '@type': 'ListItem', position: 3, name: longLabel, item: canonical },
        ],
      },
    ],
  }

  const body = []
  body.push(`<h1>${htmlEscape(rawTitle ? `${longLabel}: ${rawTitle}` : longLabel)}</h1>`)
  const subline = [stName, sessionTxt].filter(Boolean).join(' · ')
  if (subline) body.push(`<p><strong>${htmlEscape(subline)}</strong></p>`)
  if (stageLabel) body.push(`<p>Status: ${htmlEscape(stageLabel)}</p>`)
  if (summary) body.push(`<h2>What it does</h2>\n<p>${htmlEscape(clamp(summary, 1200))}</p>`)
  if (row?.latest_action) {
    const when = row.latest_action_date ? ` (${htmlEscape(String(row.latest_action_date).slice(0, 10))})` : ''
    body.push(`<h2>Latest action</h2>\n<p>${htmlEscape(clamp(row.latest_action, 300))}${when}</p>`)
  }
  body.push(`<p><a href="${canonical}">See how ${htmlEscape(shortLabel)} affects you on CapitolKey</a></p>`)
  body.push(`<p><a href="${SITE_URL}/search">Browse more bills</a> &middot; <a href="${SITE_URL}/">CapitolKey home</a></p>`)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${htmlEscape(pageTitle)}</title>
<meta name="description" content="${htmlEscape(metaDesc)}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="article" />
<meta property="og:site_name" content="CapitolKey" />
<meta property="og:title" content="${htmlEscape(titleText)}" />
<meta property="og:description" content="${htmlEscape(metaDesc)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${ogImage}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${htmlEscape(titleText)}" />
<meta name="twitter:description" content="${htmlEscape(metaDesc)}" />
<meta name="twitter:image" content="${ogImage}" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
${body.join('\n')}
</body>
</html>
`
}

// Registers GET /render/bill/:congress/:type/:number. Dependencies injected so
// this stays decoupled from server.js internals.
export function registerBillRenderRoutes(app, { supabase, getCache, setCache }) {
  if (!app) return

  app.get('/render/bill/:congress/:type/:number', async (req, res) => {
    const { congress, type, number } = req.params
    res.set('Content-Type', 'text/html; charset=utf-8')

    // Shape guard: never query Supabase on garbage params.
    if (!/^\d+$/.test(congress) || !/^[a-z]+$/i.test(type) || !/^\d+$/.test(number)) {
      return res.status(404).send(renderBillHtml({ congress, type, number, bill: null }))
    }

    const cacheKey = `render-bill-${congress}-${type.toLowerCase()}-${number}`
    try {
      let html = getCache(cacheKey)
      if (!html) {
        const bill = await lookupFederalBill(supabase, congress, type, number)
        html = renderBillHtml({ congress, type, number, bill })
        setCache(cacheKey, html, RENDER_TTL)
      }
      res.set('Cache-Control', 'public, max-age=3600, s-maxage=21600')
      res.send(html)
    } catch (e) {
      console.error('[render] error:', e.message)
      // Always return valid meta rather than an error to a crawler.
      res.status(200).send(renderBillHtml({ congress, type, number, bill: null }))
    }
  })

  app.get('/render/states/:state/:session/:type/:number', async (req, res) => {
    const { state, session, type, number } = req.params
    res.set('Content-Type', 'text/html; charset=utf-8')

    // Shape guard: never query Supabase on garbage params.
    if (!/^[a-z]{2}$/i.test(state) || !/^[a-z]+$/i.test(type) || !/^\d+$/.test(number)) {
      return res.status(404).send(renderStateBillHtml({ state, session, type, number, row: null }))
    }

    const cacheKey = `render-state-${state.toLowerCase()}-${slugifySession(session)}-${type.toLowerCase()}-${number}`
    try {
      let html = getCache(cacheKey)
      if (!html) {
        const row = await resolveStateBillRow(supabase, { state, type, number, sessionSlug: session })
        html = renderStateBillHtml({ state, session, type, number, row })
        setCache(cacheKey, html, RENDER_TTL)
      }
      res.set('Cache-Control', 'public, max-age=3600, s-maxage=21600')
      res.send(html)
    } catch (e) {
      console.error('[render-state] error:', e.message)
      // Always return valid meta rather than an error to a crawler.
      res.status(200).send(renderStateBillHtml({ state, session, type, number, row: null }))
    }
  })
}
