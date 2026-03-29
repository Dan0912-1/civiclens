# CivicLens

**Real legislation. Plain language. Personalized to you.**

CivicLens pulls real bills moving through Congress and uses AI to explain how each one affects a specific student's life — based on their state, grade, job status, and interests. Strictly nonpartisan.

---

## Quick Start (Local Development)

### 1. Prerequisites
- [Node.js](https://nodejs.org) v18 or higher — download and install if you don't have it

### 2. Clone / download this project
Put the folder somewhere on your computer.

### 3. Create your `.env` file
In the project root, copy `.env.example` to `.env`:
```
cp .env.example .env
```
Then open `.env` and fill in your real API keys:
```
CONGRESS_API_KEY=your_congress_api_key_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```
**Never commit this file. It's already in `.gitignore`.**

### 4. Install dependencies
Open Terminal, navigate to the project folder, and run:
```
npm install
```

### 5. Run the app
```
npm run dev
```
This starts both the React frontend (port 5173) and the Express backend (port 3001) at the same time.

Open your browser to: **http://localhost:5173**

---

## Project Structure

```
civiclens/
├── api/
│   └── server.js          # Express backend — all API calls live here
├── src/
│   ├── components/
│   │   ├── Nav.jsx        # Top navigation bar
│   │   ├── Nav.module.css
│   │   ├── BillCard.jsx   # Core bill display component
│   │   └── BillCard.module.css
│   ├── pages/
│   │   ├── Home.jsx       # Landing page
│   │   ├── Home.module.css
│   │   ├── Profile.jsx    # Student onboarding form (3 steps)
│   │   ├── Profile.module.css
│   │   ├── Results.jsx    # Bill results + personalization
│   │   ├── Results.module.css
│   │   ├── About.jsx      # About / how it works page
│   │   └── About.module.css
│   ├── App.jsx            # Router
│   ├── main.jsx           # React entry point
│   └── index.css          # Global styles + design tokens
├── index.html             # HTML shell
├── vite.config.js         # Vite config (proxies /api → backend)
├── vercel.json            # Vercel deployment config
├── .env.example           # Environment variable template
└── .gitignore
```

---

## Deploying to Vercel (Free)

Vercel is the easiest way to deploy. You don't need the terminal for this — you can use their web UI.

### Option A: Via GitHub (recommended)
1. Create a free account at [github.com](https://github.com)
2. Create a new repository and upload your project files
3. Go to [vercel.com](https://vercel.com) and sign in with GitHub
4. Click "New Project" → import your GitHub repo
5. In the **Environment Variables** section, add:
   - `CONGRESS_API_KEY` → your key
   - `ANTHROPIC_API_KEY` → your key
6. Click Deploy

### Option B: Via Vercel CLI drag-and-drop
1. Install Vercel CLI: `npm install -g vercel`
2. Run `vercel` in the project folder and follow prompts

### After deployment
- Your app will be live at a `.vercel.app` URL
- You can add a custom domain in Vercel's dashboard

---

## API Keys

| Key | Where to get it | Cost |
|-----|----------------|------|
| `CONGRESS_API_KEY` | [api.congress.gov](https://api.congress.gov/sign-up/) | Free |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Pay per use (~$0.01–0.05 per student session) |

---

## How the App Works

1. **Student fills out profile** — state, grade, job status, family situation, interests
2. **Backend calls Congress.gov** — fetches recent bills matching student's interest areas, cached for 1 hour to conserve quota
3. **Backend calls Claude API** — for each bill, sends student profile + bill details and asks for a nonpartisan personalized breakdown in structured JSON
4. **Frontend renders results** — bill cards appear immediately, personalizations load progressively as each Claude response arrives

### The Neutrality Prompt
The Claude prompt explicitly prohibits:
- Evaluative language ("good bill", "harmful bill")
- Advocacy for any position
- Invented facts

It only asks for: impact, what changes if it passes, what changes if it fails, and concrete civic actions available to anyone.

---

## Extending the App

### Add state legislation
Sign up for a [LegiScan API](https://legiscan.com/legiscan) key and add state bill fetching to `api/server.js`. The Congress.gov API only covers federal bills.

### Add more interest categories
In `api/server.js`, add entries to the `buildSearchTerms()` function's `interestMap`.
In `src/pages/Profile.jsx`, add entries to the `INTERESTS` array.

### Add bill text summaries
Use the Congress.gov `/bill/{congress}/{type}/{number}/summaries` endpoint to fetch official CRS summaries and include them in the Claude prompt for more accurate personalization.

---

## Tech Stack
- **Frontend**: React 18, React Router, CSS Modules
- **Build tool**: Vite
- **Backend**: Node.js + Express
- **Legislation data**: Congress.gov API (Library of Congress)
- **Personalization**: Anthropic Claude API
- **Deployment**: Vercel

---

## License
Built for civic education. Attribution appreciated.
Data from Congress.gov licensed under public domain.
