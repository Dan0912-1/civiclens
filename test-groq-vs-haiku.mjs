/**
 * Side-by-side test: Qwen3 32B (Groq) vs Claude Haiku
 * Uses the actual CapitolKey system prompt and a realistic bill + student profile.
 *
 * DO NOT COMMIT — contains API key usage. Delete after testing.
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

const USER_PROMPT = `STUDENT PROFILE:
- State: California
- Grade: 11th
- Age: 17
- Interests: Technology, Environment
- Part-time job: Works at a local coffee shop, 15 hrs/week
- Family context: Single-parent household, mom is a nurse

BILL: H.R. 4763 — Raise the Wage Act
SUMMARY (CRS): This bill increases the federal minimum wage from $7.25 per hour to $17.00 per hour over a six-year period beginning in 2025. Specifically, the bill increases the minimum wage to $9.50 in 2025, $11.00 in 2026, $12.50 in 2027, $14.00 in 2028, $15.50 in 2029, and $17.00 in 2030. After 2030, the minimum wage would be indexed to median wage growth. The bill also phases out the subminimum wage for tipped employees, workers with disabilities, and workers under 20 years old over a similar timeframe. The bill applies to all 50 states and territories.

Personalize this bill for the student above.`

// ── Groq (Qwen3 32B) ──────────────────────────────────────────────────────────
async function testGroq() {
  console.log('━━━ Testing Qwen3 32B via Groq ━━━')
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
        { role: 'user', content: USER_PROMPT + '\n\n/no_think' }
      ]
    })
  })

  const elapsed = Date.now() - start
  const data = await resp.json()

  if (!resp.ok) {
    console.error('Groq error:', resp.status, JSON.stringify(data, null, 2))
    return null
  }

  const content = data.choices?.[0]?.message?.content || ''
  const usage = data.usage || {}

  console.log(`Time: ${elapsed}ms`)
  console.log(`Tokens — input: ${usage.prompt_tokens}, output: ${usage.completion_tokens}, total: ${usage.total_tokens}`)
  console.log(`Est. cost: $${((usage.prompt_tokens * 0.29 + usage.completion_tokens * 0.59) / 1_000_000).toFixed(6)}`)
  console.log('\n── Raw output ──')
  console.log(content)

  // Try to parse JSON
  try {
    // Strip markdown fences if present
    let jsonStr = content
    const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (fenceMatch) jsonStr = fenceMatch[1]
    // Also try to find raw JSON object
    const braceMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (braceMatch) jsonStr = braceMatch[0]
    const parsed = JSON.parse(jsonStr)
    console.log('\n── Parsed JSON ── ✅ Valid')
    console.log(JSON.stringify(parsed, null, 2))
    return { parsed, elapsed, usage }
  } catch (e) {
    console.log('\n── JSON Parse FAILED ── ❌')
    console.log(e.message)
    return { raw: content, elapsed, usage }
  }
}

// ── Run ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║   CapitolKey Model Comparison: Qwen3 32B (Groq) Test        ║')
  console.log('╚══════════════════════════════════════════════════════════════╝\n')

  const groqResult = await testGroq()

  console.log('\n\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('SUMMARY')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  if (groqResult) {
    console.log(`\nQwen3 32B (Groq):`)
    console.log(`  Speed: ${groqResult.elapsed}ms`)
    console.log(`  Tokens: ${groqResult.usage.prompt_tokens} in / ${groqResult.usage.completion_tokens} out`)
    console.log(`  JSON valid: ${groqResult.parsed ? '✅' : '❌'}`)
    console.log(`  Est. cost: $${((groqResult.usage.prompt_tokens * 0.05 + groqResult.usage.completion_tokens * 0.40) / 1_000_000).toFixed(6)}`)

    console.log(`\nFor comparison, Claude Haiku would cost:`)
    console.log(`  Est. cost: $${((groqResult.usage.prompt_tokens * 0.80 + groqResult.usage.completion_tokens * 4.00) / 1_000_000).toFixed(6)}`)
    console.log(`  That's ~${Math.round(((groqResult.usage.prompt_tokens * 0.80 + groqResult.usage.completion_tokens * 4.00)) / ((groqResult.usage.prompt_tokens * 0.05 + groqResult.usage.completion_tokens * 0.40)))}x more expensive`)
  }
}

main().catch(console.error)
