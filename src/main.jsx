import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Analytics } from '@vercel/analytics/react'
import { AuthProvider } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import ErrorBoundary from './components/ErrorBoundary.jsx'
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
      })
    })
    .catch(() => {})
}

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
