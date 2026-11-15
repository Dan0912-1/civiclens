// Decides what to do with a `vite:preloadError` (a lazy route chunk or its CSS
// failed to load). Kept separate from main.jsx so it is plain-node testable
// (scripts/test-sentry-filters.mjs).
//
//   'reload'   first failure in a while: likely a deploy rotated the hashed
//              filenames under an old tab, so reload once for a fresh manifest.
//   'continue' a repeat failure that is only a stylesheet. The JS module still
//              imports; the page renders without that route's CSS instead of
//              dropping to the "Something went wrong" screen. If the JS is also
//              broken, its own import error still throws to the ErrorBoundary.
//              Prompted by JAVASCRIPT-REACT-1Y (2026-11-13): /contact's CSS was
//              live in prod, but a flaky fetch failed it twice and crashed the page.
//   'throw'    a repeat failure of a JS chunk: genuinely broken, so let it reach
//              the ErrorBoundary + Sentry rather than reload-looping.

export const RELOAD_WINDOW_MS = 10000

const CSS_PRELOAD_RE = /^Unable to preload CSS for /

export function preloadErrorAction(err, lastReloadAt, now = Date.now()) {
  if (now - (Number(lastReloadAt) || 0) >= RELOAD_WINDOW_MS) return 'reload'
  return CSS_PRELOAD_RE.test(err?.message || '') ? 'continue' : 'throw'
}
