# Bill Search Feature

## Context
Users currently only see bills curated by their interests (via `/results`). There's no way to search for specific bills by keyword. This feature adds a dedicated search page at `/search` that lets any user (anonymous or logged in) find bills via free-text search powered by LegiScan.

## Changes

### 1. Backend: `GET /api/search` endpoint
**File:** `api/server.js` (add after `/api/legislation` at ~line 394)

- `GET /api/search?q=<query>&page=1&state=US`
- Validates query (2-200 chars), state (against existing `US_STATES`), page (1-20)
- Calls `legiscanRequest('search', ...)` and transforms results via existing `transformLegiScanBill` / `transformLegiScanStateBill`
- Deduplicates by `legiscan_bill_id`, sorts by recency
- Returns `{ bills, pagination: { page, totalResults, hasMore } }`
- Uses existing in-memory cache + `legislationLimiter`

### 2. Frontend: Search page
**New files:** `src/pages/Search.jsx` + `src/pages/Search.module.css`

- URL-driven: reads `q` from `useSearchParams` so searches are shareable/back-button friendly
- Search input + submit button at top
- Results rendered with existing `BillCard` component
- Loading skeletons, empty state, error state
- "Load more" button for pagination
- If user has a profile in sessionStorage, batch-personalizes results (same pattern as Results.jsx)
- Bookmark support for logged-in users (same pattern as Results.jsx)

### 3. Route + Navigation
**Files:** `src/App.jsx`, `src/components/Nav.jsx`

- Add lazy-loaded `/search` route in App.jsx
- Add "Search" link in Nav's `.auth` section (visible to all users, not just logged-in)
- Add "Search bills" item in hamburger dropdown menu

## Files to modify/create
- `api/server.js` — new GET `/api/search` endpoint
- `src/pages/Search.jsx` — new page (new file)
- `src/pages/Search.module.css` — styles (new file)
- `src/App.jsx` — add lazy import + route
- `src/components/Nav.jsx` — add search link in nav bar + dropdown

## Verification
1. `npm run dev` to start both servers
2. Navigate to `/search`, type a query, verify results appear
3. Test empty query validation, no-results state, load more pagination
4. Test with a profile set (verify personalization runs) and without (verify bills show without analysis)
5. Test bookmark toggle for logged-in users
6. Verify search link appears in nav for both anonymous and authenticated users
