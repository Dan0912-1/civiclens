// Per-bill Open Graph share-card images.
//
// A bot fetching /bill/119/hr/1 gets server-rendered meta (see billRenderer.js)
// whose og:image / twitter:image point here. This module renders a branded
// 1200x630 PNG per bill so a shared link unfurls as a designed card instead of
// the generic site image. The bill title is looked up by congress_bill_id;
// unknown or malformed bills fall back to a generic branded card so a crawler
// never gets an error.
//
// Rendering is headless and browser-free: build an SVG string, rasterize with
// @resvg/resvg-js (prebuilt binaries on Railway's Linux Node). resvg reads raw
// TTF/OTF only, so the design-system fonts are bundled as TTFs under
// assets/fonts and loaded explicitly; system fonts are ignored so text renders
// identically everywhere.

import { Resvg } from '@resvg/resvg-js'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { SITE_URL } from './seoConfig.js'

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), 'assets', 'fonts')
const DOMAIN = SITE_URL.replace(/^https?:\/\//, '') // "capitolkey.org" for the footer wordmark

// Resolve the bundled TTFs to absolute paths once at init. resvg loads them via
// fontFiles (path) rather than fontBuffers: in testing, in-memory buffers
// silently dropped some faces (text fell back to a default sans), while
// path-loaded fonts parse reliably. Existence-filtered so a missing asset only
// degrades card text instead of crashing server boot — this module is imported
// at the top of server.js.
const FONT_FILES = ['PlayfairDisplay-Bold.ttf', 'SourceSans3-Regular.ttf', 'SourceSans3-SemiBold.ttf', 'IBMPlexMono-Medium.ttf']
  .map((f) => join(FONT_DIR, f))
  .filter((p) => { if (existsSync(p)) return true; console.error('[og] font missing:', p); return false })

const OG_TTL = 1000 * 60 * 60 * 24 // 24h — bill metadata changes slowly

// Design-system palette — the live "Institutional High-Trust" tokens from
// src/index.css (Oxford Blue / Brass / Parchment), not the stale doc values.
const NAVY = '#0A1929'      // Oxford Blue — primary ink / card background
const NAVY_TOP = '#1E2A38'  // Federal Slate — subtle top of the background gradient
const AMBER = '#A47E3B'     // Brass — restrained accent
const CREAM = '#F5F2EC'     // Parchment — primary text

const OG_TYPE_LABELS = {
  hr: 'H.R.', s: 'S.',
  hjres: 'H.J.Res.', sjres: 'S.J.Res.',
  hconres: 'H.Con.Res.', sconres: 'S.Con.Res.',
  hres: 'H.Res.', sres: 'S.Res.',
}

const OG_STAGE_LABELS = {
  introduced: 'Introduced',
  in_committee: 'In committee',
  passed_one: 'Passed one chamber',
  passed_both: 'Passed both chambers',
  enacted: 'Signed into law',
  vetoed: 'Vetoed',
}

function escapeXml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function formatBillLabel(type, number) {
  const t = OG_TYPE_LABELS[String(type).toLowerCase()] || String(type).toUpperCase()
  return `${t} ${number}`
}

function formatCongress(congress) {
  const n = parseInt(congress, 10)
  if (!Number.isInteger(n) || n <= 0) return ''
  const mod100 = n % 100
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'
  return `${n}${suffix} Congress`
}

// Estimated rendered width of a string at a font size, using an average glyph
// advance ratio. resvg exposes no text-measurement API, so wrapping is
// estimate-driven; ratios are tuned a touch wide so lines never overflow.
function estWidth(s, fontSize, ratio) {
  return s.length * fontSize * ratio
}

function truncateToWidth(s, fontSize, maxWidth, ratio) {
  if (estWidth(s, fontSize, ratio) <= maxWidth) return s
  let t = s
  while (t.length && estWidth(t + '…', fontSize, ratio) > maxWidth) t = t.slice(0, -1)
  return t.replace(/\s+\S*$/, '').trim() + '…'
}

// Greedy word-wrap into at most maxLines lines; the final line is truncated with
// an ellipsis if the title still overflows.
function wrapTitle(text, fontSize, maxWidth, maxLines, ratio) {
  const words = String(text).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  const lines = []
  let cur = ''
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w
    if (!cur || estWidth(trial, fontSize, ratio) <= maxWidth) {
      cur = trial
    } else {
      lines.push(cur)
      cur = w
    }
  }
  if (cur) lines.push(cur)
  if (lines.length <= maxLines) return lines
  const head = lines.slice(0, maxLines - 1)
  head.push(truncateToWidth(lines.slice(maxLines - 1).join(' '), fontSize, maxWidth, ratio))
  return head
}

// Build the 1200x630 SVG. `bill` may be null. `validShape` is false for
// malformed params (no identifier eyebrow then).
function buildCardSvg({ congress, type, number, bill, validShape }) {
  const W = 1200
  const H = 630
  const PAD = 80
  const maxWidth = W - PAD * 2

  const rawTitle = (bill?.title || '').trim()
  const headline = rawTitle || 'U.S. legislation, explained for students'
  // Smaller type for longer titles so 1-3 lines always fit the card.
  const fontSize = headline.length <= 52 ? 64 : headline.length <= 104 ? 56 : 50
  const lineHeight = Math.round(fontSize * 1.16)
  const lines = wrapTitle(headline, fontSize, maxWidth, 3, rawTitle ? 0.52 : 0.5)

  const eyebrow = validShape
    ? `${formatBillLabel(type, number)}  ·  ${formatCongress(congress)}`.toUpperCase()
    : ''
  const stageLabel = OG_STAGE_LABELS[bill?.status_stage] || ''

  const titleTop = 296
  const titleSvg = lines
    .map((ln, i) => `<text x="${PAD}" y="${titleTop + i * lineHeight}" font-family="Playfair Display" font-weight="700" font-size="${fontSize}" fill="${CREAM}">${escapeXml(ln)}</text>`)
    .join('\n  ')

  const lastTitleY = titleTop + (lines.length - 1) * lineHeight
  const statusY = lastTitleY + 74
  const statusSvg = stageLabel
    ? `<circle cx="${PAD + 9}" cy="${statusY - 11}" r="9" fill="${AMBER}"/>
  <text x="${PAD + 32}" y="${statusY}" font-family="Source Sans 3 SemiBold" font-size="33" fill="${CREAM}" fill-opacity="0.92">${escapeXml(stageLabel)}</text>`
    : ''

  const eyebrowSvg = eyebrow
    ? `<text x="${PAD}" y="208" font-family="IBM Plex Mono" font-weight="500" font-size="29" letter-spacing="2.5" fill="${AMBER}">${escapeXml(eyebrow)}</text>`
    : ''

  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NAVY_TOP}"/>
      <stop offset="1" stop-color="${NAVY}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.82" cy="0.08" r="0.7">
      <stop offset="0" stop-color="${AMBER}" stop-opacity="0.16"/>
      <stop offset="1" stop-color="${AMBER}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <rect x="0" y="0" width="${W}" height="10" fill="${AMBER}"/>

  <rect x="${PAD}" y="64" width="48" height="48" rx="11" fill="${AMBER}"/>
  <text x="${PAD + 24}" y="100" text-anchor="middle" font-family="Playfair Display" font-weight="700" font-size="34" fill="${NAVY}">K</text>
  <text x="${PAD + 64}" y="101" font-family="Playfair Display" font-weight="700" font-size="36" fill="${CREAM}">Capitol<tspan fill="${AMBER}">Key</tspan></text>

  ${eyebrowSvg}
  ${titleSvg}
  ${statusSvg}

  <rect x="${PAD}" y="556" width="${maxWidth}" height="2" fill="${AMBER}" fill-opacity="0.55"/>
  <text x="${PAD}" y="598" font-family="Source Sans 3 SemiBold" font-size="26" fill="${CREAM}" fill-opacity="0.85">${escapeXml(DOMAIN)}</text>
  <text x="${W - PAD}" y="598" text-anchor="end" font-family="Source Sans 3" font-weight="400" font-size="25" fill="${CREAM}" fill-opacity="0.6">Nonpartisan civic education</text>
</svg>`
}

// Rasterize the card to a PNG Buffer. resvg reads the bundled font files; aside
// from that it is self-contained, so it is safe to call from the route handler
// and from tests.
export function renderBillCardPng(opts) {
  const svg = buildCardSvg(opts)
  const resvg = new Resvg(svg, {
    font: { loadSystemFonts: false, fontFiles: FONT_FILES, defaultFontFamily: 'Source Sans 3' },
  })
  return Buffer.from(resvg.render().asPng())
}

async function lookupBillForCard(supabase, congress, type, number) {
  if (!supabase) return null
  const congressBillId = `${congress}-${String(type).toLowerCase()}-${number}`
  const { data, error } = await supabase
    .from('bills')
    .select('title, status_stage')
    .eq('congress_bill_id', congressBillId)
    .maybeSingle()
  if (error) {
    console.error('[og] bill lookup error:', error.message)
    return null
  }
  return data || null
}

// Registers GET /og/bill/:congress/:type/:number. Dependencies injected to stay
// decoupled from server.js internals, mirroring registerBillRenderRoutes.
export function registerBillOgImageRoutes(app, { supabase, getCache, setCache }) {
  if (!app) return

  app.get('/og/bill/:congress/:type/:number', async (req, res) => {
    const { congress, type, number } = req.params
    res.set('Content-Type', 'image/png')

    const validShape = /^\d+$/.test(congress) && /^[a-z]+$/i.test(type) && /^\d+$/.test(number)
    const lcType = String(type).toLowerCase()
    const cacheKey = `og-bill-${congress}-${lcType}-${number}`

    try {
      let png = getCache(cacheKey)
      if (!png) {
        const bill = validShape ? await lookupBillForCard(supabase, congress, lcType, number) : null
        png = renderBillCardPng({ congress, type: lcType, number, bill, validShape })
        setCache(cacheKey, png, OG_TTL)
      }
      res.set('Cache-Control', 'public, max-age=86400, s-maxage=86400, immutable')
      res.send(png)
    } catch (e) {
      console.error('[og] render error:', e.message)
      // Never error to a crawler — fall back to a generic branded card.
      try {
        res.set('Cache-Control', 'public, max-age=600')
        res.send(renderBillCardPng({ congress, type: lcType, number, bill: null, validShape: false }))
      } catch (e2) {
        res.status(500).end()
      }
    }
  })
}
