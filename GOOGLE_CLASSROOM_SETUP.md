# Google Classroom Integration — Setup

CapitolKey's deep Google Classroom integration lets a teacher connect their
Google account, push a bill into one of their classes as a real assignment
(draft or live), and have student completions flow back as grades.

This is a **dedicated server-side OAuth flow**, separate from Supabase's Google
sign-in. Supabase's sign-in never yields an offline refresh token, but grade
passback runs when the teacher is not in a live session, so the backend runs its
own flow with `access_type=offline` + `prompt=consent` and stores an **encrypted
refresh token per teacher** in the `google_oauth_tokens` table.

## Scopes

| Scope | Why |
| --- | --- |
| `openid`, `userinfo.email` | Record which Google account the teacher connected. |
| `classroom.courses.readonly` | List the teacher's classes so they can pick one. |
| `classroom.coursework.students` | Create assignments and write grades (sensitive). |
| `classroom.profile.emails` | Resolve a Google submission's user to an email so it matches the CapitolKey student who completed. |

`classroom.coursework.students` and `classroom.profile.emails` are **sensitive**,
so the app needs Google OAuth verification before public launch. In **Testing**
publishing mode you can add up to 100 test users and call the real API
immediately with no verification, so we ship to test teachers now and submit for
verification in parallel.

## Phase 0: Google Cloud Console checklist (do this once)

All in [console.cloud.google.com](https://console.cloud.google.com).

1. **Project** — create or select a project. Note the Project ID.
2. **Enable API** — APIs & Services → Library → search **"Google Classroom API"** → **Enable**.
3. **OAuth consent screen** — choose **External**, keep it in **Testing** (do not publish yet).
   - App name: `CapitolKey`; support email: yours; developer contact: yours.
   - App domain `capitolkey.org`; Privacy policy `https://capitolkey.org/privacy`; Terms `https://capitolkey.org/terms`.
4. **Scopes** — add exactly these five:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/classroom.courses.readonly`
   - `https://www.googleapis.com/auth/classroom.coursework.students`
   - `https://www.googleapis.com/auth/classroom.profile.emails`
5. **Test users** — add up to 100. **Add your Google account and the test
   teacher's exact Google address**, or they cannot connect.
6. **OAuth client** — Credentials → Create Credentials → OAuth client ID → **Web
   application** ("CapitolKey Web"). Add both Authorized redirect URIs:
   - `http://localhost:3001/api/google/oauth/callback` (local dev)
   - `https://<your-railway-backend>/api/google/oauth/callback` (production — the
     exact origin from `VITE_API_BASE_URL`, plus `/api/google/oauth/callback`)
7. **Credentials → env** — copy the Client ID and Client Secret into env (below).

## Environment variables (backend)

Set locally in `.env` and in Railway. Secrets (`*_SECRET`, `*_ENC_KEY`) should be
pasted directly into those tools, never committed.

```
GOOGLE_OAUTH_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=...
GOOGLE_OAUTH_REDIRECT_URI=https://<railway-backend>/api/google/oauth/callback
GOOGLE_TOKEN_ENC_KEY=<openssl rand -base64 32>
```

When these are unset the feature self-disables: `/api/google/status` reports
`configured: false`, the dashboard hides the connect card, and the other Google
endpoints return `503`. Nothing else in the app is affected.

## Database

Apply `supabase/create_google_oauth_tokens_table.sql` in the Supabase SQL editor.
Phases 2 and 3 add a few more migrations (course/coursework links, grade
bookkeeping); each is a separate file in `supabase/`.

## Endpoints (Phase 1)

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/google/oauth/start` | teacher JWT | Returns the Google consent URL (signed `state` binds the user). |
| GET | `/api/google/oauth/callback` | public (signed state) | Exchanges the code, stores the encrypted refresh token, redirects back. |
| GET | `/api/google/status` | teacher JWT | `{ connected, configured, email, needsReconsent }`. |
| POST | `/api/google/disconnect` | teacher JWT | Revokes at Google and deletes the stored token. |

## Phase 4: verification (later, in parallel)

Before public launch, submit the sensitive scopes for Google verification:
consent-screen copy, per-scope justification, a Limited Use disclosure in the
privacy policy, and a demo video. Tracked separately; it does not block testing.
