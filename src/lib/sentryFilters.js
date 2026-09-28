// Sentry beforeSend filters for noise that can't be matched on message text
// alone without also hiding a real bug. Kept separate from main.jsx so the
// logic is plain-node testable (scripts/test-sentry-filters.mjs).

// The browser's wording when our CSP (no 'unsafe-eval') blocks eval() or
// new Function(). The first phrase is shared by Safari, older Chrome ("Refused
// to evaluate a string...") and current Chrome ("Evaluating a string as
// JavaScript violates..."); the second is Firefox.
const CSP_EVAL_RE = /'unsafe-eval' is not an allowed source of script|call to (?:eval|Function)\(\) blocked by CSP/i

// Frames that can't be our code: scripts injected with no source URL
// (automation tools, devtools snippets), extension scripts, browser internals,
// and the Sentry SDK's own chunk, which shows up as the outermost frame
// whenever its setTimeout/requestAnimationFrame wrapper runs a callback.
function isForeignFrame(frame) {
  const file = frame?.filename || frame?.abs_path || ''
  if (!file || file === '<anonymous>' || file === '[native code]') return true
  if (/^(?:chrome|moz|safari|safari-web)-extension:/.test(file)) return true
  return /\/assets\/sentry-[^/]*\.js/.test(file)
}

// A CSP eval block where no stack frame belongs to our bundle means someone
// else's code tried to eval on our page and the CSP did its job. The case that
// prompted this (JAVASCRIPT-REACT-1X) was a headless Chrome 130 bot polling
// with a Playwright-style waitForFunction (frames: eval <- predicate <- next,
// all <anonymous>). We ship no eval or new Function, so if one ever does come
// from our own chunk, the frame points at /assets/ and it still reports.
export function isInjectedCspEvalError(event) {
  const values = event?.exception?.values || []
  return values.some((ex) => {
    if (!CSP_EVAL_RE.test(ex?.value || '')) return false
    const frames = ex?.stacktrace?.frames || []
    return frames.length > 0 && frames.every(isForeignFrame)
  })
}

export function beforeSend(event) {
  return isInjectedCspEvalError(event) ? null : event
}
