# Backlog 1: Switch to LegiScan API

## Context
CapitolKey currently uses Congress.gov API v3 for all federal bill data. The backlog calls for migrating to LegiScan, which covers both federal (US Congress) and all 50 state legislatures — enabling backlog item 2 (state legislation) as a follow-up.

## Prerequisite
**Daniel needs a LegiScan API key.** Sign up at https://legiscan.com/legiscan or https://legiscan.com/civic_api. Add `LEGISCAN_API_KEY` to `.env` and Railway env vars.

## Data Mapping: LegiScan → Existing Frontend Format

LegiScan `search` response fields → current bill object:
| Frontend field | Congress.gov source | LegiScan source |
|---|---|---|
| `congress` | `bill.congress` | Derive from session (119th = current) |
| `type` | `bill.type` (lowercased) | Parse from `bill_number` (e.g. "HB1234" → "hb") |
| `number` | `bill.number` | Parse from `bill_number` |
| `title` | `bill.title` | `title` |
| `originChamber` | `bill.originChamber` | Derive from bill type prefix (H=House, S=Senate) |
| `latestAction` | `bill.latestAction.text` | `last_action` |
| `latestActionDate` | `bill.latestAction.actionDate` | `last_action_date` |
| `url` | `bill.url` | `url` (LegiScan page) |

LegiScan `getBill` response → detail page fields:
- `bill.sponsors[]` → sponsor info (name, party, etc.)
- `bill.texts[]` → doc_id for fetching bill text via `getBillText`
- `bill.description` → short description (new field, useful)

LegiScan `getBillText` → bill text cache:
- Returns base64-encoded `doc` field with `mime` type
- Need to decode and convert (HTML/PDF → plain text)

## Files to Modify

### `api/server.js` (~800 lines, all changes here)

1. **Constants & config** (top of file)
   - Add `LEGISCAN_BASE = 'https://api.legiscan.com/'`
   - Add `LEGISCAN_API_KEY` from env
   - Add helper: `legiscanRequest(op, params)` — builds URL, calls fetch, returns JSON

2. **`POST /api/legislation`** (lines 206-300)
   - Replace Congress.gov search with LegiScan `search` endpoint
   - Use `state=US` for federal, `year=2` for current session
   - Map each search result to existing bill object format via `transformLegiScanBill()`
   - Keep same dedup + sorting logic
   - Keep same interest-weighted search term strategy (INTEREST_MAP unchanged)

3. **`GET /api/bill/:congress/:type/:number`** (lines 303-319)
   - This is tricky — currently uses congress/type/number URL params
   - Option A: Add a parallel route `GET /api/bill/legiscan/:billId` for LegiScan bills
   - Option B: Accept a `billId` query param that triggers LegiScan `getBill` instead
   - **Decision:** Add `legiscan_bill_id` to the bill object from search results. When present in the frontend, pass it as a query param. The detail endpoint checks for `?legiscan_id=` first; if present, uses `getBill` instead of Congress.gov. This avoids changing URL structure.

4. **Bill text fetching** (lines 1168-1214)
   - `fetchBillTextFromCongress()` → rename to `fetchBillTextFromSource()`
   - Add `fetchBillTextFromLegiScan(billId)`:
     1. Call `getBill` to get `texts[]` array with doc_ids
     2. Call `getBillText` with latest doc_id
     3. Decode base64 `doc` field
     4. If HTML mime, strip HTML (reuse existing `stripHtml()`)
     5. If PDF mime, extract text or skip (PDF extraction is complex — fall back to description)
   - Update `fetchBillContent()` to route based on source

5. **Personalization** (lines 322-647)
   - No structural changes needed — it just receives bill text + metadata
   - Update source attribution: "LegiScan" instead of "Congress.gov"

6. **Cron job** (`checkBillUpdates`, lines 886-1070)
   - Replace Congress.gov status check with LegiScan `getBill`
   - Compare `last_action` + `last_action_date` (same logic, different source)

7. **Cache keys**
   - Current: `bill-${congress}-${type}-${number}`, `bt-${congress}-${type}-${number}`
   - Add LegiScan variant: `bill-ls-${billId}`, `bt-ls-${billId}`
   - Bump personalization cache key prefix to v4

### `src/pages/BillDetail.jsx`
- Pass `legiscan_bill_id` as query param when navigating to detail
- Read it from URL and pass to API call

### `src/pages/Results.jsx`
- No changes needed (bill object shape stays the same)

### `src/components/BillCard.jsx`
- No changes needed

### `src/lib/api.js`
- Update `fetchBillDetail()` to pass `legiscan_id` query param if available

## Implementation Order

1. Add LegiScan helper + env var
2. Create `transformLegiScanBill()` mapping function
3. Replace `/api/legislation` search with LegiScan `search`
4. Update `/api/bill/:congress/:type/:number` to support `?legiscan_id=`
5. Add `fetchBillTextFromLegiScan()` and update routing
6. Update cron job
7. Update frontend to pass `legiscan_bill_id` through
8. Update cache key prefixes
9. Test end-to-end

## Verification
- `npm run dev` — confirm bills load on Results page
- Expand a bill card — confirm personalization works with LegiScan text
- Click into bill detail — confirm metadata loads
- Check server logs for LegiScan API calls succeeding
- Verify caching works (second load should be faster)
