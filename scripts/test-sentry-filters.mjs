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
import { preloadErrorAction, RELOAD_WINDOW_MS, settleRouteModule, markReloadPending } from '../src/lib/chunkRecovery.js'
import { installDomResilience } from '../src/lib/domResilience.js'
import { installAbortSignalTimeout, installStorageFallback } from '../src/lib/polyfills.js'

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

// --- JAVASCRIPT-REACT-1Y: vite:preloadError handling (src/lib/chunkRecovery.js)
console.log('\nvite:preloadError recovery')
const NOW = 1_800_000_000_000
const cssErr = new Error('Unable to preload CSS for /assets/Contact-Ce-AOjYz.css')
const jsErr = new TypeError('Failed to fetch dynamically imported module: https://capitolkey.org/assets/Contact-abc.js')
function action(name, err, last, expected) {
  assert.equal(preloadErrorAction(err, last, NOW), expected, name)
  console.log(`  ok  ${name} -> ${expected}`)
  passed++
}
action('first CSS failure reloads', cssErr, 0, 'reload')
action('first JS failure reloads', jsErr, 0, 'reload')
action('JAVASCRIPT-REACT-1Y: repeat CSS failure continues unstyled', cssErr, NOW - 2000, 'continue')
action('repeat JS failure throws to ErrorBoundary', jsErr, NOW - 2000, 'throw')
action('failure after the window reloads again', cssErr, NOW - RELOAD_WINDOW_MS, 'reload')
action('garbage sessionStorage value reloads', jsErr, 'NaN', 'reload')
action('repeat with no payload throws', undefined, NOW - 1, 'throw')

// --- JAVASCRIPT-REACT-20: lazy route resolved to undefined during a recovery reload
console.log('\nlazy route settling')
{
  const mod = { default: () => null }
  assert.equal(settleRouteModule(mod), mod); console.log('  ok  real module passes through'); passed++
  assert.throws(() => settleRouteModule(undefined), /no recovery reload pending/)
  console.log('  ok  undefined module with no reload pending still throws'); passed++
  markReloadPending()
  const held = settleRouteModule(undefined)
  assert.ok(held instanceof Promise)
  const raced = await Promise.race([held.then(() => 'resolved'), new Promise((r) => setTimeout(() => r('pending'), 50))])
  assert.equal(raced, 'pending')
  console.log('  ok  JAVASCRIPT-REACT-20: undefined module during reload holds Suspense instead of crashing'); passed++
  assert.equal(settleRouteModule(mod), mod); console.log('  ok  real module still passes through after a reload is marked'); passed++
}

// --- JAVASCRIPT-REACT-1Z: translator-mutated DOM (src/lib/domResilience.js)
console.log('\nDOM resilience patch')
class FakeNode {
  constructor() { this.children = []; this.parentNode = null }
  removeChild(c) {
    const i = this.children.indexOf(c)
    if (i < 0) { const e = new Error("Failed to execute 'removeChild' on 'Node'"); e.name = 'NotFoundError'; throw e }
    this.children.splice(i, 1); c.parentNode = null; return c
  }
  insertBefore(n, ref) {
    const i = ref == null ? this.children.length : this.children.indexOf(ref)
    if (i < 0) { const e = new Error("Failed to execute 'insertBefore' on 'Node'"); e.name = 'NotFoundError'; throw e }
    this.children.splice(i, 0, n); n.parentNode = this; return n
  }
}
const ok = (name) => { console.log(`  ok  ${name}`); passed++ }
const warn = console.warn
console.warn = () => {}
try {
  assert.equal(installDomResilience(FakeNode), true); ok('installs once')
  assert.equal(installDomResilience(FakeNode), false); ok('second install is a no-op')
  assert.equal(installDomResilience(undefined), false); ok('no Node constructor (SSR/node) is a no-op')

  const root = new FakeNode(), a = new FakeNode(), b = new FakeNode()
  root.insertBefore(a, null); root.insertBefore(b, a)
  assert.deepEqual(root.children, [b, a]); ok('valid insertBefore still inserts')
  assert.equal(root.removeChild(a), a); assert.deepEqual(root.children, [b]); ok('valid removeChild still removes')

  // Google Translate moved b under its own <font> wrapper.
  const font = new FakeNode()
  root.removeChild(b); root.insertBefore(font, null); font.insertBefore(b, null)
  assert.doesNotThrow(() => root.removeChild(b)); ok('JAVASCRIPT-REACT-1Z: removeChild of a re-parented node does not throw')
  assert.deepEqual(font.children, [b]); ok('skipped removeChild leaves the DOM untouched')
  const c = new FakeNode()
  assert.equal(root.insertBefore(c, b), c); assert.deepEqual(root.children, [font]); ok('insertBefore with a re-parented reference node is skipped')
} finally {
  console.warn = warn
}

// ── polyfills.js ─────────────────────────────────────────────────────────────
console.log('\npolyfills')
{
  // Simulate Safari 15 / Chrome < 103: AbortSignal without .timeout().
  class OldSignal {}
  assert.equal(installAbortSignalTimeout(OldSignal, AbortController), true); ok('installs AbortSignal.timeout when missing')
  const sig = OldSignal.timeout(20)
  assert.equal(sig.aborted, false); ok('timeout signal starts un-aborted')
  await new Promise((r) => setTimeout(r, 40))
  assert.equal(sig.aborted, true); ok('timeout signal aborts after the delay')
  assert.equal(sig.reason?.name, 'TimeoutError'); ok('abort reason is a TimeoutError, like the native one')
  assert.equal(installAbortSignalTimeout(AbortSignal, AbortController), false); ok('leaves a native AbortSignal.timeout alone')

  // Storage that throws on access (Safari "Block all cookies").
  const blocked = {}
  Object.defineProperty(blocked, 'localStorage', { configurable: true, get() { throw new Error('SecurityError') } })
  const working = createWorkingStore()
  blocked.sessionStorage = working
  assert.deepEqual(installStorageFallback(blocked), ['localStorage']); ok('replaces only the blocked storage')
  assert.equal(blocked.sessionStorage, working); ok('working storage is untouched')
  blocked.localStorage.setItem('k', 1)
  assert.equal(blocked.localStorage.getItem('k'), '1'); ok('fallback stores strings')
  assert.equal(blocked.localStorage.getItem('missing'), null); ok('fallback returns null for missing keys')
  assert.deepEqual(Object.keys(blocked.localStorage).filter((k) => k === 'k'), []); ok('stored keys are not own properties (Object.keys(localStorage) callers stay safe)')
  blocked.localStorage.removeItem('k')
  assert.equal(blocked.localStorage.length, 0); ok('fallback removes keys')
}

function createWorkingStore() {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

console.log(`\n${passed} sentry filter checks passed`)
