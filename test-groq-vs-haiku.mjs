/**
 * Multi-bill test: Qwen3 32B (Groq) quality evaluation
 * Runs 5 diverse bills × different student profiles to stress-test output quality.
 *
 * DO NOT COMMIT API KEYS — uses env variable only.
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY
if (!GROQ_API_KEY) {
  console.error('Missing GROQ_API_KEY env variable. Run with:\n  GROQ_API_KEY=gsk_... node test-groq-vs-haiku.mjs')
  process.exit(1)
}

const SYSTEM_PROMPT = `You are CapitolKey, a strictly nonpartisan civic education tool. Show ONE specific high-school student how a U.S. bill touches THEIR life — concrete, factual, no opinions.

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

RELEVANCE
9-10: directly changes daily life now (paycheck, school, healthcare)
7-8: affects them within 1-2 years (college costs, job market)
5-6: broader community / future
3-4: tangential via interests or family
1-2: no meaningful connection

OUTPUT — return ONLY this JSON, nothing else:
{
  "headline": "Max 12 words. Single most concrete impact on THIS student. Not a title rewrite.",
  "summary": "2-4 sentences. What the bill actually DOES (cover every operative provision, dates, scope). Why THIS specific student should care — reference their state/job/family/interests directly. Use real numbers from the bill text.",
  "if_it_passes": "1-2 sentences. What SPECIFICALLY changes for THIS student? Concrete: 'your paycheck goes up $X' not 'wages may increase'.",
  "if_it_fails": "1-2 sentences. What stays the same? Make the status quo concrete too.",
  "relevance": "<number 1-10>",
  "topic_tag": "Education | Healthcare | Economy | Environment | Technology | Housing | Civil Rights | Immigration | Community | Other",
  "civic_actions": [
    { "action": "Short imperative title", "how": "One sentence with a specific URL/phone/step.", "time": "5 minutes | 15 minutes | 1 hour" }
  ]
}`

// ── Test cases: 5 diverse bills × different students ─────────────────────────
const TEST_CASES = [
  {
    name: 'Test 1: Minimum Wage × CA Coffee Shop Worker',
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

// ── Run one test case ────────────────────────────────────────────────────────
async function runTest(testCase) {
  console.log(`\n${'═'.repeat(70)}`)
  console.log(`  ${testCase.name}`)
  console.log(`${'═'.repeat(70)}`)

  const start = Date.now()

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
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: testCase.prompt + '\n\n/no_think' }
      ]
    })
  })

  const elapsed = Date.now() - start
  const data = await resp.json()

  if (!resp.ok) {
    console.error(`  ERROR: ${resp.status} — ${data.error?.message || 'Unknown'}`)
    return { name: testCase.name, success: false, elapsed }
  }

  const content = data.choices?.[0]?.message?.content || ''
  const usage = data.usage || {}

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
  } catch (e) { /* parse failed */ }

  // Quality checks
  const checks = {
    jsonValid,
    hasAllFields: parsed ? ['headline','summary','if_it_passes','if_it_fails','relevance','topic_tag','civic_actions'].every(f => f in parsed) : false,
    relevanceIsNumber: parsed ? !isNaN(Number(parsed.relevance)) : false,
    hasCivicActions: parsed?.civic_actions?.length >= 2,
    headlineLength: parsed?.headline ? parsed.headline.split(' ').length : 0,
    noOpinionWords: parsed ? !/(good|bad|important|needed|harmful|great|terrible|crucial|vital)/i.test(JSON.stringify(parsed)) : false,
    hasUrls: parsed?.civic_actions ? parsed.civic_actions.some(a => /https?:\/\//.test(a.how)) : false,
  }

  const passCount = Object.values(checks).filter(v => v === true || (typeof v === 'number' && v <= 14)).length
  const totalChecks = Object.keys(checks).length

  console.log(`  Speed: ${elapsed}ms | Tokens: ${usage.prompt_tokens}→${usage.completion_tokens} | Cost: $${((usage.prompt_tokens * 0.29 + usage.completion_tokens * 0.59) / 1_000_000).toFixed(6)}`)
  console.log(`  Quality: ${passCount}/${totalChecks} checks passed`)

  if (!jsonValid) {
    console.log(`  ❌ JSON PARSE FAILED`)
    console.log(`  Raw (first 300 chars): ${content.slice(0, 300)}`)
  } else {
    console.log(`  ✅ JSON valid | Relevance: ${parsed.relevance} | Tag: ${parsed.topic_tag}`)
    console.log(`  Headline: "${parsed.headline}"`)
    console.log(`  Summary: "${parsed.summary.slice(0, 150)}..."`)
    console.log(`  if_it_passes: "${parsed.if_it_passes.slice(0, 120)}..."`)
    console.log(`  if_it_fails: "${parsed.if_it_fails.slice(0, 120)}..."`)
    console.log(`  Civic actions: ${parsed.civic_actions?.length || 0}`)
    if (!checks.noOpinionWords) console.log(`  ⚠️  OPINION WORDS DETECTED in output`)
    if (!checks.hasUrls) console.log(`  ⚠️  No URLs found in civic_actions`)
    if (checks.headlineLength > 12) console.log(`  ⚠️  Headline over 12 words (${checks.headlineLength})`)
  }

  return { name: testCase.name, success: jsonValid, elapsed, usage, parsed, checks }
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════════════╗')
  console.log('║   CapitolKey Multi-Bill Quality Test: Qwen3 32B via Groq            ║')
  console.log('║   5 bills × different students × diverse topics                     ║')
  console.log('╚══════════════════════════════════════════════════════════════════════╝')

  const results = []
  for (const tc of TEST_CASES) {
    const r = await runTest(tc)
    results.push(r)
    // Small delay to avoid rate limits
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  // ── Final scorecard ──
  console.log(`\n\n${'━'.repeat(70)}`)
  console.log('FINAL SCORECARD')
  console.log(`${'━'.repeat(70)}`)

  const successful = results.filter(r => r.success)
  const totalTime = results.reduce((s, r) => s + r.elapsed, 0)
  const totalIn = successful.reduce((s, r) => s + (r.usage?.prompt_tokens || 0), 0)
  const totalOut = successful.reduce((s, r) => s + (r.usage?.completion_tokens || 0), 0)
  const totalCostGroq = (totalIn * 0.29 + totalOut * 0.59) / 1_000_000
  const totalCostHaiku = (totalIn * 0.80 + totalOut * 4.00) / 1_000_000

  console.log(`\n  JSON parse success: ${successful.length}/${results.length}`)
  console.log(`  Total time (sequential): ${totalTime}ms (avg ${Math.round(totalTime / results.length)}ms per bill)`)
  console.log(`  Total tokens: ${totalIn} in / ${totalOut} out`)
  console.log(`\n  ── Cost comparison (all 5 bills) ──`)
  console.log(`  Qwen3 32B (Groq):  $${totalCostGroq.toFixed(6)}`)
  console.log(`  Claude Haiku:      $${totalCostHaiku.toFixed(6)}`)
  console.log(`  Savings:           ${Math.round(totalCostHaiku / totalCostGroq)}x cheaper with Groq`)

  console.log(`\n  ── Per-test results ──`)
  for (const r of results) {
    const status = r.success ? '✅' : '❌'
    const relevance = r.parsed?.relevance ?? '?'
    const opinionFree = r.checks?.noOpinionWords ? '✓' : '⚠️ opinion'
    console.log(`  ${status} ${r.name.padEnd(50)} | ${r.elapsed}ms | rel:${relevance} | ${opinionFree}`)
  }

  // Check for the low-relevance test
  const defenseTest = results.find(r => r.name.includes('Defense'))
  if (defenseTest?.parsed) {
    const rel = Number(defenseTest.parsed.relevance)
    console.log(`\n  ── Low-relevance check (Defense bill × Art student) ──`)
    console.log(`  Relevance: ${rel} ${rel <= 3 ? '✅ correctly low' : '⚠️ should be ≤ 3'}`)
  }

  console.log(`\n  ── Monthly cost projection (1,000 calls/day) ──`)
  const avgIn = totalIn / successful.length
  const avgOut = totalOut / successful.length
  const dailyCostGroq = (avgIn * 0.29 + avgOut * 0.59) / 1_000_000 * 1000
  const dailyCostHaiku = (avgIn * 0.80 + avgOut * 4.00) / 1_000_000 * 1000
  console.log(`  Groq:  $${(dailyCostGroq * 30).toFixed(2)}/month`)
  console.log(`  Haiku: $${(dailyCostHaiku * 30).toFixed(2)}/month`)
}

main().catch(console.error)
