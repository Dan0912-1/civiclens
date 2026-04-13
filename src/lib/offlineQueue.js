import { supabase } from './supabase'

const STORAGE_KEY = 'ck_offline_queue'
const MAX_QUEUE_SIZE = 50

function readQueue() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
  } catch {
    return []
  }
}

function writeQueue(queue) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue))
}

/**
 * Add a failed request to the offline queue for later replay.
 * @param {string} url - The request URL (or a descriptor like 'supabase:bookmarks:upsert')
 * @param {string} method - HTTP method (POST, DELETE, etc.)
 * @param {object|string} body - Request body (will be JSON-stringified if object)
 * @param {object} [headers] - Optional headers to include on replay
 */
export function enqueue(url, method, body, headers = {}) {
  const queue = readQueue()
  queue.push({
    url,
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers,
    timestamp: Date.now(),
  })
  // Drop oldest items if over max size
  while (queue.length > MAX_QUEUE_SIZE) {
    queue.shift()
  }
  writeQueue(queue)
}

/**
 * Replay a single Supabase bookmark operation.
 * Returns true on success, false on network error, null on client error (discard).
 */
async function replaySupabaseBookmark(item) {
  if (!supabase) return null // can't replay without client — discard
  const body = JSON.parse(item.body)

  if (item.method === 'POST') {
    // upsert bookmark
    const { error } = await supabase
      .from('bookmarks')
      .upsert(
        { user_id: body.user_id, bill_id: body.bill_id, bill_data: body.bill_data },
        { onConflict: 'user_id,bill_id' },
      )
    if (error) return null // treat Supabase errors as non-retryable
    return true
  }

  if (item.method === 'DELETE') {
    const { error } = await supabase
      .from('bookmarks')
      .delete()
      .eq('user_id', body.user_id)
      .eq('bill_id', body.bill_id)
    if (error) return null
    return true
  }

  return null // unknown method — discard
}

/**
 * Replay all queued requests. Removes successful ones and discards 4xx failures.
 * Stops flushing on network errors (still offline).
 */
export async function flush() {
  const queue = readQueue()
  if (!queue.length) return

  const remaining = []

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i]

    try {
      // Supabase bookmark operations stored with a descriptor URL
      if (item.url === 'supabase:bookmarks') {
        const result = await replaySupabaseBookmark(item)
        if (result === true) continue // success
        if (result === null) continue // non-retryable — discard
        // false = network error — keep remaining
        remaining.push(item)
        for (let j = i + 1; j < queue.length; j++) remaining.push(queue[j])
        break
      }

      // Standard fetch replay
      const resp = await fetch(item.url, {
        method: item.method,
        headers: {
          'Content-Type': 'application/json',
          ...item.headers,
        },
        body: item.body,
      })
      if (resp.ok) continue
      if (resp.status >= 400 && resp.status < 500) continue // discard
      // Server error (5xx) — keep for retry
      remaining.push(item)
    } catch {
      // Network error — still offline, keep this and all remaining items
      remaining.push(item)
      for (let j = i + 1; j < queue.length; j++) remaining.push(queue[j])
      break
    }
  }

  writeQueue(remaining)
}

/**
 * Returns the number of pending items in the offline queue.
 */
export function getPendingCount() {
  return readQueue().length
}
