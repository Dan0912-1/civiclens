# CapitolKey

Nonpartisan civic education platform that personalizes U.S. legislation for high school students. The repo/folder is "civiclens" but the product name is **CapitolKey**.

## Tech Stack

- **Frontend:** React 18 + React Router v6 + Vite (port 5173)
- **Backend:** Node.js + Express (port 3001, `api/server.js`)
- **Database:** Supabase (PostgreSQL + Auth)
- **AI:** Anthropic Claude API for bill personalization
- **Data:** Congress.gov API for legislation
- **Mobile:** Capacitor 8 (iOS + Android)
- **Email:** Resend API
- **Push:** Firebase Cloud Messaging (FCM v1)
- **Deploy:** Vercel (frontend) + Railway (backend) + Supabase Cloud (DB)

## Development

```bash
npm run dev        # Starts Vite (5173) + Express (3001) concurrently
npm run build      # Vite build to dist/
npm run server     # Express backend only
npm run cap:sync   # Build + sync to iOS/Android
```

Vite proxies `/api` requests to `localhost:3001` in dev (see `vite.config.js`).

## Project Structure

```
src/                    # React frontend
  components/           # Nav, BillCard, AuthModal, ErrorBoundary, OfflineScreen
  pages/                # Home, Profile, Results, BillDetail, Bookmarks, About, Privacy, Terms
  context/AuthContext   # Supabase auth (Google OAuth + email/password)
  lib/                  # api.js, supabase.js, userProfile.js, interactions.js, pushNotifications.js
api/
  server.js             # Express backend (~800 lines, all endpoints)
  emailTemplates.js     # Bill status change email HTML
supabase/               # SQL migration files
ios/ android/           # Capacitor native projects
```

## Key API Endpoints (api/server.js)

- `POST /api/legislation` — Fetch bills from Congress.gov (interest-weighted, cached 4hr)
- `GET /api/bill/:congress/:type/:number` — Single bill detail
- `POST /api/personalize` — Claude AI personalization (cached in Supabase)
- `POST /api/interactions` — Track user bill interactions
- `POST /api/notifications/preferences` — Email + push notification prefs

## Database Tables (Supabase)

- `user_profiles` — Student profile (state, grade, interests, etc.)
- `bookmarks` — Saved bills per user
- `personalization_cache` — Cached Claude responses
- `bill_interactions` — View/bookmark tracking
- `notification_subscriptions` — FCM tokens + email prefs

## Environment Variables

Backend: `CONGRESS_API_KEY`, `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `RESEND_API_KEY`, `FCM_SERVICE_ACCOUNT`, `PORT`, `FRONTEND_URL`

Frontend: `VITE_API_BASE_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`

## Design System

- **Colors:** Navy (#0d1b2a), Slate (#2c3e50), Amber (#e8a020), Cream (#f8f4ed)
- **Fonts:** Playfair Display (headings) + DM Sans (body) via Google Fonts
- **Styling:** CSS Modules with custom properties defined in `src/index.css`

## Architecture Notes

- Anonymous users work fully via sessionStorage; login upgrades seamlessly
- Bill fetching is interest-weighted using interaction history
- Claude personalization returns: headline, summary, if_it_passes, if_it_fails, relevance (1-10), topic_tag, civic_actions[]
- Claude system prompt enforces nonpartisan, plain-language, impact-focused responses
- CORS allows capacitor://localhost, Vercel domains, and localhost dev
