// Google Analytics 4 (gtag.js) loader for the CapitolKey "web" data stream.
//
// We inject gtag.js at runtime from this bundled module instead of pasting
// Google's inline snippet into index.html, for two reasons:
//
//   1. CSP. index.html ships a strict policy with `script-src 'self'` and no
//      'unsafe-inline'. Google's stock snippet relies on an inline init script,
//      which would force us to weaken the policy to 'unsafe-inline' (a real XSS
//      regression). Loading the gtag.js library from this module — which IS
//      'self' — keeps inline scripts banned; only the googletagmanager.com
//      origin needs whitelisting (done in index.html's script-src/connect-src).
//
//   2. Scope. This is GA4's WEB stream for capitolkey.org. We gate on the live
//      hostname so localhost dev, Vercel preview deploys (*.vercel.app), and the
//      Capacitor native webview (capacitor://localhost) never report into the
//      web stream. Native-app usage, if we ever want it, belongs in a separate
//      Firebase/GA app stream rather than mixed in here.
//
// The Measurement ID is a public value — it ships in the client regardless — so
// hardcoding it is fine. VITE_GA_MEASUREMENT_ID can override it if needed.

const MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID || 'G-9ZVHT046KN'

// Only the live website reports into the web stream.
const TRACKED_HOSTS = new Set(['capitolkey.org', 'www.capitolkey.org'])

export function initAnalytics() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  if (!TRACKED_HOSTS.has(window.location.hostname)) return
  if (window.__gaInitialized) return
  window.__gaInitialized = true

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`
  document.head.appendChild(script)

  // Standard gtag bootstrap. React Router navigations are captured by GA4's
  // Enhanced Measurement ("page changes based on browser history events"),
  // which is enabled on this stream — so no manual page_view calls are needed.
  window.dataLayer = window.dataLayer || []
  function gtag() {
    window.dataLayer.push(arguments)
  }
  window.gtag = gtag
  gtag('js', new Date())
  gtag('config', MEASUREMENT_ID)
}
