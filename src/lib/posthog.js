// PostHog product analytics — funnels and retention on top of the events we
// already collect. Deliberately privacy-locked for a 13+ student audience and
// gated to the live web host, mirroring the GA4 loader in src/lib/analytics.js.
//
// Why this shape:
//   1. Dormant by default. Nothing runs until VITE_POSTHOG_KEY is set (paste it
//      in Vercel to switch on), the same on/off pattern as Sentry's
//      VITE_SENTRY_DSN in src/main.jsx.
//   2. Live web host only. localhost, Vercel preview deploys (*.vercel.app), and
//      the Capacitor native webview (capacitor://localhost) never report —
//      identical hostname gating to GA4's web stream.
//   3. Lazy chunk. posthog-js (~60 KB gzip) loads AFTER first paint via dynamic
//      import so it stays out of the entry bundle, the same trade as Sentry.
//   4. Privacy:
//        - session recording OFF — we never capture a student's screen.
//        - autocapture OFF — only the explicit events we send, never incidental
//          DOM clicks or typed text.
//        - person_profiles 'identified_only' — anonymous students never get a
//          stored person profile; a profile is created only after a signed-in
//          UUID is identified.
//        - we pass only a Supabase user UUID (pseudonymous) plus non-PII bill
//          ids and topic tags as properties — never names, emails, or the
//          onboarding profile (state, age, interests).
//   5. Direct host. api_host points straight at PostHog US (us.i.posthog.com);
//      index.html's CSP allows *.posthog.com / *.i.posthog.com in script-src
//      (remote config + recorder assets) and connect-src (event capture). We
//      originally proxied this same-origin via a Vercel /ingest rewrite, but
//      Vercel did not forward POST to the event endpoint — trailing-slash paths
//      like /ingest/e/ fell through to the SPA index.html and 405'd every
//      event — so we send directly instead.

const TRACKED_HOSTS = new Set(['capitolkey.org', 'www.capitolkey.org'])

// Set once the lazy import resolves. Capture calls before then no-op rather
// than queue — the same early-event trade Sentry makes, and analytics events
// of interest (sign-in, personalize, bookmark) all happen well after load.
let ph = null

export function initPostHog() {
  if (typeof window === 'undefined') return
  const key = import.meta.env.VITE_POSTHOG_KEY
  if (!key) return
  if (!TRACKED_HOSTS.has(window.location.hostname)) return
  if (window.__phInitialized) return
  window.__phInitialized = true

  import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(key, {
        // Direct to PostHog US ingestion. VITE_POSTHOG_HOST can override (e.g.
        // a working same-origin proxy); the CSP already allows the PostHog hosts.
        api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
        ui_host: 'https://us.posthog.com',
        person_profiles: 'identified_only',
        autocapture: false,
        disable_session_recording: true,
        capture_pageview: 'history_change', // SPA pageviews via History API (React Router)
        capture_pageleave: true,
        // Belt-and-suspenders: recording is disabled above, but if it is ever
        // enabled, mask every input so student text is never captured.
        session_recording: { maskAllInputs: true },
      })
      ph = posthog
    })
    .catch(() => {})
}

// Fire a product event. No-ops silently when PostHog is off (no key, wrong
// host, or not yet loaded), so callers never need to guard.
export function phCapture(event, props) {
  if (!ph) return
  try { ph.capture(event, props) } catch {}
}

// Link subsequent events to a signed-in user (Supabase UUID — pseudonymous).
export function phIdentify(userId) {
  if (!ph || !userId) return
  try { ph.identify(userId) } catch {}
}

// Unlink on sign-out so the next anonymous session isn't tied to the prior user.
export function phReset() {
  if (!ph) return
  try { ph.reset() } catch {}
}
