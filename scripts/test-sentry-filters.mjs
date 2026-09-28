#!/usr/bin/env node
// Regression tests for src/lib/sentryFilters.js.
//
// The drop case is the real JAVASCRIPT-REACT-1X event (2026-09-27): a headless
// bot's injected eval blocked by our CSP. Every keep case is a variant that
// would be a genuine bug on our side and must still reach Sentry.
//
// Plain node + assert to match the other scripts/ci-*.mjs checks (no framework).

import assert from 'node:assert/strict'
import { beforeSend, isInjectedCspEvalError } from '../src/lib/sentryFilters.js'

const CHROME_MSG =
  "Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive: \"script-src 'self' https://www.googletagmanager.com https://*.posthog.com https://*.i.posthog.com\"."
// Current Chrome reworded the message; the old filter text missed it.
const CHROME_NEW_MSG =
  "Evaluating a string as JavaScript violates the following Content Security Policy directive because 'unsafe-eval' is not an allowed source of script: script-src 'self' https://www.googletagmanager.com https://*.posthog.com https://*.i.posthog.com\"."
const FIREFOX_MSG = 'call to eval() blocked by CSP'

// Sentry orders frames oldest-first: the throwing frame is last.
const SENTRY_WRAPPER = { filename: 'https://capitolkey.org/assets/sentry-ChKqFI0G.js', function: 'r', lineno: 488, colno: 5851 }
const anon = (fn) => ({ filename: '<anonymous>', function: fn, lineno: 234, colno: 30 })
const ours = (fn) => ({ filename: 'https://capitolkey.org/assets/index-DXoomDAI.js', function: fn, lineno: 1, colno: 4200 })

const event = (value, frames, type = 'EvalError') => ({
  exception: { values: [{ type, value, stacktrace: frames && { frames } }] },
})

let passed = 0
function check(name, ev, expectDropped) {
  assert.equal(isInjectedCspEvalError(ev), expectDropped, name)
  assert.equal(beforeSend(ev), expectDropped ? null : ev, `${name} (beforeSend)`)
  console.log(`  ok  ${name} -> ${expectDropped ? 'dropped' : 'kept'}`)
  passed++
}

console.log('sentry beforeSend filters')

check(
  'JAVASCRIPT-REACT-1X: injected eval via Sentry rAF wrapper',
  event(CHROME_MSG, [SENTRY_WRAPPER, anon('next'), anon('predicate'), anon('eval')]),
  true,
)
check(
  'current Chrome wording, same injected shape',
  event(CHROME_NEW_MSG, [SENTRY_WRAPPER, anon('next'), anon('predicate')]),
  true,
)
check(
  'Firefox wording from an extension script',
  event(FIREFOX_MSG, [{ filename: 'moz-extension://abc/content.js', function: 'run' }, anon('eval')]),
  true,
)
check(
  'Capacitor build: Sentry chunk served from capacitor://',
  event(CHROME_MSG, [{ ...SENTRY_WRAPPER, filename: 'capacitor://localhost/assets/sentry-X1.js' }, anon('eval')]),
  true,
)

check(
  'eval reached from our own chunk still reports',
  event(CHROME_MSG, [SENTRY_WRAPPER, ours('loadWidget'), anon('eval')]),
  false,
)
check(
  'new Function from a lazy route chunk still reports',
  event(CHROME_NEW_MSG,[{ filename: 'https://capitolkey.org/assets/BillDetail-abc123.js', function: 'render' }, anon('Function')]),
  false,
)
check('CSP eval with no stack is kept (cannot attribute)', event(CHROME_MSG, null), false)
check('CSP eval with an empty stack is kept', event(CHROME_MSG, []), false)
check(
  'unrelated error from anonymous code is kept',
  event('Cannot read properties of undefined', [anon('next')], 'TypeError'),
  false,
)
check('event without an exception is kept', { message: 'hello' }, false)

console.log(`\n${passed} sentry filter checks passed`)
