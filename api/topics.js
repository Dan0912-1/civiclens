// Programmatic topic landing pages — the SEO search targets.
//
// Each topic is a public, crawlable hub at /topics/:slug that explains a policy
// area in plain language and lists the most relevant current federal bills,
// each linking to its /bill/... detail page. These pages are the organic
// acquisition surface for high-intent queries ("student loan bills",
// "climate bills") that the per-bill pages alone don't rank for.
//
// This module owns the whole topic feature so server.js stays minimal:
//   - GET /api/topics            → list of topics (for the index hub)
//   - GET /api/topics/:slug      → { topic, bills } JSON the SPA cold-loads
//   - GET /render/topic/:slug    → bot-only server-rendered HTML (meta + JSON-LD
//                                  + bill list), mirroring billRenderer.js so
//                                  crawlers and unfurlers get real content, not
//                                  an empty SPA shell. A Vercel rewrite routes
//                                  bot user-agents for /topics/* here.
//
// Bills are filtered to FEDERAL (jurisdiction='US', congress_bill_id present)
// for the same reason sitemap.js excludes state bills: a bare /bill/:c/:t/:n
// resolves from the path alone only for federal bills, so every link we emit is
// crawlable and never soft-404s. feed_eligible=true restricts to the curated
// "hot pool" (substantive bills with full text), so a topic page never lists
// post-office-naming resolutions.

import { SITE_URL } from './seoConfig.js'

const TOPIC_BILL_LIMIT = 24                 // bills shown per topic page
const TOPIC_RENDER_TTL = 1000 * 60 * 60 * 6 // 6h — bill catalog changes slowly
const TOPIC_API_TTL = 1000 * 60 * 60        // 1h for the JSON the SPA fetches

// Topic taxonomy. Core slugs map 1:1 to the interest taxonomy used everywhere
// else (VALID_INTERESTS in server.js / APP_TOPICS in billRanker.js / the
// bills.topics array). High-intent aliases (student-loans, gun-policy, climate,
// mental-health, taxes) target searches students actually type; they map to the
// nearest canonical tag(s) and use `keywords` to surface the most on-topic bills
// first. `tags` values MUST be lowercase snake_case to match bills.topics.
//
// Copy rule: nonpartisan, plain-language, impact-focused, no em dashes, and we
// never name an upstream data provider — our own database is the source.
const TOPICS = {
  education: {
    title: 'Education Bills',
    navLabel: 'Education',
    tags: ['education'],
    keywords: [],
    intro: 'Education law shapes what schools can offer, how they are funded, and what college costs. These bills cover public schools, tuition, student aid, and the rules that decide who gets into a classroom. Here is what is moving in Congress right now, explained in plain language.',
    metaDescription: 'Current education bills in Congress, explained in plain language: school funding, college costs, and student aid.',
  },
  environment: {
    title: 'Environment Bills',
    navLabel: 'Environment',
    tags: ['environment'],
    keywords: [],
    intro: 'Environmental law decides how clean your air and water are, how public land is used, and how the country prepares for a changing climate. These bills affect the neighborhoods you live in and the world you will inherit. Here is what is moving in Congress right now, explained in plain language.',
    metaDescription: 'Current environment bills in Congress, explained in plain language: clean air and water, public land, and climate.',
  },
  economy: {
    title: 'Economy Bills',
    navLabel: 'Economy',
    tags: ['economy'],
    keywords: [],
    intro: 'Economic policy reaches your paycheck, the prices you pay, and which jobs are open. These bills cover wages, taxes, prices, and how the government spends money. Here is what is moving in Congress right now, explained in plain language.',
    metaDescription: 'Current economy bills in Congress, explained in plain language: wages, taxes, prices, and jobs.',
  },
  healthcare: {
    title: 'Healthcare Bills',
    navLabel: 'Healthcare',
    tags: ['healthcare'],
    keywords: [],
    intro: 'Health policy decides what care you can get, what it costs, and who is covered. These bills touch doctor visits, mental health, prescriptions, and insurance. Here is what is moving in Congress right now, explained in plain language.',
    metaDescription: 'Current healthcare bills in Congress, explained in plain language: coverage, costs, mental health, and prescriptions.',
  },
  technology: {
    title: 'Technology Bills',
    navLabel: 'Technology',
    tags: ['technology'],
    keywords: [],
    intro: 'Technology law sets the rules for the apps you use, the data companies collect about you, and how online tools are kept safe. These bills cover privacy, social media, artificial intelligence, and online safety. Here is what is moving in Congress right now, explained in plain language.',
    metaDescription: 'Current technology bills in Congress, explained in plain language: privacy, social media, AI, and online safety.',
  },
  housing: {
    title: 'Housing Bills',
    navLabel: 'Housing',
    tags: ['housing'],
    keywords: [],
    intro: 'Housing policy affects rent, home prices, and whether families can afford a place to live. These bills cover affordability, renters, construction, and homelessness. Here is what is moving in Congress right now, explained in plain language.',
    metaDescription: 'Current housing bills in Congress, explained in plain language: rent, affordability, renters, and homelessness.',
  },
  immigration: {
    title: 'Immigration Bills',
    navLabel: 'Immigration',
    tags: ['immigration'],
    keywords: [],
    intro: 'Immigration law decides who can live, work, and study in the United States, and under what rules. These bills affect students, families, and workers across the country. Here is what is moving in Congress right now, explained in plain language.',
    metaDescription: 'Current immigration bills in Congress, explained in plain language: who can live, work, and study in the US.',
  },
  'civil-rights': {
    title: 'Civil Rights Bills',
    navLabel: 'Civil Rights',
    tags: ['civil_rights'],
    keywords: [],
    intro: 'Civil rights law protects how people are treated under the law, including voting, free speech, and equal access. These bills shape rights you rely on every day. Here is what is moving in Congress right now, explained in plain language.',
    metaDescription: 'Current civil rights bills in Congress, explained in plain language: voting, free speech, and equal access.',
  },
  community: {
    title: 'Community Bills',
    navLabel: 'Community',
    tags: ['community'],
    keywords: [],
    intro: 'Community policy covers public safety, local services, and the programs that keep neighborhoods running. These bills affect daily life where you live. Here is what is moving in Congress right now, explained in plain language.',
    metaDescription: 'Current community bills in Congress, explained in plain language: public safety, local services, and neighborhood programs.',
  },

  // ── High-intent aliases ──
  'student-loans': {
    title: 'Student Loan Bills',
    navLabel: 'Student Loans',
    tags: ['education', 'economy'],
    keywords: ['student loan', 'tuition', 'financial aid', 'pell', 'college cost', 'loan forgiveness', 'fafsa', 'borrower'],
    intro: 'Student loan policy decides how much college costs up front, how much you repay later, and what help is available. These bills cover loans, grants, interest rates, and forgiveness. Here is what is moving in Congress right now, explained in plain language.',
    metaDescription: 'Current student loan bills in Congress, explained in plain language: loans, grants, interest rates, and forgiveness.',
  },
  'gun-policy': {
    title: 'Gun Policy Bills',
    navLabel: 'Gun Policy',
    tags: ['civil_rights', 'community'],
    keywords: ['firearm', 'gun', 'second amendment', 'background check', 'assault weapon', 'ammunition'],
    intro: 'Gun policy covers who can buy firearms, how they are sold, and what safety rules apply. These bills affect schools, public spaces, and communities. We explain what each one would do, without taking a side.',
    metaDescription: 'Current gun policy bills in Congress, explained in plain language and without taking a side: sales, safety rules, and background checks.',
  },
  climate: {
    title: 'Climate Bills',
    navLabel: 'Climate',
    tags: ['environment'],
    keywords: ['climate', 'emission', 'clean energy', 'greenhouse', 'carbon', 'renewable', 'wildfire'],
    intro: 'Climate policy shapes energy costs, how the country responds to extreme weather, and the air you breathe. These bills cover clean energy, emissions, and disaster preparation. Here is what is moving in Congress right now, explained in plain language.',
    metaDescription: 'Current climate bills in Congress, explained in plain language: clean energy, emissions, and disaster preparation.',
  },
  'mental-health': {
    title: 'Mental Health Bills',
    navLabel: 'Mental Health',
    tags: ['healthcare', 'community'],
    keywords: ['mental health', 'suicide', 'counsel', 'behavioral health', 'crisis', 'depression', 'anxiety'],
    intro: 'Mental health policy decides what support is available at school, at work, online, and in your community, and what it costs. These bills cover counseling, crisis help, and access to care. Here is what is moving in Congress right now, explained in plain language.',
    metaDescription: 'Current mental health bills in Congress, explained in plain language: counseling, crisis help, and access to care.',
  },
  taxes: {
    title: 'Tax Bills',
    navLabel: 'Taxes',
    tags: ['economy'],
    keywords: ['tax', 'irs', 'deduction', 'credit', 'income tax', 'refund'],
    intro: 'Tax policy affects how much you keep from each paycheck and what public services get funded. These bills cover income taxes, credits, and how the government raises money. Here is what is moving in Congress right now, explained in plain language.',
    metaDescription: 'Current tax bills in Congress, explained in plain language: income taxes, credits, and how the government raises money.',
  },
}

const TOPIC_SLUGS = Object.keys(TOPICS)

const TOPIC_BILL_TYPE_LABELS = {
  hr: 'H.R.', s: 'S.',
  hjres: 'H.J.Res.', sjres: 'S.J.Res.',
  hconres: 'H.Con.Res.', sconres: 'S.Con.Res.',
  hres: 'H.Res.', sres: 'S.Res.',
}

const TOPIC_STAGE_LABELS = {
  introduced: 'Introduced',
  in_committee: 'In committee',
  passed_one: 'Passed one chamber',
  passed_both: 'Passed both chambers',
  enacted: 'Signed into law',
  vetoed: 'Vetoed',
}

function topicEscapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Collapse whitespace and truncate on a word boundary with an ellipsis.
function clampText(s, n) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  if (t.length <= n) return t
  return t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…'
}

function normalizeTopicSlug(slug) {
  return String(slug || '').toLowerCase().trim()
}

function getTopicBySlug(slug) {
  const key = normalizeTopicSlug(slug)
  return TOPICS[key] ? { slug: key, ...TOPICS[key] } : null
}

// "119-hr-2847" -> { path: "/bill/119/hr/2847", billLabel: "H.R. 2847",
// congressLabel: "119th Congress" }. Returns null for anything unparseable so a
// malformed congress_bill_id never produces a broken link.
function topicBillPath(congressBillId) {
  if (!congressBillId) return null
  const m = /^(\d+)-([a-z]+)-(\d+)$/i.exec(String(congressBillId).trim())
  if (!m) return null
  const [, congress, type, number] = m
  const lcType = type.toLowerCase()
  return {
    path: `/bill/${congress}/${lcType}/${number}`,
    billLabel: `${TOPIC_BILL_TYPE_LABELS[lcType] || lcType.toUpperCase()} ${number}`,
    congressLabel: congressOrdinalLabel(congress),
  }
}

function congressOrdinalLabel(congress) {
  const n = parseInt(congress, 10)
  if (!Number.isInteger(n) || n <= 0) return ''
  const mod100 = n % 100
  const suffix = mod100 >= 11 && mod100 <= 13
    ? 'th'
    : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'
  return `${n}${suffix} Congress`
}

// Lowercased haystack from a bill row for keyword matching on alias topics.
function billHaystack(row) {
  return `${row.title || ''} ${row.crs_summary || ''} ${row.description || ''}`.toLowerCase()
}

// Pull the most relevant federal bills for a topic. Reliability over cleverness:
// the bills.topics array is the primary signal; for alias topics we re-rank so
// keyword matches surface first, but we never drop a tag-matching bill, so a
// page is never empty when the tag has content.
async function fetchTopicBills(supabase, topic, limit = TOPIC_BILL_LIMIT) {
  if (!supabase) return []

  const { data, error } = await supabase
    .from('bills')
    .select('congress_bill_id, bill_type, bill_number, title, description, crs_summary, status_stage, latest_action_date, topics, feed_priority_score')
    .eq('jurisdiction', 'US')
    .eq('feed_eligible', true)
    .not('congress_bill_id', 'is', null)
    .overlaps('topics', topic.tags)
    .order('feed_priority_score', { ascending: false, nullsFirst: false })
    .order('latest_action_date', { ascending: false, nullsFirst: false })
    .limit(limit * 3) // overfetch so the keyword re-rank has material to work with
  if (error) {
    console.error('[topics] bill query error:', error.message)
    return []
  }

  let rows = data || []

  // Alias topics: stable re-rank so keyword hits lead, ties broken by the
  // existing feed/recency order the query already applied.
  if (topic.keywords && topic.keywords.length) {
    rows = rows
      .map((row, i) => {
        const hay = billHaystack(row)
        const hits = topic.keywords.reduce((n, kw) => (hay.includes(kw) ? n + 1 : n), 0)
        return { row, i, hits }
      })
      .sort((a, b) => (b.hits - a.hits) || (a.i - b.i))
      .map((x) => x.row)
  }

  return rows.slice(0, limit)
}

// Best-effort: published explainers keyed by congress_bill_id. The table is
// applied manually (supabase/create_bill_explainers.sql) like every other table
// in this repo, so until it exists this returns an empty map instead of 500ing
// the whole topic page.
async function fetchPublishedExplainers(supabase, billIds) {
  if (!supabase || !billIds.length) return new Map()
  try {
    const { data, error } = await supabase
      .from('bill_explainers')
      .select('bill_id, summary')
      .eq('status', 'published')
      .in('bill_id', billIds)
    if (error) return new Map()
    return new Map((data || []).map((r) => [r.bill_id, r]))
  } catch {
    return new Map()
  }
}

// Shape a raw bill row + optional explainer into the view object the SPA and the
// bot renderer both consume.
function buildTopicBillView(row, explainer) {
  const parsed = topicBillPath(row.congress_bill_id)
  if (!parsed) return null
  const summarySrc = (explainer?.summary || row.crs_summary || row.description || '').trim()
  return {
    id: row.congress_bill_id,
    path: parsed.path,
    billLabel: parsed.billLabel,
    congressLabel: parsed.congressLabel,
    title: (row.title || '').trim() || parsed.billLabel,
    summary: summarySrc ? clampText(summarySrc, 240) : '',
    statusStage: row.status_stage || '',
    statusLabel: TOPIC_STAGE_LABELS[row.status_stage] || '',
    latestActionDate: row.latest_action_date ? String(row.latest_action_date).slice(0, 10) : '',
    topics: Array.isArray(row.topics) ? row.topics : [],
    hasExplainer: !!explainer,
  }
}

// Assemble the full { topic, bills, count } payload for a slug.
async function buildTopicPayload(supabase, topic) {
  const rows = await fetchTopicBills(supabase, topic)
  const explainers = await fetchPublishedExplainers(supabase, rows.map((r) => r.congress_bill_id))
  const bills = rows
    .map((r) => buildTopicBillView(r, explainers.get(r.congress_bill_id)))
    .filter(Boolean)
  return {
    topic: {
      slug: topic.slug,
      title: topic.title,
      navLabel: topic.navLabel,
      intro: topic.intro,
      metaDescription: topic.metaDescription,
      canonical: `${SITE_URL}/topics/${topic.slug}`,
    },
    bills,
    count: bills.length,
  }
}

// ── Bot-facing HTML (mirrors billRenderer.js) ────────────────────────────────
function renderTopicHtml(payload) {
  const { topic, bills } = payload
  const canonical = topic.canonical
  const pageTitle = `${topic.title} | CapitolKey`
  const metaDesc = topic.metaDescription
  const ogImage = `${SITE_URL}/og-image.png`

  const itemList = {
    '@type': 'ItemList',
    itemListElement: bills.map((b, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      url: `${SITE_URL}${b.path}`,
      name: b.title,
    })),
  }

  const jsonLd = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'CollectionPage',
        name: topic.title,
        description: metaDesc,
        url: canonical,
        about: topic.navLabel,
        mainEntity: itemList,
      },
      {
        '@type': 'BreadcrumbList',
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'CapitolKey', item: SITE_URL },
          { '@type': 'ListItem', position: 2, name: 'Topics', item: `${SITE_URL}/topics` },
          { '@type': 'ListItem', position: 3, name: topic.navLabel, item: canonical },
        ],
      },
    ],
  }

  const body = []
  body.push(`<h1>${topicEscapeHtml(topic.title)}</h1>`)
  body.push(`<p>${topicEscapeHtml(topic.intro)}</p>`)
  if (bills.length) {
    body.push(`<h2>Current bills</h2>`)
    body.push('<ul>')
    for (const b of bills) {
      const meta = [b.billLabel, b.congressLabel, b.statusLabel].filter(Boolean).join(' · ')
      body.push(`  <li><a href="${SITE_URL}${b.path}">${topicEscapeHtml(b.title)}</a>${meta ? ` <span>(${topicEscapeHtml(meta)})</span>` : ''}${b.summary ? `<br />${topicEscapeHtml(b.summary)}` : ''}</li>`)
    }
    body.push('</ul>')
  } else {
    body.push(`<p>No current bills are tagged for this topic yet. <a href="${SITE_URL}/search">Browse all bills</a>.</p>`)
  }
  body.push(`<p><a href="${canonical}">See ${topicEscapeHtml(topic.navLabel)} bills on CapitolKey</a> &middot; <a href="${SITE_URL}/topics">All topics</a> &middot; <a href="${SITE_URL}/">CapitolKey home</a></p>`)

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${topicEscapeHtml(pageTitle)}</title>
<meta name="description" content="${topicEscapeHtml(metaDesc)}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="CapitolKey" />
<meta property="og:title" content="${topicEscapeHtml(topic.title)}" />
<meta property="og:description" content="${topicEscapeHtml(metaDesc)}" />
<meta property="og:url" content="${canonical}" />
<meta property="og:image" content="${ogImage}" />
<meta property="og:image:width" content="1200" />
<meta property="og:image:height" content="630" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${topicEscapeHtml(topic.title)}" />
<meta name="twitter:description" content="${topicEscapeHtml(metaDesc)}" />
<meta name="twitter:image" content="${ogImage}" />
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
</head>
<body>
${body.join('\n')}
</body>
</html>
`
}

// Generic, valid fallback for an unknown slug so a crawler always gets clean
// meta (and a 404 status) instead of an empty shell.
function renderUnknownTopicHtml(slug) {
  const canonical = `${SITE_URL}/topics`
  const title = 'Browse Bills by Topic | CapitolKey'
  const desc = 'Explore current U.S. legislation by topic, explained in plain language. Education, healthcare, economy, climate, and more.'
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>${topicEscapeHtml(title)}</title>
<meta name="description" content="${topicEscapeHtml(desc)}" />
<link rel="canonical" href="${canonical}" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="CapitolKey" />
<meta property="og:title" content="${topicEscapeHtml(title)}" />
<meta property="og:description" content="${topicEscapeHtml(desc)}" />
<meta property="og:url" content="${canonical}" />
</head>
<body>
<h1>${topicEscapeHtml(title)}</h1>
<p>${topicEscapeHtml(desc)}</p>
<ul>
${TOPIC_SLUGS.map((s) => `  <li><a href="${SITE_URL}/topics/${s}">${topicEscapeHtml(TOPICS[s].title)}</a></li>`).join('\n')}
</ul>
</body>
</html>
`
}

// Registers the topic routes. Dependencies injected so this stays decoupled
// from server.js internals, exactly like registerSitemapRoutes /
// registerBillRenderRoutes.
export function registerTopicRoutes(app, { supabase, getCache, setCache }) {
  if (!app) return

  // List of topics — powers the /topics index hub and is handy for debugging.
  app.get('/api/topics', (req, res) => {
    res.set('Cache-Control', 'public, max-age=3600, s-maxage=21600')
    res.json({
      topics: TOPIC_SLUGS.map((slug) => ({
        slug,
        title: TOPICS[slug].title,
        navLabel: TOPICS[slug].navLabel,
        metaDescription: TOPICS[slug].metaDescription,
      })),
    })
  })

  // JSON the SPA cold-loads to render a topic page.
  app.get('/api/topics/:slug', async (req, res) => {
    const topic = getTopicBySlug(req.params.slug)
    if (!topic) return res.status(404).json({ error: 'Unknown topic' })

    const cacheKey = `topic-api-${topic.slug}`
    try {
      let payload = getCache(cacheKey)
      if (!payload) {
        payload = await buildTopicPayload(supabase, topic)
        setCache(cacheKey, payload, TOPIC_API_TTL)
      }
      res.set('Cache-Control', 'public, max-age=600, s-maxage=3600')
      res.json(payload)
    } catch (e) {
      console.error(`[topics] api ${topic.slug} error:`, e.message)
      res.status(500).json({ error: 'topic error' })
    }
  })

  // Bot-only server-rendered HTML. A Vercel rewrite routes bot user-agents for
  // /topics/:slug here; humans stay on the static SPA.
  app.get('/render/topic/:slug', async (req, res) => {
    res.set('Content-Type', 'text/html; charset=utf-8')
    const topic = getTopicBySlug(req.params.slug)
    if (!topic) {
      return res.status(404).send(renderUnknownTopicHtml(req.params.slug))
    }

    const cacheKey = `topic-render-${topic.slug}`
    try {
      let html = getCache(cacheKey)
      if (!html) {
        const payload = await buildTopicPayload(supabase, topic)
        html = renderTopicHtml(payload)
        setCache(cacheKey, html, TOPIC_RENDER_TTL)
      }
      res.set('Cache-Control', 'public, max-age=3600, s-maxage=21600')
      res.send(html)
    } catch (e) {
      console.error(`[topics] render ${topic.slug} error:`, e.message)
      // Always return valid meta rather than an error to a crawler.
      res.status(200).send(renderUnknownTopicHtml(req.params.slug))
    }
  })
}

export { TOPICS, TOPIC_SLUGS, getTopicBySlug }
