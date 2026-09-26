# LegiScan from 2026-10-01: ops runbook

LegiScan emailed the account on 2026-09-23 about changes to the Public API. From **2026-10-01**:

| Limit | Before | From 2026-10-01 |
|---|---|---|
| Monthly queries | 30,000 | **10,000** |
| Rate | — | **~2 requests/second**, sliding window |
| Keys | one per user (stated) | one per user, **audited**; violators **permanently banned from 2026-11-01** |
| Attribution | CC BY 4.0 (stated) | CC BY 4.0, **audited**; same ban |

A paid tier ($1,000/yr for 30,000/month) exists. Buying it is out of scope here.

## What the code does now

- **One queue for every LegiScan request.** `api/legiscanClient.js` holds a single queue of start slots, used by both `api/server.js` (`legiscanRequest`) and `api/billSync.js` (catalog and text fallbacks). Request starts are at least **600 ms apart**, which is at most 1.67 req/s. Only the start is serialized, so one slow response doesn't block a student's request.
- **Prewarm is strictly sequential.** `prewarmFeedCache` awaits one search at a time in a plain loop; there is no `Promise.all`. Its text prefetch runs with `concurrency: 1`.
- **Prewarm warms 1 age bucket by default** (`15-16`). Set `PREWARM_AGE_BUCKETS=13-14,15-16,17-18` to warm more.
- **`LEGISCAN_PREWARM_ENABLED`** (default `true`). Set it to `false` to skip prewarm entirely. The skipped run still logs `{"searches":0,"durationMs":0,"skippedBecauseDisabled":true}` and writes a `job_runs` row.
- **The catalog runs whenever `LEGISCAN_API_KEY` is set.** It used to be skipped silently when `OPENSTATES_API_KEY` was missing.
- **One key only.** There is one `LEGISCAN_API_KEY` for everything. **Never add a second key for prewarm or scripts.**
- **Attribution.** `src/pages/Terms.jsx` and the "Data sources and credits" section of `src/pages/About.jsx` credit LegiScan under CC BY 4.0, and also credit Congress.gov and Open States.

## Budget math

| Consumer | Calls | Per month |
|---|---|---|
| Daily catalog `getMasterList`, 51 jurisdictions at `0 5 * * *` | 51/day | **≈1,530** (states with closed sessions still cost the call, then get skipped) |
| Prewarm searches at `0 11 * * 1-5` | ≤ 5 interest pairs × 6 terms = **≤30/run** | **≤ ~660** (22 weekdays) |
| Prewarm text prefetch (`getBill` / `getBillText` on cache misses) | variable; the Supabase text cache absorbs repeats | unknown; see `job_runs.stats.legiscanCalls` |
| Runtime: bill detail with `?legiscan_id=`, search, classroom pins | traffic-driven | unknown; see `/api/admin/quota` |

The earlier estimate of "5 × 3 age buckets × 6 ≈ 1,980/month" overstated prewarm. The search cache key does not include age, so the 2nd and 3rd buckets were already served from the in-memory cache. Cutting to one bucket mainly saves work; it does not save LegiScan calls. The big win is the serialization, which prevents 2 req/s bursts.

**What prewarm actually buys.** New profiles send a numeric age (for example `16`) and a required state, so the live feed's cache key (`ls-bills-…-16-CT`) never matches prewarm's keys (`ls-bills-…-15-16-US`). Prewarm's real effect is warming the Supabase search cache (6 h TTL) and bill-text cache. So **disabling prewarm is low-risk**; that is why it is the first thing to turn off.

## Watching it

```bash
curl -sS -H "x-admin-token: $ADMIN_SECRET" https://capitolkey.org/api/admin/quota
curl -sS -H "x-admin-token: $ADMIN_SECRET" "https://capitolkey.org/api/admin/jobs?hours=48"
```

**`/api/admin/quota`** returns:

- `legiscan.monthToDate` holds `count`, `byOp`, `http429`, `fractionOfLimit`, `alert60` and `alert85`. The count comes from this process only. If `complete` is `false`, the process restarted mid-month and `count` is a lower bound for the month, not the full total.
- For history across restarts, add up `stats.legiscanCalls` over this month's `job_runs` rows (in the SQL editor), plus your estimate of runtime traffic.

**Alert thresholds:**

- **60% (6,000):** review usage.
- **85% (8,500):** disable prewarm (below).

## If you see 429s or reach 85%

1. **Disable prewarm first. Keep the catalog.** The catalog drives amendment detection for state bills; prewarm is a cache nicety. In Railway:
   - Open the project, then the backend service, then **Variables**.
   - Add `LEGISCAN_PREWARM_ENABLED` = `false`.
   - Railway redeploys automatically. No code change is needed.
2. Confirm the effect: the next weekday's `job_runs` row for `prewarm` should show `"skippedBecauseDisabled": true`, and `/api/admin/quota` should show `prewarm.enabled: false`.
3. If 429s continue, check `legiscan.monthToDate.byOp` to see which op is heavy. Also check that Railway runs **exactly one replica**. Every replica runs every cron, which doubles all scheduled traffic.
4. Only then consider the paid tier. That is a human decision and out of scope for code.

To re-enable, delete the variable or set it to `true`.

## Things not to do

- Don't add a second LegiScan key.
- Don't remove the attribution text.
- Don't lower `LEGISCAN_MIN_INTERVAL_MS` below 500.
- Don't scale the Railway backend beyond one replica while the crons live in the web process.
