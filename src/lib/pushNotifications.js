import { getApiBase } from './api'

let registered = false
let _navigate = null
// Captured when the device registers with FCM/APNs so signOut can revoke the
// subscription server-side without the caller having to shuttle the token
// around. Cleared in teardownPushNotifications / resetPushState.
let currentDeviceToken = null

// Allow the app to inject a React Router navigate function
export function setPushNavigate(navigateFn) {
  _navigate = navigateFn
}

// Check if we're on a native platform with push support
export async function canRequestPush() {
  try {
    const { Capacitor } = await import('@capacitor/core')
    if (!Capacitor.isNativePlatform()) return false
    const { PushNotifications } = await import('@capacitor/push-notifications')
    const perm = await PushNotifications.checkPermissions()
    // Show soft prompt only if permission hasn't been decided yet
    return perm.receive === 'prompt'
  } catch {
    return false
  }
}

export async function initPushNotifications(userId, token) {
  if (registered) return

  let Capacitor, PushNotifications
  try {
    ;({ Capacitor } = await import('@capacitor/core'))
    ;({ PushNotifications } = await import('@capacitor/push-notifications'))
  } catch {
    return // plugin not installed or not in native context
  }

  if (!Capacitor.isNativePlatform()) return

  // Check if already granted (user accepted soft prompt previously)
  const check = await PushNotifications.checkPermissions()
  if (check.receive === 'denied') return

  const permResult = await PushNotifications.requestPermissions()
  if (permResult.receive !== 'granted') return

  // Add listeners BEFORE register() to avoid race condition where
  // the native platform fires the registration event synchronously
  PushNotifications.addListener('registration', async ({ value: deviceToken }) => {
    currentDeviceToken = deviceToken
    const platform = Capacitor.getPlatform() // 'ios' or 'android'
    try {
      await fetch(`${getApiBase()}/api/push/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token: deviceToken, platform }),
      })
    } catch {
      // non-fatal
    }
  })

  PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
    // Navigate using React Router to preserve SPA state
    const url = notification.notification?.data?.url
    const target = url || '/bookmarks'
    // Validate: only allow known internal paths to prevent open redirect.
    // `/classroom` covers both listing (/classroom) and detail (/classroom/:id)
    // and assignment-in-bill paths use /bill/… already.
    const SAFE_PREFIXES = ['/bill/', '/bookmarks', '/results', '/search', '/classroom']
    const [pathOnly] = target.split('?')
    const isSafe = SAFE_PREFIXES.some(p => pathOnly.startsWith(p)) || pathOnly === '/'
    if (!isSafe) return // reject suspicious deep links
    // Assignment pushes point at /bill/:congress/:type/:number?assignment=…&classroom=…
    // BillDetail reads those query params as a fallback when location.state
    // is absent (deep-link from a push, not an in-app navigation).
    if (_navigate) {
      _navigate(target)
    } else {
      window.location.href = target
    }
  })

  await PushNotifications.register()

  registered = true
}

export async function teardownPushNotifications(token, deviceToken) {
  // Fall back to the token captured at registration time so callers (sign-out)
  // don't need to plumb it through themselves.
  const effectiveDeviceToken = deviceToken || currentDeviceToken
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.removeAllListeners()
    if (effectiveDeviceToken && token) {
      await fetch(`${getApiBase()}/api/push/register`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token: effectiveDeviceToken }),
      })
    }
  } catch {
    // non-fatal
  }
  registered = false
  currentDeviceToken = null
}

// Reset listener state on sign-out (even without device token)
export function resetPushState() {
  registered = false
  currentDeviceToken = null
}
