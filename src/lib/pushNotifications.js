import { getApiBase } from './api'

let registered = false

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

  await PushNotifications.register()

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
    // Navigate to bookmarks when user taps a notification
    const url = notification.notification?.data?.url
    if (url) {
      window.location.hash = ''
      window.location.pathname = url
    } else {
      window.location.pathname = '/bookmarks'
    }
  })

  registered = true
}

export async function teardownPushNotifications(token, deviceToken) {
  if (!deviceToken || !token) return
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.removeAllListeners()
    await fetch(`${getApiBase()}/api/push/register`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ token: deviceToken }),
    })
  } catch {
    // non-fatal
  }
  registered = false
}
