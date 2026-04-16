#!/usr/bin/env node
// Spawn api/server.js, wait for the boot banner, then hit /api/health.
// Exit 0 only if both succeed. Exit 1 on crash, timeout, or bad health.
//
// This is the gate that would have caught Pass 2's duplicate-const crash.
// The /api/health step adds coverage for middleware/route-mount bugs that
// don't throw at module eval but break the request path.

import { spawn } from 'node:child_process'

const BANNER = 'CapitolKey server running on'
const BOOT_TIMEOUT_MS = 30_000
const HEALTH_ATTEMPTS = 5
const HEALTH_BACKOFF_MS = 500
const HEALTH_REQ_TIMEOUT_MS = 3_000
const PORT = process.env.SMOKE_PORT || '3099'

// Placeholder env so "MISSING" warnings stay warnings and nothing throws
// at eval. Real secrets are never needed for boot.
const env = {
  ...process.env,
  PORT,
  NODE_ENV: 'test',
  CONGRESS_API_KEY: process.env.CONGRESS_API_KEY || '',
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
  GROQ_API_KEY: process.env.GROQ_API_KEY || '',
  SUPABASE_URL: process.env.SUPABASE_URL || '',
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || '',
  RESEND_API_KEY: process.env.RESEND_API_KEY || '',
  FCM_SERVICE_ACCOUNT: process.env.FCM_SERVICE_ACCOUNT || '',
  LEGISCAN_API_KEY: process.env.LEGISCAN_API_KEY || '',
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:5173',
}

// Match production's start command exactly (npm start uses --import
// ./instrument.js so Sentry's OpenTelemetry hooks wrap Express before
// server.js imports it). If instrument.js has a syntax or import error,
// this smoke will catch it before it hits Railway.
const child = spawn(process.execPath, ['--import', './instrument.js', 'api/server.js'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdoutBuf = ''
let bannerHandled = false
let done = false

function finish(code, msg) {
  if (done) return
  done = true
  if (msg) console.log(`[ci-boot-smoke] ${msg}`)
  try { child.kill('SIGTERM') } catch {}
  setTimeout(() => {
    try { child.kill('SIGKILL') } catch {}
    process.exit(code)
  }, 1500).unref()
}

async function healthCheck() {
  const url = `http://127.0.0.1:${PORT}/api/health`
  for (let i = 1; i <= HEALTH_ATTEMPTS; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(HEALTH_REQ_TIMEOUT_MS) })
      if (res.ok) {
        const body = await res.text()
        console.log(`[ci-boot-smoke] /api/health ${res.status}: ${body.slice(0, 200)}`)
        return true
      }
      console.error(`[ci-boot-smoke] /api/health ${i}/${HEALTH_ATTEMPTS}: HTTP ${res.status}`)
    } catch (e) {
      console.error(`[ci-boot-smoke] /api/health ${i}/${HEALTH_ATTEMPTS}: ${e.message}`)
    }
    if (i < HEALTH_ATTEMPTS) await new Promise(r => setTimeout(r, HEALTH_BACKOFF_MS))
  }
  return false
}

child.stdout.on('data', async (d) => {
  const s = d.toString()
  process.stdout.write(s)
  stdoutBuf += s
  if (bannerHandled || !stdoutBuf.includes(BANNER)) return
  bannerHandled = true
  const healthy = await healthCheck()
  finish(
    healthy ? 0 : 1,
    healthy ? 'boot OK (banner + /api/health 200)' : 'boot FAILED (/api/health did not respond 200)'
  )
})

child.stderr.on('data', (d) => process.stderr.write(d.toString()))

child.on('exit', (code, signal) => {
  if (done) return
  finish(
    code === 0 ? 1 : (code ?? 1),
    `server exited before banner (code=${code} signal=${signal})`
  )
})

child.on('error', (err) => finish(1, `spawn error: ${err.message}`))

setTimeout(() => {
  if (!bannerHandled) finish(1, `timeout after ${BOOT_TIMEOUT_MS}ms waiting for "${BANNER}"`)
}, BOOT_TIMEOUT_MS).unref()
