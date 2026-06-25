import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import { initAnalytics } from './lib/analytics'
import { initPostHog } from './lib/posthog'
import App from './App.jsx'

// Self-hosted fonts (latin subsets), replacing the render-blocking Google
// Fonts stylesheet. Bundling the woff2 means the Capacitor app gets correct
// typography on cold starts and offline launches instead of depending on a
// network fetch to fonts.gstatic.com.
import '@fontsource/playfair-display/latin-600.css'
import '@fontsource/playfair-display/latin-700.css'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-500.css'
import '@fontsource/source-sans-3/latin-600.css'
import '@fontsource/source-sans-3/latin-700.css'
import '@fontsource/source-serif-4/latin-400.css'
import '@fontsource/source-serif-4/latin-600.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/ibm-plex-mono/latin-600.css'

import './index.css'

// A deploy rotates the hashed filenames of lazily-loaded route chunks. A tab
// that loaded index.html before the deploy 404s on the old chunk names; our
// Vercel SPA rewrite then serves index.html (text/html) in their place, and the
// browser refuses to execute it — surfacing as "'text/html' is not a valid
// JavaScript MIME type" / "Failed to fetch dynamically imported module". Vite
// fires `vite:preloadError` for exactly this; reload once to pull the fresh
// manifest. We DON'T preventDefault on a repeat within 10s, so a genuinely
// broken deploy still throws through to the ErrorBoundary + Sentry instead of
// reload-looping or silently resolving the lazy import to undefined.
window.addEventListener('vite:preloadError', (event) => {
  const KEY = 'ck-preload-reload-at'
  let last = 0
  try { last = Number(sessionStorage.getItem(KEY) || 0) } catch {}
  if (Date.now() - last < 10000) return
  event.preventDefault()
  try { sessionStorage.setItem(KEY, String(Date.now())) } catch {}
  window.location.reload()
})

// Sentry loads as an async chunk AFTER the app starts rendering — the SDK
// plus tracing is ~40 KB gzip that used to parse and initialize before first
// paint. Errors thrown in the brief window before init are dropped, which is
// an acceptable trade for faster startup. ErrorBoundary's captureException
// is dynamic too, so nothing pulls the SDK into the entry chunk.
const sentryDsn = import.meta.env.VITE_SENTRY_DSN
if (sentryDsn) {
  import('@sentry/react')
    .then((Sentry) => {
      Sentry.init({
        dsn: sentryDsn,
        environment: import.meta.env.MODE,
        integrations: [
          Sentry.browserTracingIntegration(),
        ],
        tracesSampleRate: 0.2,
        replaysSessionSampleRate: 0,
        replaysOnErrorSampleRate: 0, // disabled — error replays could capture student profile data
        // Known-benign noise that isn't actionable per-event. Keep this list
        // tight — anything here is invisible to us forever.
        ignoreErrors: [
          // Capacitor's web Haptics shim on Safari (no navigator.vibrate).
          // Belt-and-suspenders behind the native gate in src/lib/haptics.js,
          // for stale web bundles + older native builds still in the wild.
          'Browser does not support the vibrate API',
          // supabase-js coordinates token refresh across tabs via the Web Locks
          // API. During a navigation/redirect (e.g. the /classroom OAuth bounce)
          // a held lock gets stolen and the loser rejects — the session is fine.
          /another request stole it/i,
          "Lock broken by another request with the 'steal' option",
          // Stale lazy-route chunks after a deploy. The vite:preloadError handler
          // above reloads to recover; this filters variants that slip past it.
          /Failed to fetch dynamically imported module/i,
          /error loading dynamically imported module/i,
          /Importing a module script failed/i,
          "'text/html' is not a valid JavaScript MIME type",
        ],
      })
    })
    .catch(() => {})
}

// Google Analytics 4 — no-ops off the live web host (see src/lib/analytics.js).
initAnalytics()

// PostHog product analytics — dormant until VITE_POSTHOG_KEY is set, and like
// GA4 no-ops off the live web host (see src/lib/posthog.js).
initPostHog()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
          <App />
          <Analytics />
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
)
