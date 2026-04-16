#!/usr/bin/env node
// Spawn api/server.js and wait for the boot banner.
// Exit 0 on success, 1 on crash or timeout.
//
// This is the gate that would have caught Pass 2's duplicate-const crash:
// Railway logs showed the same SyntaxError at module evaluation that this
// script surfaces in under two seconds.

import { spawn } from 'node:child_process'

const BANNER = 'CapitolKey server running on'
const TIMEOUT_MS = 30_000
const PORT = process.env.SMOKE_PORT || '3099'

// Provide harmless placeholder env so "MISSING" warnings stay warnings and
// nothing throws at eval time. Real secrets are never needed for boot.
const env = {
  ...process.env,
  PORT,
  NODE_ENV: 'test',
  // Explicitly blank any real keys the runner might inherit; boot must not
  // depend on them. Routes that need a key degrade gracefully.
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

const child = spawn(process.execPath, ['api/server.js'], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
})

let stdoutBuf = ''
let stderrBuf = ''
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

child.stdout.on('data', (d) => {
  const s = d.toString()
  process.stdout.write(s)
  stdoutBuf += s
  if (stdoutBuf.includes(BANNER)) {
    finish(0, 'boot OK (banner seen)')
  }
})

child.stderr.on('data', (d) => {
  const s = d.toString()
  process.stderr.write(s)
  stderrBuf += s
})

child.on('exit', (code, signal) => {
  if (done) return
  finish(
    code === 0 ? 1 : (code ?? 1),
    `server exited before banner (code=${code} signal=${signal})`
  )
})

child.on('error', (err) => {
  finish(1, `spawn error: ${err.message}`)
})

setTimeout(() => {
  finish(1, `timeout after ${TIMEOUT_MS}ms waiting for "${BANNER}"`)
}, TIMEOUT_MS).unref()
