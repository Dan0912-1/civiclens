# Search Bills Redesign

## Context
The current search page is bare — just a text input + button with no filters. Results are generic because there's no way to narrow by chamber, level (federal/state), or bill number. The UI also looks plain compared to the rest of the app.

## Changes

### 1. Search UI Redesign (`src/pages/Search.jsx` + `Search.module.css`)

**Search card** — Wrap the search form in an elevated white card with shadow, add a search icon (SVG) inside the input, and add a hint line below: "Search by topic, keyword, or bill number (e.g. HR 1234, S 5678)"

**Filter bar** — Below the search card, add:
- **Federal / State toggle** — Two tab-style buttons (reusing the pill/tab pattern from Results page). Federal is default; State sends `state=CT` to the API
- **Chamber filter** — "All", "House", "Senate" pill buttons. Applied client-side by filtering `bill.originChamber`

**Suggestion chips** — In the initial empty state (before first search), show clickable topic chips ("Student Loans", "Climate", "Healthcare", "Gun Policy") that auto-trigger a search

**Results meta** — Update to show active filters: `42 results for "climate" · Federal · House`

**Visual polish** — Amber search button, larger input with icon, better spacing, fade animations

### 2. Backend: Bill Number Search + Relevance (`api/server.js`)

**Bill number detection** — Before the keyword search, detect patterns like "HR 1234", "H.R. 1234", "S 5678", "SB 123" via regex. When detected, search LegiScan with the raw term, then filter results for exact bill_number match and promote it to first position.

**Relevance sort** — Replace pure recency sort with a two-tier sort: bills whose title contains the search term rank first, then by recency. This directly reduces "generic" results.

### 3. Files to modify
- `src/pages/Search.jsx` — Add filter state, tab/pill UI, suggestion chips, search icon, updated meta
- `src/pages/Search.module.css` — Search card, icon, filter bar, tab, chip styles
- `api/server.js` — Bill number detection regex + title-match sort boost in `/api/search` handler (~lines 471-519)

### Verification
- Start dev server (`npm run dev`)
- Test searches: keyword ("climate"), bill number ("HR 1234"), chamber filter, federal/state toggle
- Verify suggestion chips trigger search
- Check mobile responsive layout
- Preview screenshot for visual confirmation
