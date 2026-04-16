# Gemini breadth-first audit prompt

Copy the block below into Gemini when you're ready for the next review pass.

---

```
We just wrapped 6 rounds of peer review on CapitolKey's LLM personalization
pipeline — cache bifurcation, RAG ranking, status-bucket invalidation,
fail-open fallback, bookmark staleness, TTL cleanup, sync-time JSONB
precomputation. That stack is shipped and production-ready.

Pivot: I want you to audit everything ELSE in the codebase with the same
rigor you applied to the cache pipeline. Assume the personalization layer
is solved. Press on the parts I haven't stress-tested.

CONTEXT
CapitolKey is a nonpartisan civic-education app that personalizes U.S.
legislation for high-school students. Stack: React 18 + Vite frontend,
Node/Express backend, Supabase (Postgres + Auth), Anthropic Claude API for
personalization with Groq Qwen3-32B primary / Claude Haiku fallback,
Capacitor 8 for iOS+Android, Resend for email, FCM for push. Deployed on
Vercel (frontend) + Railway (backend) + Supabase Cloud.

Primary endpoints beyond /api/personalize*:
- POST /api/legislation — interest-weighted bill fetching from bills table
- GET /api/bill/:congress/:type/:number — single bill detail
- POST /api/interactions — tracks view/bookmark/share events
- POST /api/notifications/preferences — email + push prefs
- /api/share-post — generates advocacy drafts for social sharing
- Bill sync jobs pulling from Congress.gov + LegiScan + OpenStates

User flow: anonymous browsing via sessionStorage → optional sign-in
(Google OAuth or email/password) → profile capture (grade, state,
interests, subInterests, career, familySituation, employment, additional
context) → personalized feed → detail view → bookmark/share/civic-action.

Classroom features: teachers can create classrooms, assign bills, and
students complete assignments. Push notifications fire on bookmarked bill
stage changes.

WHAT I WANT FROM YOU
Spend your review budget on anything I haven't pressed you on yet. Some
areas I suspect are under-audited:

1. AUTH & SESSION SECURITY
   - Anonymous-to-authed profile migration (sessionStorage → Supabase)
   - OAuth token handling, refresh flows, session expiry
   - Rate limiting on unauthenticated endpoints
   - What happens when a user signs out mid-request?
   - RLS policies on Supabase tables — where could they leak across users?

2. BILL SYNC PIPELINE
   - Congress.gov, LegiScan, OpenStates all have different rate limits,
     different data shapes, different change-detection semantics
   - Partial-failure behavior: what if LegiScan returns 500 mid-sync?
   - Duplicate detection across sources (same bill in both feeds)
   - State corpus is growing — schema assumes federal structure
   - Sync-time vs request-time: what's the right boundary?

3. INTERACTION TRACKING & FEED RANKING
   - feed_priority_score is computed nightly — what if a bill goes viral
     intraday and my ranker doesn't see it for 23 hours?
   - bill_interactions grows unbounded — GDPR/COPPA implications for minors?
   - Interest-weighting uses interaction history — cold start for new users?
   - Gaming: can a student (or bot) manipulate their own ranking by
     repeatedly viewing/bookmarking the same bill?

4. CLASSROOM + NOTIFICATIONS
   - Teachers can see students' bookmarked bills — what else can they see?
     Is that boundary documented? Do students know?
   - Push tokens expire, get revoked, multi-device — am I handling all three?
   - Email (Resend) has deliverability, spam-folder, unsubscribe obligations
   - Stage-change notifications: do they rate-limit if 50 bookmarked bills
     all advance on the same day?

5. MOBILE (CAPACITOR) — iOS + ANDROID SPECIFICS
   - Offline behavior: does the app degrade gracefully on no-network?
     (I have an OfflineScreen component but haven't battle-tested the edges)
   - App Store / Play Store review risks around "political content"
   - Background-refresh, push notification permissions, iOS 17+ privacy nutrition
   - What breaks when the user backgrounds the app mid-API-call?

6. DATA INTEGRITY & MIGRATIONS
   - I have 20+ Supabase SQL files — any ordering/dependency issues?
   - Downtime-free deploys when a migration is in flight?
   - Backfill scripts (scripts/backfillStructuredExcerpt.js,
     scripts/backfillSectionTopicScores.js) — idempotency?

7. FRONTEND PERFORMANCE & A11Y
   - First-contentful-paint on the feed when cache is warm vs cold
   - Lighthouse a11y score — I've never run it
   - Screen-reader semantics for the feed cards
   - React component key stability (anti-pattern: using array index)

8. LEGAL / POLICY SURFACE (I'm a high-school student, not a lawyer)
   - COPPA implications — do I collect from users under 13? How do I enforce?
   - FERPA when teachers create classrooms with student accounts
   - "Nonpartisan" claim auditability — how do I prove I'm not injecting bias
     through interest-weighting or subtle prompt phrasing?
   - Accessibility law (ADA / WCAG 2.1 AA) exposure
   - Bill-text reproduction — is my ~6K char excerpt fair use?

9. ANYTHING ELSE I'M NOT SEEING

Pick the 3-4 areas you think have the highest blast radius given the
context above. Don't try to cover all 9 — focus on the things that could
either (a) break the app at scale, (b) create legal/PR exposure, or
(c) harm students directly. For each area you pick, give me:

- The specific trap I'm likely to step on
- The concrete fix, not a general principle
- A rough severity rating (crash-the-app / legal-exposure / UX-paper-cut)

Don't be polite. Press hardest on the things that would embarrass me at
launch.
```

---

## How to use this

1. Paste the fenced block into Gemini
2. When it responds, resist the urge to run 6 rounds
3. Extract the top 3 concrete fixes, ship them, move on
4. If Gemini skips the legal/policy section (#8), push back explicitly — that's the highest-severity area since you're 17 and processing minors' data
