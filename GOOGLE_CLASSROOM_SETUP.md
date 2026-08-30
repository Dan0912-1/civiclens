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
| `classroom.coursework.students` | Create assignments and write grades. Grade passback matches the student by their verified Google email, so no roster/profile scope is needed. |

Google currently classifies all of these as **non-sensitive** (confirmed in the
project's Data Access screen and Verification Center). Because the app requests no
sensitive or restricted scopes, **no Google OAuth verification is required and
users see no "unverified app" warning.** See `GOOGLE_VERIFICATION.md`.

## Phase 0: Google Cloud Console checklist (do this once)

All in [console.cloud.google.com](https://console.cloud.google.com).

1. **Project** — create or select a project. Note the Project ID.
2. **Enable API** — APIs & Services → Library → search **"Google Classroom API"** → **Enable**.
3. **OAuth consent screen** — choose **External**, keep it in **Testing** (do not publish yet).
   - App name: `CapitolKey`; support email: yours; developer contact: yours.
   - App domain `capitolkey.org`; Privacy policy `https://capitolkey.org/privacy`; Terms `https://capitolkey.org/terms`.
4. **Scopes** — add exactly these four:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/classroom.courses.readonly`
   - `https://www.googleapis.com/auth/classroom.coursework.students`
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

Apply these in the Supabase SQL editor, in order. Each is idempotent
(`if not exists` throughout), so re-running one is harmless.

| File | Adds |
| --- | --- |
| `create_google_oauth_tokens_table.sql` | The encrypted per-teacher token store (Phase 1). |
| `add_google_classroom_columns.sql` | Course/coursework links on classrooms + assignments, grade bookkeeping on completions (Phases 2–3). |
| `add_google_health_and_grade_retry.sql` | Connection-health columns + grade-retry bookkeeping for the nightly sweep. |

The backend tolerates a pending migration rather than breaking: it probes for
the newer columns once and degrades (status drops `needsReconnect`, the nightly
sweep skips with a warning) instead of failing the whole query. Watch the boot
log for `run supabase/add_google_health_and_grade_retry.sql` to know it's still
outstanding.

### Grade passback, and why a grade can be missing

Passback runs when a student finishes reading, matching their submission by
passing their email as the Classroom `userId` filter. It legitimately misses:

| Reason | What happened | Who fixes it |
| --- | --- | --- |
| `not_in_course` | The student signed into CapitolKey with an account that isn't on the Google roster (usually a personal Gmail). | Student re-signs in with the school account. |
| `no_submission` | Coursework is still a DRAFT, or Google hasn't created the submission yet. | Resolves itself; the nightly sweep retries. |
| `reconnect` | The teacher's refresh token was revoked or expired. | Teacher reconnects. |
| `ungraded` | The assignment's maxPoints is 0. | Nothing to send. |

A nightly sweep (03:20 UTC) retries everything still pending, up to 8 nights,
looking back 45 days. Teachers can also force it from a classroom with
**Sync grades**.

## Endpoints (Phase 1)

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| GET | `/api/google/oauth/start` | teacher JWT | Returns the Google consent URL (signed `state` binds the user). |
| GET | `/api/google/oauth/callback` | public (signed state) | Exchanges the code, stores the encrypted refresh token, redirects back. |
| GET | `/api/google/status` | teacher JWT | `{ connected, configured, email, needsReconsent, needsReconnect }`. |
| POST | `/api/google/disconnect` | teacher JWT | Revokes at Google and deletes the stored token. |

## Verification

**Not required.** The app requests only non-sensitive scopes, so Google does not
require OAuth verification and shows no warning. The consent screen + privacy
policy are configured anyway (including a Limited Use disclosure). If a sensitive
or restricted scope is ever added (e.g. `classroom.rosters.readonly`),
verification would then be needed — see `GOOGLE_VERIFICATION.md`.
