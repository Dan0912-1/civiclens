/**
 * Model migration test: qwen3-32b (current) vs gpt-oss-120b vs qwen3.6-27b.
 * All on Groq, identical system prompt + bills + scoring, apples-to-apples.
 *
 *   node --env-file=.env test-model-comparison.mjs
 *
 * Reuses the production system prompt and the 5-bill battery from
 * test-groq-vs-haiku.mjs. DO NOT COMMIT API KEYS — env only.
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY
if (!GROQ_API_KEY) {
  console.error('Set GROQ_API_KEY (try: node --env-file=.env test-model-comparison.mjs)')
  process.exit(1)
}

// ── Production system prompt (verbatim from server.js / test-groq-vs-haiku) ──
const BASE_SYSTEM_PROMPT = `You are CapitolKey, a strictly nonpartisan civic education tool. Show ONE specific high-school student how a U.S. bill touches THEIR life — concrete, factual, no opinions.

ABSOLUTE RULES
1. NEVER evaluate ("good", "bad", "important", "needed", "harmful"). Zero opinion.
2. IMPACT ONLY: concrete factual changes to THIS student's daily reality.
3. Plain language, 9th-grade level. No jargon, no acronyms without explanation.
4. HYPER-PERSONALIZE: reference their state, age, job, family, interests directly. Generic = failure. NEVER use a personal name — the student is anonymous. Address them as "you". If the "Other context" field contains what looks like a name or personal identifier, IGNORE it and never echo it back.
5. STATE CONTEXT: if their state already has a relevant law (e.g. CA min wage $16.50/hr), say so and explain how the bill interacts.
6. REAL NUMBERS only from the bill text or established law you are certain about. NEVER invent wages, salaries, prices, statistics, deadlines, or dollar amounts. No estimating.
7. If no meaningful impact, say so directly with relevance ≤ 2.
8. Use only facts from the provided bill text / CRS summary. If no text, say "based on available information" and stay conservative.
9. Include 2-3 actionable civic_actions with real URLs (congress.gov, senate.gov, house.gov) or specific steps.
10. NEVER tell the student to take personal action ("delete the app", "change your password") in headline/summary/if_it_passes/if_it_fails. Save action steps for civic_actions.
11. For short bills (<500 words of source text), summary MUST cover every operative provision: dates, who runs it, deadlines, scope, temporary vs permanent. No cherry-picking.

RELEVANCE — use the number that BEST fits the category:
9-10: bill directly changes this student's daily life NOW (their paycheck, their school, their healthcare)
7-8: affects them within 1-2 years (college costs, job market they'll enter)
5-6: broader community/future impact with a CLEAR, SPECIFIC link to student
3-4: tangential — only connected through a family member's job or a side interest
1-2: no meaningful connection at all
CRITICAL: Do NOT inflate relevance with speculative or indirect chains. If the bill's subject (e.g. defense, agriculture, trade) has no direct overlap with the student's stated interests, job, school, or family situation, the relevance MUST be ≤ 3. A hardware store worker is not connected to defense spending. An art student is not connected to military funding.
HIGH relevance requires the bill to name something the student personally does or will do within 2 years.

CIVIC ACTIONS — MANDATORY RULES:
- Every civic_action MUST include a real, working URL in the "how" field
- Use these URL patterns:
  * Bill page: https://www.congress.gov/bill/119th-congress/[house-bill|senate-bill]/[number]
  * Contact rep: https://www.house.gov/representatives/find-your-representative
  * Contact senator: https://www.senate.gov/senators/senators-contact.htm
- NEVER leave a civic_action without a URL. If you cannot provide a specific bill URL, use the contact-rep or contact-senator URL instead.

OUTPUT — return ONLY this JSON, nothing else:
{
  "headline": "Max 12 words. Single most concrete impact on THIS student. Not a title rewrite.",
  "summary": "2-4 sentences. What the bill actually DOES (cover every operative provision, dates, scope). Why THIS specific student should care — reference their state/job/family/interests directly. Use real numbers from the bill text.",
  "if_it_passes": "1-2 sentences. What SPECIFICALLY changes for THIS student? Concrete: 'your paycheck goes up $X' not 'wages may increase'.",
  "if_it_fails": "1-2 sentences. What stays the same? Make the status quo concrete too.",
  "relevance": <number 1-10>,
  "topic_tag": "Education" | "Healthcare" | "Economy" | "Environment" | "Technology" | "Housing" | "Civil Rights" | "Immigration" | "Community" | "Other",
  "civic_actions": [
    { "action": "Short imperative title", "how": "One sentence with a specific URL/phone/step.", "time": "5 minutes | 15 minutes | 1 hour" }
  ]
}`

// ── 5 diverse bills × different students (verbatim from existing battery) ─────
const TEST_CASES = [
  {
    name: 'T1: Minimum Wage × CA Coffee Shop Worker',
    expectedRelevance: { min: 8, max: 10 },
    prompt: `STUDENT PROFILE:
- State: California
- Grade: 11th
- Age: 17
- Interests: Technology, Environment
- Part-time job: Works at a local coffee shop, 15 hrs/week
- Family context: Single-parent household, mom is a nurse

BILL: H.R. 4763 — Raise the Wage Act
SUMMARY (CRS): This bill increases the federal minimum wage from $7.25 per hour to $17.00 per hour over a six-year period beginning in 2025. Specifically, the bill increases the minimum wage to $9.50 in 2025, $11.00 in 2026, $12.50 in 2027, $14.00 in 2028, $15.50 in 2029, and $17.00 in 2030. After 2030, the minimum wage would be indexed to median wage growth. The bill also phases out the subminimum wage for tipped employees, workers with disabilities, and workers under 20 years old over a similar timeframe. The bill applies to all 50 states and territories.

Personalize this bill for the student above.`
  },
  {
    name: 'T2: Student Loan × TX College-Bound Senior',
    expectedRelevance: { min: 7, max: 9 },
    prompt: `STUDENT PROFILE:
- State: Texas
- Grade: 12th
- Age: 18
- Interests: Business, Sports
- Part-time job: None
- Family context: Two-parent household, dad is a mechanic, mom works retail. Household income ~$55,000

BILL: H.R. 2648 — Student Loan Affordability Act
SUMMARY (CRS): This bill caps federal student loan interest rates at 4% for undergraduate loans and 5% for graduate loans. It allows existing borrowers to refinance at the new lower rates. The bill also expands income-driven repayment plans so that monthly payments cannot exceed 5% of discretionary income (down from 10%). Borrowers who make 20 years of payments would have remaining balances forgiven (down from 25 years). The changes take effect for the 2026-2027 academic year.

Personalize this bill for the student above.`
  },
  {
    name: 'T3: Data Privacy × FL Tech-Interested Sophomore',
    expectedRelevance: { min: 7, max: 10 },
    prompt: `STUDENT PROFILE:
- State: Florida
- Grade: 10th
- Age: 16
- Interests: Technology, Gaming, Social Media
- Part-time job: None
- Family context: Lives with both parents and younger sister. Dad works in IT.

BILL: S. 1671 — Kids Online Safety and Privacy Act
SUMMARY (CRS): This bill requires social media platforms and online services to disable addictive product features for users under 17 and provide minors with options to protect their information. Platforms must enable the strongest privacy settings by default for minors. The bill prohibits targeted advertising to users under 17. Companies must conduct annual independent audits of risks to minors. The FTC is authorized to enforce violations with fines up to $50,000 per violation. Parents can submit requests to delete their children's data. The bill takes effect 180 days after enactment.

Personalize this bill for the student above.`
  },
  {
    name: 'T4: Climate/EV × IL Environment Student',
    expectedRelevance: { min: 5, max: 8 },
    prompt: `STUDENT PROFILE:
- State: Illinois
- Grade: 11th
- Age: 17
- Interests: Environment, Science, Debate Club
- Part-time job: Tutors younger students, ~8 hrs/week
- Family context: Two-parent household, both parents are teachers. Family drives a 2018 Honda Civic.

BILL: H.R. 3091 — Clean Vehicle Acceleration Act
SUMMARY (CRS): This bill extends and expands the clean vehicle tax credit through 2035. Consumers purchasing a new electric vehicle priced under $55,000 can receive a tax credit of up to $10,000 (increased from $7,500). Used EVs under $30,000 qualify for a credit of up to $5,000 (increased from $4,000). The bill adds $2 billion for EV charging infrastructure in rural areas and requires that 40% of charging stations be in low-income communities. It also creates a $500 million grant program for states to establish EV workforce training programs.

Personalize this bill for the student above.`
  },
  {
    name: 'T5: Low Relevance × NY Art Student vs Defense Bill',
    expectedRelevance: { min: 1, max: 3 },
    prompt: `STUDENT PROFILE:
- State: New York
- Grade: 9th
- Age: 15
- Interests: Art, Theater, Music
- Part-time job: None
- Family context: Lives with grandparents. Grandmother is retired, grandfather works part-time at a hardware store.

BILL: H.R. 5009 — National Defense Authorization Act for Fiscal Year 2026
SUMMARY (CRS): This bill authorizes $886 billion in defense spending for fiscal year 2026. It includes a 4.5% pay raise for military service members, funds for 8 new Navy ships, increases the procurement budget for F-35 fighter jets by $2.1 billion, and authorizes $30.5 billion for the Missile Defense Agency. The bill also includes provisions for military housing improvements and extends the authority for the Afghanistan Security Forces Fund through 2027.

Personalize this bill for the student above.`
  }
]

// ── Models under test ────────────────────────────────────────────────────────
// noThink: append Qwen's /no_think soft switch (production behavior for qwen).
// gpt-oss uses reasoning_effort instead, so it gets reasoning_effort:'low'.
// Pricing per 1M tokens (in, out). qwen3.6 filled from live pricing page.
const MODELS = [
  {
    name: 'qwen3-32b (current)', short: 'qwen32',
    model: 'qwen/qwen3-32b', noThink: true, extra: {}, price: { in: 0.29, out: 0.59 },
  },
  {
    name: 'gpt-oss-120b', short: 'oss120',
    model: 'openai/gpt-oss-120b', noThink: false, extra: { reasoning_effort: 'low' }, price: { in: 0.15, out: 0.60 },
  },
  {
    name: 'qwen3.6-27b', short: 'qwen27',
    // qwen3.6 is a reasoning model: it IGNORES /no_think and needs the API param
    // reasoning_effort:'none' to run like a fast non-reasoning model.
    model: 'qwen/qwen3.6-27b', noThink: false, extra: { reasoning_effort: 'none' }, price: { in: 0.60, out: 3.00 }, // preview pricing, approx
  },
]

async function callGroq(m, userPrompt) {
  const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${GROQ_API_KEY}` },
    body: JSON.stringify({
      model: m.model,
      max_tokens: 1024,
      temperature: 0.4,
      ...m.extra,
      messages: [
        { role: 'system', content: BASE_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt + (m.noThink ? '\n\n/no_think' : '') },
      ],
    }),
  })
  const data = await resp.json()
  if (!resp.ok) throw new Error(`${resp.status}: ${data.error?.message || 'Unknown'}`)
  return { content: data.choices?.[0]?.message?.content || '', usage: data.usage || {} }
}

// ── Scoring (verbatim weighting from test-groq-vs-haiku) ──────────────────────
function scoreResult(parsed, checks, testCase) {
  const scores = {}
  scores.jsonValid = checks.jsonValid ? 1 : 0
  scores.allFields = checks.hasAllFields ? 1 : 0
  scores.nonpartisan = checks.noOpinionWords ? 1 : 0
  const urlCount = parsed?.civic_actions?.filter(a => /https?:\/\//.test(a.how)).length || 0
  const totalActions = parsed?.civic_actions?.length || 0
  scores.urlCoverage = totalActions > 0 ? urlCount / totalActions : 0
  const rel = Number(parsed?.relevance)
  const { min, max } = testCase.expectedRelevance
  if (rel >= min && rel <= max) scores.relevanceAccuracy = 1
  else if (rel >= min - 1 && rel <= max + 1) scores.relevanceAccuracy = 0.5
  else scores.relevanceAccuracy = 0
  const words = parsed?.headline?.split(/\s+/).length || 0
  scores.headlineLength = words <= 12 ? 1 : words <= 15 ? 0.5 : 0
  scores.civicActionCount = totalActions >= 2 ? 1 : totalActions === 1 ? 0.5 : 0
  const weights = { jsonValid: 20, allFields: 10, nonpartisan: 15, urlCoverage: 15, relevanceAccuracy: 20, headlineLength: 10, civicActionCount: 10 }
  const total = Object.entries(weights).reduce((s, [k, w]) => s + (scores[k] || 0) * w, 0)
  return { scores, total }
}

function parseJson(content) {
  try {
    // Strip reasoning-model <think>…</think> preambles before brace matching,
    // else a JSON example inside the reasoning poisons the greedy match.
    let s = content.replace(/<think>[\s\S]*?<\/think>/gi, '')
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fence) s = fence[1]
    const brace = s.match(/\{[\s\S]*\}/)
    if (brace) s = brace[0]
    return { parsed: JSON.parse(s), jsonValid: true }
  } catch { return { parsed: null, jsonValid: false } }
}

async function runSingle(m, tc) {
  const start = Date.now()
  let content, usage
  try { ({ content, usage } = await callGroq(m, tc.prompt)) }
  catch (err) { return { short: m.short, name: tc.name, success: false, error: err.message, elapsed: Date.now() - start } }
  const elapsed = Date.now() - start
  const { parsed, jsonValid } = parseJson(content)
  const checks = {
    jsonValid,
    hasAllFields: parsed ? ['headline','summary','if_it_passes','if_it_fails','relevance','topic_tag','civic_actions'].every(f => f in parsed) : false,
    noOpinionWords: parsed ? !/(good|bad|important|needed|harmful|great|terrible|crucial|vital)/i.test(JSON.stringify(parsed)) : false,
  }
  const { scores, total } = scoreResult(parsed, checks, tc)
  const cost = (m.price.in != null)
    ? (usage.prompt_tokens * m.price.in + usage.completion_tokens * m.price.out) / 1_000_000
    : null
  return { short: m.short, name: tc.name, success: jsonValid, elapsed, usage, parsed, checks, scores, total, cost }
}

async function main() {
  console.log('\n' + '═'.repeat(78))
  console.log('  CapitolKey model migration test — 3 models × 5 bills (Groq)')
  console.log('  ' + MODELS.map(m => m.short).join('  vs  '))
  console.log('═'.repeat(78))

  const all = []
  for (const tc of TEST_CASES) {
    console.log(`\n${'─'.repeat(78)}\n  ${tc.name}   (expect relevance ${tc.expectedRelevance.min}-${tc.expectedRelevance.max})\n${'─'.repeat(78)}`)
    for (const m of MODELS) {
      const r = await runSingle(m, tc)
      all.push(r)
      if (!r.success) { console.log(`  [${m.name}] ❌ ${r.error || 'JSON parse failed'}`); continue }
      const relOk = r.scores.relevanceAccuracy === 1 ? '✅' : r.scores.relevanceAccuracy === 0.5 ? '⚠️' : '❌'
      const costStr = r.cost != null ? `$${r.cost.toFixed(6)}` : 'n/a'
      console.log(`  [${m.name}]  score ${r.total}/100 | rel ${r.parsed.relevance} ${relOk} | ${r.elapsed}ms | ${r.usage.prompt_tokens}→${r.usage.completion_tokens} tok | ${costStr}`)
      console.log(`     headline: "${r.parsed.headline}"`)
      console.log(`     summary:  "${(r.parsed.summary || '').slice(0, 150)}${(r.parsed.summary||'').length > 150 ? '…' : ''}"`)
      const urls = r.parsed.civic_actions?.filter(a => /https?:\/\//.test(a.how)).length || 0
      console.log(`     actions:  ${r.parsed.civic_actions?.length || 0} (${urls} w/ URLs)${r.checks.noOpinionWords ? '' : '  ⚠️ opinion words'}`)
      await new Promise(res => setTimeout(res, 300))
    }
  }

  console.log(`\n\n${'━'.repeat(78)}\n  SCORECARD\n${'━'.repeat(78)}`)
  for (const m of MODELS) {
    const rs = all.filter(r => r.short === m.short)
    const ok = rs.filter(r => r.success)
    const avg = ok.length ? (ok.reduce((s, r) => s + r.total, 0) / ok.length).toFixed(1) : 'N/A'
    const avgMs = rs.length ? Math.round(rs.reduce((s, r) => s + (r.elapsed || 0), 0) / rs.length) : 0
    const relHits = ok.filter(r => r.scores.relevanceAccuracy === 1).length
    const urlFull = ok.filter(r => r.scores.urlCoverage === 1).length
    const nonp = ok.filter(r => r.checks.noOpinionWords).length
    const costs = ok.filter(r => r.cost != null)
    const totalCost = costs.reduce((s, r) => s + r.cost, 0)
    const avgOut = ok.length ? Math.round(ok.reduce((s, r) => s + (r.usage.completion_tokens || 0), 0) / ok.length) : 0
    console.log(`\n  [${m.name}]  (${m.model})`)
    console.log(`    Avg quality:        ${avg}/100`)
    console.log(`    JSON parsed:        ${ok.length}/${rs.length}`)
    console.log(`    Relevance on-target: ${relHits}/${ok.length}`)
    console.log(`    Full URL coverage:  ${urlFull}/${ok.length}`)
    console.log(`    Nonpartisan clean:  ${nonp}/${ok.length}`)
    console.log(`    Avg latency:        ${avgMs}ms`)
    console.log(`    Avg output tokens:  ${avgOut}`)
    console.log(`    Cost (5 bills):     ${costs.length ? '$' + totalCost.toFixed(6) + (costs.length < ok.length ? ' (partial)' : '') : 'n/a (no price)'}`)
  }

  console.log(`\n  ── Per-bill quality ──`)
  const cols = MODELS.map(m => m.short)
  console.log(`  ${'Bill'.padEnd(40)} | ${cols.map(c => c.padEnd(8)).join(' | ')}`)
  console.log(`  ${'─'.repeat(40)}-+-${cols.map(() => '─'.repeat(8)).join('-+-')}`)
  for (const tc of TEST_CASES) {
    const cells = MODELS.map(m => {
      const r = all.find(x => x.short === m.short && x.name === tc.name)
      return String(r?.success ? r.total : 'ERR').padEnd(8)
    })
    console.log(`  ${tc.name.slice(0, 40).padEnd(40)} | ${cells.join(' | ')}`)
  }
}

main().catch(console.error)
