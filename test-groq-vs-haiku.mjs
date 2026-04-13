/**
 * Side-by-side comparison: Qwen3 32B (Groq) vs Claude Haiku 4.5
 * Runs 5 diverse bills through BOTH providers and scores quality.
 *
 * DO NOT COMMIT API KEYS — uses env variables only.
 *   GROQ_API_KEY=gsk_...  ANTHROPIC_API_KEY=sk-ant-...  node test-groq-vs-haiku.mjs
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY

if (!GROQ_API_KEY && !ANTHROPIC_API_KEY) {
  console.error('Provide at least one key:\n  GROQ_API_KEY=...  ANTHROPIC_API_KEY=...  node test-groq-vs-haiku.mjs')
  process.exit(1)
}

// ── System prompts ────────────────────────────────────────────────────────────

// Shared base prompt (used by both providers)
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

// Approach 2: Add few-shot calibration examples to the prompt
const FEWSHOT_SYSTEM_PROMPT = BASE_SYSTEM_PROMPT.replace(
  'HIGH relevance requires the bill to name something the student personally does or will do within 2 years.',
  `HIGH relevance requires the bill to name something the student personally does or will do within 2 years.

RELEVANCE EXAMPLES:
- Student works part-time, bill raises minimum wage → relevance 9 (directly changes their paycheck)
- Student interested in environment, bill funds coastal restoration → relevance 8 (ties to their passion and future career)
- Student interested in art/theater, bill increases defense spending → relevance 1-2 (no connection — say so honestly)
- Student's parent works retail, bill changes trade tariffs → relevance 3 (only tangential through family)
Low relevance is the CORRECT answer when the connection is weak. Helping students focus on bills that matter to THEM means honestly rating irrelevant bills low.`
)

// Approach 4: Server-side post-processing to correct relevance
// ONLY pulls down clearly inflated scores. Never touches scores where a
// reasonable connection exists. Conservative: trust the LLM unless we're
// confident it over-rated.
function adjustRelevance(parsed, testCase) {
  const raw = Number(parsed.relevance)
  if (isNaN(raw) || raw <= 3) return raw // already low — trust it

  const tag = (parsed.topic_tag || 'Other').toLowerCase()
  const prompt = testCase.prompt.toLowerCase()

  // Extract profile signals from the prompt
  const interestMatch = prompt.match(/interests?:\s*(.+)/i)
  const interests = interestMatch
    ? interestMatch[1].split(/,\s*/).map(i => i.trim().toLowerCase())
    : []
  const hasJob = /part-time job:\s*(?!none)/i.test(prompt)
  const grade = parseInt((prompt.match(/grade:\s*(\d+)/i) || [])[1]) || 0
  const isSenior = grade >= 12

  // ── Direct-connection checks (any of these = trust the LLM score) ──

  // Student has a job → economy/housing bills directly affect them
  if (hasJob && ['economy', 'housing'].includes(tag)) return raw

  // Senior heading to college → education bills directly affect them
  if (isSenior && tag === 'education') return raw

  // Interest-to-topic affinity
  const affinityMap = {
    education:      ['education', 'teaching', 'college prep', 'stem', 'debate'],
    healthcare:     ['healthcare', 'biology', 'pre-med', 'sports', 'mental health'],
    economy:        ['business', 'economics', 'entrepreneurship', 'finance'],
    environment:    ['environment', 'science', 'agriculture', 'biology'],
    technology:     ['technology', 'gaming', 'computer science', 'stem', 'engineering', 'social media'],
    housing:        ['real estate', 'architecture', 'community service'],
    'civil rights': ['politics', 'debate', 'history', 'social justice'],
    immigration:    ['languages', 'culture', 'politics', 'debate'],
    community:      ['community service', 'volunteering', 'politics'],
    other:          [],
  }
  const related = affinityMap[tag] || []
  const hasInterestMatch = interests.some(i =>
    related.some(r => i.includes(r) || r.includes(i))
  )
  if (hasInterestMatch) return raw // LLM had a reason — trust it

  // ── Bill-content keyword checks ──
  // Check if the bill text mentions things that directly affect any student
  const universalKeywords = ['student', 'school', 'minor', 'under 17', 'under 18', 'youth', 'teen', 'college', 'university']
  const billText = prompt.slice(prompt.indexOf('bill:'))
  const hitsUniversal = universalKeywords.some(kw => billText.includes(kw))
  if (hitsUniversal) return raw

  // ── No direct connection found — cap the score ──
  return Math.min(raw, 3)
}

// ── Test cases: 5 diverse bills × different students ─────────────────────────
const TEST_CASES = [
  {
    name: 'Test 1: Minimum Wage × CA Coffee Shop Worker',
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
    name: 'Test 2: Student Loan × TX College-Bound Senior',
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
    name: 'Test 3: Data Privacy × FL Tech-Interested Sophomore',
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
    name: 'Test 4: Climate/EV × IL Environment Student',
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
    name: 'Test 5: Low Relevance × NY Art Student vs Defense Bill',
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

// ── Provider configs ─────────────────────────────────────────────────────────

const PROVIDERS = []

if (GROQ_API_KEY) {
  PROVIDERS.push({
    name: 'Baseline',
    short: 'baseline',
    systemPrompt: BASE_SYSTEM_PROMPT,
    postProcess: null,
    call: async (systemPrompt, userPrompt) => {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'qwen/qwen3-32b',
          max_tokens: 1024,
          temperature: 0.4,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt + '\n\n/no_think' }
          ]
        })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(`${resp.status}: ${data.error?.message || 'Unknown'}`)
      return {
        content: data.choices?.[0]?.message?.content || '',
        usage: data.usage || {},
        costFn: (u) => (u.prompt_tokens * 0.29 + u.completion_tokens * 0.59) / 1_000_000
      }
    }
  })

  // Approach 2: Few-shot examples in prompt
  PROVIDERS.push({
    name: 'Few-shot',
    short: 'fewshot',
    systemPrompt: FEWSHOT_SYSTEM_PROMPT,
    postProcess: null,
    call: async (systemPrompt, userPrompt) => {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'qwen/qwen3-32b',
          max_tokens: 1024,
          temperature: 0.4,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt + '\n\n/no_think' }
          ]
        })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(`${resp.status}: ${data.error?.message || 'Unknown'}`)
      return {
        content: data.choices?.[0]?.message?.content || '',
        usage: data.usage || {},
        costFn: (u) => (u.prompt_tokens * 0.29 + u.completion_tokens * 0.59) / 1_000_000
      }
    }
  })

  // Approach 2+4: Few-shot prompt + server-side post-processing
  PROVIDERS.push({
    name: 'Few-shot+PostProc',
    short: '2+4',
    systemPrompt: FEWSHOT_SYSTEM_PROMPT,
    postProcess: adjustRelevance,
    call: async (systemPrompt, userPrompt) => {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify({
          model: 'qwen/qwen3-32b',
          max_tokens: 1024,
          temperature: 0.4,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt + '\n\n/no_think' }
          ]
        })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(`${resp.status}: ${data.error?.message || 'Unknown'}`)
      return {
        content: data.choices?.[0]?.message?.content || '',
        usage: data.usage || {},
        costFn: (u) => (u.prompt_tokens * 0.29 + u.completion_tokens * 0.59) / 1_000_000
      }
    }
  })
}

if (ANTHROPIC_API_KEY) {
  PROVIDERS.push({
    name: 'Claude Haiku 4.5',
    short: 'haiku',
    call: async (systemPrompt, userPrompt) => {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 700,
          temperature: 0.4,
          system: systemPrompt,
          messages: [{ role: 'user', content: userPrompt }]
        })
      })
      const data = await resp.json()
      if (!resp.ok) throw new Error(`${resp.status}: ${data.error?.message || JSON.stringify(data)}`)
      return {
        content: data.content?.[0]?.text || '',
        usage: { prompt_tokens: data.usage?.input_tokens || 0, completion_tokens: data.usage?.output_tokens || 0 },
        costFn: (u) => (u.prompt_tokens * 0.80 + u.completion_tokens * 4.00) / 1_000_000
      }
    }
  })
}

// ── Quality scoring ──────────────────────────────────────────────────────────

function scoreResult(parsed, checks, testCase) {
  const scores = {}

  // JSON validity (pass/fail)
  scores.jsonValid = checks.jsonValid ? 1 : 0

  // All required fields present
  scores.allFields = checks.hasAllFields ? 1 : 0

  // No opinion words
  scores.nonpartisan = checks.noOpinionWords ? 1 : 0

  // URLs in civic actions
  const urlCount = parsed?.civic_actions?.filter(a => /https?:\/\//.test(a.how)).length || 0
  const totalActions = parsed?.civic_actions?.length || 0
  scores.urlCoverage = totalActions > 0 ? urlCount / totalActions : 0

  // Relevance accuracy (how close to expected range)
  const rel = Number(parsed?.relevance)
  const { min, max } = testCase.expectedRelevance
  if (rel >= min && rel <= max) {
    scores.relevanceAccuracy = 1
  } else if (rel >= min - 1 && rel <= max + 1) {
    scores.relevanceAccuracy = 0.5
  } else {
    scores.relevanceAccuracy = 0
  }

  // Headline length (≤12 words = 1, 13-15 = 0.5, >15 = 0)
  const words = parsed?.headline?.split(/\s+/).length || 0
  scores.headlineLength = words <= 12 ? 1 : words <= 15 ? 0.5 : 0

  // Civic actions count (2-3 = 1, 1 = 0.5, 0 = 0)
  scores.civicActionCount = totalActions >= 2 ? 1 : totalActions === 1 ? 0.5 : 0

  // Overall weighted score (0-100)
  const weights = { jsonValid: 20, allFields: 10, nonpartisan: 15, urlCoverage: 15, relevanceAccuracy: 20, headlineLength: 10, civicActionCount: 10 }
  const total = Object.entries(weights).reduce((s, [k, w]) => s + (scores[k] || 0) * w, 0)

  return { scores, total }
}

// ── Run one test case with one provider ──────────────────────────────────────

async function runSingle(provider, testCase) {
  const start = Date.now()
  let content, usage, costFn
  try {
    const result = await provider.call(provider.systemPrompt || BASE_SYSTEM_PROMPT, testCase.prompt)
    content = result.content
    usage = result.usage
    costFn = result.costFn
  } catch (err) {
    return { provider: provider.short, name: testCase.name, success: false, error: err.message, elapsed: Date.now() - start }
  }
  const elapsed = Date.now() - start

  // Parse JSON
  let parsed = null
  let jsonValid = false
  try {
    let jsonStr = content
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) jsonStr = fenceMatch[1]
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (braceMatch) jsonStr = braceMatch[0]
    parsed = JSON.parse(jsonStr)
    jsonValid = true
  } catch { /* parse failed */ }

  // Apply post-processing if provider has it
  if (parsed && provider.postProcess) {
    const rawRel = parsed.relevance
    parsed.relevance = provider.postProcess(parsed, testCase)
    if (rawRel !== parsed.relevance) {
      parsed._rawRelevance = rawRel
    }
  }

  const checks = {
    jsonValid,
    hasAllFields: parsed ? ['headline','summary','if_it_passes','if_it_fails','relevance','topic_tag','civic_actions'].every(f => f in parsed) : false,
    relevanceIsNumber: parsed ? !isNaN(Number(parsed.relevance)) : false,
    hasCivicActions: parsed?.civic_actions?.length >= 2,
    headlineLength: parsed?.headline ? parsed.headline.split(/\s+/).length : 0,
    noOpinionWords: parsed ? !/(good|bad|important|needed|harmful|great|terrible|crucial|vital)/i.test(JSON.stringify(parsed)) : false,
    hasUrls: parsed?.civic_actions ? parsed.civic_actions.some(a => /https?:\/\//.test(a.how)) : false,
  }

  const { scores, total } = scoreResult(parsed, checks, testCase)
  const cost = costFn(usage)

  return { provider: provider.short, name: testCase.name, success: jsonValid, elapsed, usage, parsed, checks, scores, total, cost }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const providerNames = PROVIDERS.map(p => p.name).join(' vs ')
  console.log('╔══════════════════════════════════════════════════════════════════════════╗')
  console.log(`║   CapitolKey Side-by-Side Test: ${providerNames.padEnd(40)}║`)
  console.log('║   5 bills × different students × quality scoring                        ║')
  console.log('╚══════════════════════════════════════════════════════════════════════════╝')

  const allResults = []

  for (const tc of TEST_CASES) {
    console.log(`\n${'═'.repeat(74)}`)
    console.log(`  ${tc.name}`)
    console.log(`  Expected relevance: ${tc.expectedRelevance.min}-${tc.expectedRelevance.max}`)
    console.log(`${'═'.repeat(74)}`)

    for (const provider of PROVIDERS) {
      const r = await runSingle(provider, tc)
      allResults.push(r)

      const label = `[${provider.name}]`
      if (!r.success) {
        console.log(`  ${label} ❌ ${r.error || 'JSON parse failed'}`)
        continue
      }

      console.log(`  ${label}`)
      console.log(`    Speed: ${r.elapsed}ms | Tokens: ${r.usage.prompt_tokens}→${r.usage.completion_tokens} | Cost: $${r.cost.toFixed(6)}`)
      const relLabel = r.parsed._rawRelevance != null ? `${r.parsed._rawRelevance}→${r.parsed.relevance}` : `${r.parsed.relevance}`
      console.log(`    Score: ${r.total}/100 | Relevance: ${relLabel} ${r.scores.relevanceAccuracy === 1 ? '✅' : r.scores.relevanceAccuracy === 0.5 ? '⚠️ close' : '❌ off'}`)
      console.log(`    Headline: "${r.parsed.headline}"`)
      console.log(`    Summary: "${r.parsed.summary.slice(0, 120)}..."`)
      const urlCount = r.parsed.civic_actions?.filter(a => /https?:\/\//.test(a.how)).length || 0
      console.log(`    Civic actions: ${r.parsed.civic_actions?.length || 0} (${urlCount} with URLs)`)
      if (!r.checks.noOpinionWords) console.log(`    ⚠️  Opinion words detected`)

      await new Promise(resolve => setTimeout(resolve, 300))
    }
  }

  // ── Final scorecard ──────────────────────────────────────────────────────
  console.log(`\n\n${'━'.repeat(74)}`)
  console.log('FINAL SCORECARD')
  console.log(`${'━'.repeat(74)}`)

  for (const provider of PROVIDERS) {
    const results = allResults.filter(r => r.provider === provider.short)
    const successful = results.filter(r => r.success)
    const avgScore = successful.length ? (successful.reduce((s, r) => s + r.total, 0) / successful.length).toFixed(1) : 'N/A'
    const avgTime = results.length ? Math.round(results.reduce((s, r) => s + (r.elapsed || 0), 0) / results.length) : 'N/A'
    const totalCost = successful.reduce((s, r) => s + (r.cost || 0), 0)
    const jsonRate = `${successful.length}/${results.length}`
    const relevanceHits = successful.filter(r => r.scores.relevanceAccuracy === 1).length
    const urlHits = successful.filter(r => r.scores.urlCoverage === 1).length

    console.log(`\n  [${provider.name}]`)
    console.log(`    Avg quality score: ${avgScore}/100`)
    console.log(`    JSON parse:        ${jsonRate}`)
    console.log(`    Relevance on-target: ${relevanceHits}/${successful.length}`)
    console.log(`    Full URL coverage: ${urlHits}/${successful.length}`)
    console.log(`    Avg latency:       ${avgTime}ms`)
    console.log(`    Total cost (5 bills): $${totalCost.toFixed(6)}`)
  }

  // Comparison table (works for any number of providers)
  if (PROVIDERS.length >= 2) {
    console.log(`\n  ── Comparison ──`)
    const cols = PROVIDERS.map(p => p.short)
    const header = `  ${'Test'.padEnd(42)} | ${cols.map(c => c.padEnd(10)).join(' | ')} | Best`
    console.log(header)
    console.log(`  ${'─'.repeat(42)}-+-${cols.map(() => '─'.repeat(10)).join('-+-')}-+${'─'.repeat(10)}`)

    const wins = Object.fromEntries(cols.map(c => [c, 0]))
    for (const tc of TEST_CASES) {
      const scores = {}
      for (const p of PROVIDERS) {
        const r = allResults.find(r => r.provider === p.short && r.name === tc.name)
        scores[p.short] = r?.total ?? 0
      }
      const maxScore = Math.max(...Object.values(scores))
      const best = Object.entries(scores).filter(([,v]) => v === maxScore)
      const bestLabel = best.length === cols.length ? 'Tie' : best.map(([k]) => k).join(',')
      if (best.length < cols.length) best.forEach(([k]) => wins[k]++)
      const shortName = tc.name.replace('Test ', 'T').slice(0, 42)
      console.log(`  ${shortName.padEnd(42)} | ${cols.map(c => String(scores[c]).padEnd(10)).join(' | ')} | ${bestLabel}`)
    }
    console.log(`\n  Wins: ${cols.map(c => `${c} ${wins[c]}`).join(' / ')}`)
  }
}

main().catch(console.error)
