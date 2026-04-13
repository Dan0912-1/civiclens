import { getApiBase } from './api'

let registered = false
let _navigate = null

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
    // Validate: only allow known internal paths to prevent open redirect
    const SAFE_PREFIXES = ['/bill/', '/bookmarks', '/results', '/search', '/classroom']
    const isSafe = SAFE_PREFIXES.some(p => target.startsWith(p)) || target === '/'
    if (!isSafe) return // reject suspicious deep links
    if (_navigate) {
      _navigate(target)
    } else {
      window.location.pathname = target
    }
  })

  await PushNotifications.register()

  registered = true
}

export async function teardownPushNotifications(token, deviceToken) {
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.removeAllListeners()
    if (deviceToken && token) {
      await fetch(`${getApiBase()}/api/push/register`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ token: deviceToken }),
      })
    }
  } catch {
    // non-fatal
  }
  registered = false
}

// Reset listener state on sign-out (even without device token)
export function resetPushState() {
  registered = false
}
