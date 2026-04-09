# CapitolKey Backend — Full Systemic Bug Hunt

## Mission

Find every bug in the CapitolKey backend that could:

1. Harm a user (wrong data, data leak, PII exposure, account takeover, privacy violation, bad advice on civic action)
2. Crash or degrade the service (OOM, unbounded resource use, deadlock, infinite retry, request queue collapse)
3. Cost money (paid API abuse, quota exhaustion, inbox flood, DB bloat, egress fees)
4. Produce silently wrong data that looks correct (the scariest category — these ship to production and stay there)
5. Break at a known or unknown future point in time (time-decay constants, schema migrations, upstream API changes)
6. Open a vector for abuse by a motivated attacker or a curious teenager (it's a high-school app — assume the users are clever, bored, and will poke at things)

You are not restricted to a checklist. The checklist below is a floor, not a ceiling. If you find a category of bug that isn't listed here, report it and name the category.

## Stack context

- **Runtime:** Node.js + Express on Railway. `api/server.js` is ~2700 lines and contains every endpoint.
- **Database:** Supabase (Postgres + Auth + RLS). Service-role key bypasses RLS.
- **LLM:** Claude API (Haiku 4.5) via direct HTTP. No SDK.
- **Legislative data:** LegiScan (paid quota).
- **Email:** Resend. Configured `from` is currently `RESEND_FROM`.
- **Push:** Firebase Cloud Messaging V1 via `GoogleAuth`.
- **Frontend:** React + React Router + Vite, wrapped in Capacitor for iOS/Android. The web app is hosted on Vercel. The iOS app ships through the App Store.
- **Anonymous users** are first-class citizens — the entire flow works without auth, with profile in sessionStorage. Log-in is an upgrade, not a gate.
- **Environment:** `CONGRESS_API_KEY`, `ANTHROPIC_API_KEY`, `LEGISCAN_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, `FCM_SERVICE_ACCOUNT`, `FRONTEND_URL`.

Before reporting any finding, understand the piece of code you're flagging. Read it in context. Don't flag something you didn't read.

## Two reference bugs (for shape calibration only — not scope)

- **Reference bug A:** a freeform `additionalContext` profile field was interpolated into the Claude prompt. The developer's name appeared in real users' personalizations.
- **Reference bug B:** `gradeToAge()` mapped only numeric grades, so every adult user was told "approximately 16 years old".

These are illustrative. Your job is to find ALL bugs of ANY shape. Do not limit yourself to near-variants of these two.

---

## Phase 0 — Required intermediate artifacts (do these before reporting anything)

Do not skip these. They are the scaffolding that makes the audit complete rather than spot-checky. Produce each one as you go, in your working notes. You do not need to show them in the final report unless they're load-bearing for a finding.

### 0.1 Endpoint inventory

List every `app.(get|post|put|delete)` route in `api/server.js` (there are ~20). For each one, record:

- Path and method
- Auth: none / optional / required
- Rate limiter: which one (or none)
- Input fields (body, query, params) and their validated types
- External APIs called (Anthropic, LegiScan, Resend, FCM, Supabase tables)
- Response shape
- Cache read/write behavior
- Side effects (DB writes, emails, pushes)

This inventory is the map. You will check invariants on it in later phases.

### 0.2 Data model inventory

Read `supabase/*.sql`. List every table, every column, every index, every FK, every RLS policy. Note which tables the backend writes to via service-role key (bypassing RLS) and which it writes through user-scoped clients.

Then find a mismatch: a column the code reads/writes that isn't in the schema, or a schema column the code doesn't use, or an FK that can cascade in a surprising way, or an index that's obviously missing for a hot-path query.

### 0.3 UI ↔ backend enum delta

Read every form in `src/pages/` and every constant in `api/server.js`. Produce a table: `Enum | UI emits | Backend validator accepts | Downstream logic handles`. Any cell where "UI emits" isn't a subset of "Downstream handles" is a priority-0 finding.

### 0.4 Trust boundary diagram

For each endpoint, identify what input is attacker-controlled (everything in `req.body`, `req.query`, `req.params`, `req.headers`, and anything derived from an external API response). For each such input, trace it to every sink — Claude prompts, SQL queries, email bodies, email headers, log lines, filesystem paths, HTTP requests — and verify it's validated, escaped, or typed correctly at each sink.

### 0.5 Invariants list

Write down 10 invariants the system should maintain. Examples:

- "User A can never see a personalization generated for user B's profile."
- "A bookmark row's `user_id` always matches the authenticated user at write time."
- "Every personalization in the cache has a `profile_hash` that covers every field used to generate it."
- "The in-memory cache can never grow beyond a fixed size."
- "An email can never be sent with a user-controlled Subject header containing a newline."
- "Rate limiters cannot be bypassed by rotating tokens or IPs in a way the limiter normalizes against."
- "Every paid API call is bounded by a limiter that protects us from a single-user runaway."
- "The system behaves correctly when the calendar year rolls over."
- "The system behaves correctly when Supabase is unreachable."
- "The system behaves correctly when Claude returns a non-JSON response."

Now, for each invariant, ask: *where in the code could this break, and does it?* Each broken invariant is a finding.

### 0.6 State machine sketches

Are there any implicit state machines? (bookmarks have a `last_known_action`; notifications have a subscription state; rate limit buckets have state; cache entries have lifecycle). For each, draw the legal transitions and look for places the code can land the entity in an illegal state.

---

## Phase 1 — Correctness bugs

### Logic errors

- Off-by-one in slices, splits, index math, date ranges, pagination
- Wrong comparison operator (`<` vs `<=`, `==` vs `===`, `!` precedence in `!a || b`)
- Wrong variable used (copy-paste bugs — same-named field in inner and outer scope)
- Boolean coercion bugs (`0` and `''` falsy; `[]` and `{}` truthy)
- Array `.sort()` without a comparator on numbers
- `parseInt` without radix
- `Date` math on string inputs
- Regex that doesn't anchor or escape what it needs to

### Duplicated transforms drifting apart

Find every pair of functions that do "the same" transform (e.g., multiple `transform*Bill` functions, multiple normalization helpers, multiple prompt builders). Diff them. A bug fix applied to one path and forgotten on the others is a common way for the same class of bug to persist.

### Business logic vs. product rules

Read `CLAUDE.md` for the product description. Is the code actually implementing what the product says it does? Specifically check:
- Is personalization nonpartisan as the system prompt claims? (read the prompt end-to-end)
- Is civic_actions actually limited to real URLs? Does the frontend verify this, or is the prompt the only guardrail?
- Does the app gracefully degrade when external APIs are down, as CLAUDE.md claims?

---

## Phase 2 — Security

### Authentication & authorization

- Any endpoint that reads or writes user data without verifying the authenticated user owns it (IDOR)
- Any `.eq('user_id', something)` where `something` came from `req.body` or `req.params` instead of `user.id` from the verified token
- Any endpoint that trusts a client-supplied user ID, email, or name
- JWT verification: are tokens actually verified, or just parsed? Where does signature validation happen?
- Token expiry handling: what happens when a Supabase access token expires mid-request?
- Session fixation / token reuse after password change: can a user with a stolen token still act after the victim rotates credentials?
- Anonymous → authenticated upgrade: does any anonymous data get attributed to the wrong user during the merge?

### Injection

- **SQL injection:** Supabase's query builder is parameterized, but raw RPC calls, `.or()` filters with user input, and `.filter()` string construction are not always safe. Grep for `supabase.rpc(`, `.or(`, `.filter(`.
- **Prompt injection:** every user-controlled string that reaches a Claude prompt is a vector. Check escaping and explicit "treat as untrusted" guardrails.
- **Email header injection:** newlines in Subject, From, Reply-To, To. Grep for `resend.emails.send` and check what's interpolated into header fields.
- **HTML injection in emails:** is any user-controlled text interpolated into `html` without escaping? Look at `emailTemplates.js`.
- **Log injection:** user-controlled strings in log lines can corrupt log parsing. Low severity, still worth flagging.
- **Command injection:** grep for `child_process`, `exec`, `spawn`.
- **Path traversal:** grep for `fs.readFile`, `fs.createReadStream`, and any path derived from user input.
- **SSRF:** any `fetch(`, `axios(`, `request(` where the URL is derived from user input — even partially (e.g., a bill ID used to construct a LegiScan URL). Could a crafted ID hit an internal service?
- **Regex DoS:** grep for user-controlled strings passed to `new RegExp(` or as the haystack of a catastrophic-backtracking regex.

### Secrets & information disclosure

- Are any secrets logged? Grep for `console.log` near `process.env`, `key`, `token`, `password`.
- Do error responses leak stack traces or internal paths to the client?
- Does the client ever receive another user's data in an error message ("user X already exists")?
- Are Supabase service-role keys bundled into the frontend? (grep `SUPABASE_SERVICE_KEY` in `src/`)
- Does the feedback endpoint email back what the attacker sent, creating a trivial data reflection?

### CORS, CSRF, rate limiting

- Is the CORS allowlist tight, or does it reflect any origin?
- Is there a `*` in `Access-Control-Allow-Origin` on any response?
- Does any endpoint perform a state-changing action with a GET request?
- Can rate limiters be bypassed by rotating tokens (each forged JWT gets its own bucket) or by IPv6 subnet hopping?
- Does the rate limiter key normalize away the bypass?

### Authentication flows specific to this app

- The Capacitor iOS app uses `capacitor://localhost`. Is that origin trusted with the same level of privilege as the web app? Should it be?
- OAuth Google sign-in: is the redirect URL locked down?
- Account deletion: does it actually delete everything, or leave orphaned rows that could re-attach to a recycled user ID?

---

## Phase 3 — Data integrity

### Transaction boundaries

- Any place where two or more Supabase writes should be atomic but aren't? If the second write fails, is the first one rolled back or left dangling?
- Upserts that compose a primary key from user input: can two racing requests create duplicate or merged rows?
- Counter increments: is there a race between read-modify-write? Are any of them actually using `rpc` or `increment` atomically?

### Foreign keys & orphans

- Does every FK have `on delete cascade` where the intent is cleanup, or `on delete restrict` where the intent is safety? Check that account deletion actually cascades (see Phase 2 auth).
- Any table that stores a denormalized copy of data from another table: is that copy kept in sync?

### Idempotency

- POST endpoints that don't check idempotency: can a retry (from the client or from an intermediate proxy) produce a duplicate? Specifically check bookmarks, interactions, feedback, push token registration, notification subscription.

### Time & timezone

- Any timestamp stored without timezone info?
- Any date comparison that assumes local time on the server vs. the client?
- Any cron schedule that's ambiguous between UTC and local time?
- Any "today" computation using `new Date().toISOString().slice(0, 10)` that's wrong for users in non-UTC time zones?

---

## Phase 4 — Concurrency & async

- Any `async` function that doesn't `await` a promise it should (fire-and-forget where the caller needs the result)?
- Any unhandled promise rejection? Run the mental process-warning check: does every `.then()` have a `.catch()`?
- Shared module-level state written from request handlers without locking — can two concurrent requests produce inconsistent state?
- `setTimeout` / `setInterval` that leaks if the request aborts?
- Promise.all where one rejection should cancel the rest but doesn't?
- Race between cache read and cache write on the same key (thundering herd)?
- Any place where `await`'d code reads a value that could have been mutated by another concurrent request between lines?
- TOCTOU: "check if it exists, then create it" patterns that aren't atomic.

---

## Phase 5 — Error handling

### Swallowed errors

Every `catch {}` or `.catch(() => {})`. For each: does the suppressed error cause the user to receive stale, wrong, or silently missing data on an apparent success? Upgrade to at least a warn log if yes.

### Wrong status codes

- 500 when it should be 400 (validation errors) or 401 (auth errors) or 404 (not found)
- 200 with `{error: "..."}` in the body (frontend treats these as success)
- Empty 200 responses that the frontend interprets as data

### Retry storms

Every retry loop: is there a cap? Is there jittered backoff? Can a retry storm against a downstream amplify a transient failure into a permanent one?

### Panic recovery

Does the process crash on uncaught exceptions and let Railway restart it, or does it limp along with corrupted state?

---

## Phase 6 — Resource leaks & bounds

- Any `Map`, `Set`, `Array` at module scope written from request handlers without a size cap
- File handles, DB connections, fetch AbortControllers: are they released on error paths?
- `setInterval` cron jobs: do they clear themselves? Can they pile up if a run takes longer than the interval?
- Event listeners that are added per request on a shared EventEmitter (memory leak classic)
- Claude streaming responses: are they fully consumed even on error?
- Bill text cache: is the stored text size bounded? A multi-megabyte bill text × thousands of rows is a real DB bloat risk.

---

## Phase 7 — External API contracts

For each external API (Anthropic, LegiScan, Resend, FCM, Supabase):

- Timeout set on every call?
- Retry policy safe (cap + backoff + jitter)?
- Response shape checked before access? (`data.content[0].text` crashes if `data.content` is undefined)
- Error response understood? (some APIs return 200 with an error in the body)
- Rate limit headers read and respected?
- API version pinned? (Anthropic uses `anthropic-version: 2023-06-01` — verify this is current and that the code doesn't rely on removed fields)
- Model name pinned? (`claude-haiku-4-5-20251001` is in the code — verify it's not deprecated)
- Does the caller assume the upstream will eventually respond? What happens if it hangs forever?

---

## Phase 8 — Caching

For every cache (in-memory Map, Supabase cache table, HTTP cache headers):

- **Key completeness:** does the key include every input the response depends on? Anything missing is a cross-user leak risk.
- **Key stability:** do two logically-equal inputs produce the same key? (sorted arrays, normalized casing, trimmed whitespace)
- **Version bumps:** when a key format changes, are old entries cleaned up, orphaned, or dual-read? Dual-read is a leak risk if the old format was less isolating.
- **TTL correctness:** are degraded/error results cached? Is successful-but-stale data served beyond its TTL?
- **Negative caching:** does "not found" get cached? For how long? Does it hide a recovery?
- **Thundering herd:** when a hot key expires, do 100 concurrent requests all miss and all hit the upstream?
- **Poisoning:** can a user write a value that gets served to other users?
- **Unbounded growth:** see Phase 6.

---

## Phase 9 — Input validation

For every endpoint handler's input:

- Is `req.body` assumed to be an object? (`const { x } = req.body` crashes when `req.body` is undefined)
- Are all string fields type-checked before `.trim()`, `.length`, `.slice()`?
- Are all array fields type-checked before `.map()`, `.filter()`, `.some()`?
- Are all numeric fields type-checked before arithmetic?
- Length caps on every string?
- Enum fields validated against a closed set?
- Deep objects validated recursively?
- Does the validator run BEFORE the expensive work (LLM call, DB write, external API hit)?

---

## Phase 10 — Output safety

- Does any response include data from another user?
- Does any error message include internal paths or stack traces?
- Does any log line include PII (email, full name, location, age) in plaintext?
- Does any response header include unsanitized user input?
- Are any Set-Cookie headers used, and are they HttpOnly + Secure + SameSite?

---

## Phase 11 — Deployment & environment

- Are there any hardcoded URLs pointing to dev / staging / localhost that leak into production?
- Are there any `process.env.X` accesses that crash if `X` is missing, with no startup check?
- Are there dev-only endpoints (`/test`, `/debug`, `/admin`) not gated by `NODE_ENV`?
- Are there `console.log` lines that dump sensitive data in production?
- Is `trust proxy` set correctly so that `req.ip` is the real client IP through Railway's proxy?
- Does CORS match the actual frontend origin in production, or does it still have a dev placeholder?

---

## Phase 12 — Time-decay constants

Grep for hardcoded years, congress numbers, session numbers, version strings, "current year" style constants, deprecation dates, API version strings.

For each, answer: "when does this become wrong?" Flag anything that will break on a specific future date.

Check:
- The 119th Congress number (already fixed, verify)
- Hardcoded year 2024/2025/2026 in any file
- Model names (will be deprecated)
- API version strings
- Cron schedules that assume a specific UTC offset
- `next(year)` calculations

---

## Phase 13 — Mobile / Capacitor specifics

- Does the app work when the Capacitor bridge is unavailable (web build) and vice versa?
- Does offline mode show stale data without warning the user it's stale?
- Are push tokens cleaned up on logout? On app uninstall? On token rotation?
- Does the app handle the iOS "low data mode" / cellular restriction gracefully?
- Does deep-linking from a notification route to the right page after cold start?
- Are there iOS vs Android behavior forks that one of them has fallen out of sync with?

---

## Phase 14 — Adversarial / chaos thinking

Pick 5 user personas and mentally walk them through the app. For each, find the first bug they'd hit.

1. A user with a profile containing every valid field filled in with hostile content (quotes, newlines, very long text, emoji, right-to-left override characters, null bytes).
2. A user on a flaky 3G connection whose requests partially succeed and need to be retried.
3. A user who changes their profile mid-session between two personalize requests, with a cached result from the old profile still in memory.
4. An attacker who registers 100 accounts and tries to exhaust the paid API quota.
5. An attacker with a valid Supabase anon key who tries to bypass the backend entirely and hit Supabase directly.

For each, write what goes wrong and at what line.

---

## Phase 15 — Unknown-unknown generator

This is the most important phase and the one most audits skip.

Pick 10 random functions in `api/server.js` (literally random — use line numbers from a rough hash). For each function, list every assumption it makes:

- What types does it assume its inputs have?
- What range of values does it assume?
- What state does it assume exists in the world (DB rows, cache entries, env vars)?
- What ordering does it assume?
- What it assumes doesn't change between calls?
- What it assumes about the caller?
- What errors it assumes won't happen?

Now, for each assumption, write down what would happen if the assumption were violated. If the answer is "silently wrong data" or "crash" or "cost money" or "leak data", that's a finding.

This is the method for finding bugs that nobody has thought to look for.

---

## Output format — per finding

**[Severity] — one-sentence description**
- **Category:** from the phase list (or a new one you invented)
- **File:line:** exact location (or lines, if it's a cross-reference bug)
- **Trigger:** what input / timing / state causes the bug to manifest
- **Impact:** what a real user or the business actually loses
- **Evidence:** a 1–3 line quoted excerpt or a specific repro
- **Why it was missed in review:** one line — this is the training signal for future audits
- **Fix sketch:** one or two sentences, no need for a full patch

## Severity rubric

- **Critical** — PII leak across users, cross-user data bleed, auth bypass, prompt injection on a production LLM endpoint, unauthenticated abuse vector that costs significant money, RCE, SQL injection, a bug that has already harmed users in production.
- **High** — systematically wrong data for a class of real users, unbounded memory/quota leak that will crash the service, time-decay constant that will break on a known future date, any bug that would be embarrassing to find in press coverage.
- **Medium** — wrong data for an edge case, silent validation hole that will turn into tomorrow's critical, missing rate limiter on an endpoint that isn't yet abused, an invariant that holds today but only by accident.
- **Low** — minor correctness edge case, cosmetic wrong output, stale comment on live code, dead code that could mislead a future reviewer.

Prioritize by user impact and blast radius, not by ease of fixing.

## Do NOT report

- Style nits, missing comments, unused imports, JSDoc gaps, `const` vs `let`, function extraction suggestions
- Speculative "this could be clearer" refactors
- Performance optimizations that aren't user-observable under realistic load
- Test coverage suggestions, unless a specific test would have caught a specific bug you found
- "You could use a library for this" (unless the handrolled version has an actual bug)
- Security theater ("add a CSP even though the frontend is Capacitor")

## Closing sections (mandatory)

1. **Top 5 list** — the highest-impact findings, in priority order, with one-line justifications.
2. **Unifying pattern** — one or two sentences describing the common class of mistake that links your top findings. If you can't name a unifying pattern, go back and look harder.
3. **Unknown-unknown section** — findings that came from Phase 15 (random-function assumption breaking) specifically. These are the ones a normal code review would never catch, and they're the reason to rerun this audit regularly.
4. **Confidence statement** — what you read, what you skimmed, what you didn't touch, and what a follow-up audit should cover. Be honest about your coverage. A thorough "I didn't look at X" is more useful than a shallow "all clear".

---

## Instructions for the auditor

- Read CLAUDE.md first for product context and user instructions.
- Run this audit end-to-end. Don't bail after finding three bugs — keep going.
- When you find a bug, resist the urge to "just fix it" — log the finding and continue. The point is to find EVERYTHING in one pass, not to ship a single fix.
- Use subagents for parallel reading of large files if your context window is under pressure, but keep synthesis in the main thread.
- Treat this prompt as a floor. If you see a bug category I didn't list, report it and name the category.
- The answer is never "the code looks fine." It isn't. Find the bugs.
