import { getApiBase } from './api'
import { enqueue } from './offlineQueue'

const STORAGE_KEY = 'civicInteractions'

export function trackInteraction(userId, token, { billId, actionType, topicTag }) {
  const interaction = { billId, actionType, topicTag, timestamp: Date.now() }

  if (userId && token) {
    // Fire-and-forget POST to server
    const url = `${getApiBase()}/api/interactions`
    const body = { bill_id: billId, action_type: actionType, topic_tag: topicTag }
    const headers = { Authorization: `Bearer ${token}` }
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    }).catch(() => {
      // Network failure — queue for retry when back online
      enqueue(url, 'POST', body, headers)
    })
  }

  // Always store locally too (for summary computation)
  const local = getLocalInteractions()
  local.push(interaction)
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(local))
}

export function getLocalInteractions() {
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

export function computeLocalSummary(interactions) {
  const topicCounts = {}
  for (const i of interactions) {
    if (i.topicTag) {
      topicCounts[i.topicTag] = (topicCounts[i.topicTag] || 0) + 1
    }
  }
  const recentTopics = Object.entries(topicCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic]) => topic)

  return {
    topicCounts,
    recentTopics,
    totalInteractions: interactions.length,
  }
}

export async function getInteractionSummary(token) {
  try {
    const resp = await fetch(`${getApiBase()}/api/interactions/summary`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!resp.ok) return null
    return resp.json()
  } catch {
    return null
  }
}

export async function syncLocalInteractions(userId, token) {
  const local = getLocalInteractions()
  if (!local.length || !userId || !token) return

  try {
    await fetch(`${getApiBase()}/api/interactions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        interactions: local.map(i => ({
          bill_id: i.billId,
          action_type: i.actionType,
          topic_tag: i.topicTag,
        })),
      }),
    })
    sessionStorage.removeItem(STORAGE_KEY)
  } catch {
    // keep local data if sync fails
  }
}
