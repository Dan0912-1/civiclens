// Centralized haptics.
//
// Capacitor's web Haptics shim calls navigator.vibrate, which Safari (both iOS
// and macOS) does not implement — so it throws "Browser does not support the
// vibrate API". That's pure noise: the web has no haptics to give, and a large
// share of our traffic is Safari. We gate every call on the native platform so
// the web shim is never invoked, and swallow any residual error as a final
// backstop.
//
// isNativePlatform() is resolved once and memoized — it never changes within a
// session, and the dynamic import keeps @capacitor/core out of the entry chunk.
let nativePromise

function isNative() {
  if (!nativePromise) {
    nativePromise = import('@capacitor/core')
      .then(({ Capacitor }) => Capacitor.isNativePlatform())
      .catch(() => false)
  }
  return nativePromise
}

// Fire-and-forget impact haptic. Safe to call on any platform; a no-op on web.
export async function haptic(style = 'Light') {
  try {
    if (!(await isNative())) return
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics')
    await Haptics.impact({ style: ImpactStyle[style] })
  } catch {
    // haptics unavailable (web shim, missing plugin) — non-fatal
  }
}

export { isNative as isNativePlatform }
