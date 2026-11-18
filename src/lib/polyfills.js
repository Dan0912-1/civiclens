// Browser gaps that turned into user-facing errors. Imported first in
// main.jsx so they are in place before any other module runs. On a modern
// browser every check here finds the real feature and changes nothing.

// AbortSignal.timeout() only exists in Safari 16+ / Chrome 103+. School iPads
// stuck on iOS 15 and Chromebooks pinned below 103 threw "AbortSignal.timeout
// is not a function" on every fetch that used it: the feed couldn't
// personalize, classroom calls failed, and opening "Contact Lawmakers" crashed
// the page from inside a React effect.
export function installAbortSignalTimeout(Signal = globalThis.AbortSignal, Controller = globalThis.AbortController) {
  if (!Signal || !Controller || typeof Signal.timeout === 'function') return false
  Signal.timeout = function timeout(ms) {
    const controller = new Controller()
    setTimeout(() => {
      let reason
      try { reason = new DOMException('signal timed out', 'TimeoutError') } catch {
        reason = Object.assign(new Error('signal timed out'), { name: 'TimeoutError' })
      }
      controller.abort(reason)
    }, ms)
    return controller.signal
  }
  return true
}

// In-memory stand-in for a Storage the browser refuses to give us. Safari with
// "Block all cookies", some managed school profiles, and sandboxed embeds throw
// a SecurityError just for reading window.localStorage. The app reads storage
// during its first render, so that took the whole app down to the error
// screen. With the stand-in, those users get a working app that simply
// forgets onboarding and session state when the tab closes.
export function createMemoryStorage() {
  const data = new Map()
  return {
    get length() { return data.size },
    key(i) { return Array.from(data.keys())[i] ?? null },
    getItem(k) { return data.has(String(k)) ? data.get(String(k)) : null },
    setItem(k, v) { data.set(String(k), String(v)) },
    removeItem(k) { data.delete(String(k)) },
    clear() { data.clear() },
  }
}

function storageWorks(win, name) {
  try {
    const s = win[name]
    if (!s) return false
    const probe = '__ck_probe__'
    s.setItem(probe, '1')
    s.removeItem(probe)
    return true
  } catch {
    return false
  }
}

export function installStorageFallback(win = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return []
  const replaced = []
  for (const name of ['localStorage', 'sessionStorage']) {
    if (storageWorks(win, name)) continue
    try {
      Object.defineProperty(win, name, { value: createMemoryStorage(), configurable: true, writable: true })
      replaced.push(name)
    } catch {}
  }
  return replaced
}

installAbortSignalTimeout()
installStorageFallback()
