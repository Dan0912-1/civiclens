#!/usr/bin/env node
/**
 * CapitolKey — Sentry auto-fix scanner (READ-ONLY).
 *
 * Drives .github/workflows/sentry-autofix.yml. Two subcommands, both read-only
 * against Sentry and the repo — neither one changes any code or any Sentry state.
 *
 *   scan            Find newly-seen, unresolved Sentry issues that do NOT already
 *                   have an autofix branch/PR, and print ONE line of JSON to
 *                   stdout:
 *                       {"count":N,"issues":[{id,shortId,branch,project,...}]}
 *                   The workflow turns each issue into one fix-job (a matrix cell)
 *                   that opens a single draft PR. All human logging goes to stderr
 *                   so stdout stays parseable.
 *
 *   context <id>    Print a plain-text context block for one issue (latest event:
 *                   exception, in-app stack frames, request, tags, breadcrumbs) for
 *                   a fix session to read before it writes the fix.
 *
 * Dedup: an issue is skipped when a PR (any state) or remote branch already exists
 * for its shortId. The PRs themselves ARE the state — no extra state file, and the
 * same error is never fixed twice. Requires `gh` + a token (GH_TOKEN); if `gh` is
 * unavailable, dedup is skipped with a warning rather than failing the run.
 *
 * Env:
 *   SENTRY_AUTH_TOKEN          (required)  Sentry auth token. Scopes: event:read, project:read
 *   SENTRY_ORG                 (required)  org slug
 *   SENTRY_PROJECTS            (required)  comma-separated project slugs (e.g. "ck-frontend,ck-backend")
 *   SENTRY_HOST                (optional)  default https://sentry.io (set for self-hosted)
 *   AUTOFIX_QUERY              (optional)  full Sentry search override; default "is:unresolved firstSeen:-<window>"
 *   AUTOFIX_FIRST_SEEN_WINDOW  (optional)  default "14d" — only issues first seen this recently count as "new"
 *   AUTOFIX_MAX_PER_RUN        (optional)  default 3 (clamped 1..10) — caps PRs opened per run
 *   GH_TOKEN / GITHUB_TOKEN                used by `gh` for PR/branch dedup (set automatically in Actions)
 *
 * Usage:
 *   node scripts/sentry-autofix.mjs scan
 *   node scripts/sentry-autofix.mjs context 1234567890
 */

import { execFileSync } from 'node:child_process'

const HOST = (process.env.SENTRY_HOST || 'https://sentry.io').replace(/\/+$/, '')
const TOKEN = process.env.SENTRY_AUTH_TOKEN
const ORG = process.env.SENTRY_ORG
const REQ_TIMEOUT_MS = 20_000

// Sentry shortIds look like CAPITOLKEY-FRONTEND-2K: uppercase alnum groups
// joined by dashes. Validate before we ever put one in a branch name, a shell
// command, or the workflow prompt, so untrusted-ish data can't inject.
const SHORT_ID_RE = /^[A-Z0-9]+(?:-[A-Z0-9]+)+$/
const ISSUE_ID_RE = /^\d+$/

function die(msg) {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function requireEnv() {
  const missing = ['SENTRY_AUTH_TOKEN', 'SENTRY_ORG', 'SENTRY_PROJECTS'].filter((k) => !process.env[k])
  if (missing.length) die(`Missing required env: ${missing.join(', ')}`)
}

async function sentry(path, { acceptMissing = false } = {}) {
  const url = `${HOST}/api/0${path}`
  let res
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(REQ_TIMEOUT_MS),
    })
  } catch (e) {
    throw new Error(`Sentry request failed (${path}): ${e.message}`)
  }
  if (res.status === 404 && acceptMissing) return null
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Sentry ${res.status} for ${path}: ${body.slice(0, 300)}`)
  }
  return res.json()
}

// ─── scan ────────────────────────────────────────────────────────────────────

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Branch/PR shortIds already in flight, so we never fix the same issue twice. */
function handledShortIds() {
  const handled = new Set()
  // Open + closed + merged PRs: match the autofix branch or the [SHORT-ID] tag.
  try {
    const prs = JSON.parse(gh(['pr', 'list', '--state', 'all', '--limit', '300', '--json', 'title,headRefName']))
    for (const pr of prs) {
      const ref = (pr.headRefName || '').toLowerCase()
      const m = ref.match(/^autofix\/sentry-(.+)$/)
      if (m) handled.add(m[1])
      for (const tag of (pr.title || '').matchAll(/\[([A-Z0-9-]+)\]/g)) handled.add(tag[1].toLowerCase())
    }
  } catch (e) {
    console.error(`⚠ PR dedup skipped (gh unavailable: ${String(e.message).split('\n')[0]})`)
  }
  // In-flight branches that may not have a PR yet.
  try {
    const out = execFileSync('git', ['ls-remote', '--heads', 'origin', 'autofix/sentry-*'], { encoding: 'utf8' })
    for (const line of out.split('\n')) {
      const m = line.match(/refs\/heads\/autofix\/sentry-(.+)$/)
      if (m) handled.add(m[1].toLowerCase())
    }
  } catch {
    /* no remote / no matching branches — fine */
  }
  return handled
}

async function scan() {
  requireEnv()
  const projects = process.env.SENTRY_PROJECTS.split(',').map((s) => s.trim()).filter(Boolean)
  const window = process.env.AUTOFIX_FIRST_SEEN_WINDOW || '14d'
  const query = process.env.AUTOFIX_QUERY || `is:unresolved firstSeen:-${window}`
  const max = Math.min(10, Math.max(1, parseInt(process.env.AUTOFIX_MAX_PER_RUN || '3', 10) || 3))

  console.error(`→ org=${ORG} projects=[${projects.join(', ')}] query="${query}" max=${max}`)

  const seen = new Map() // shortId -> issue (dedupe across projects)
  for (const project of projects) {
    const qs = new URLSearchParams({ query, sort: 'freq', limit: '25', statsPeriod: '14d' })
    let rows
    try {
      rows = await sentry(`/projects/${ORG}/${project}/issues/?${qs}`)
    } catch (e) {
      console.error(`⚠ project "${project}" skipped: ${e.message}`)
      continue
    }
    console.error(`  ${project}: ${rows.length} issue(s) match`)
    for (const r of rows) {
      const shortId = r.shortId
      if (!ISSUE_ID_RE.test(String(r.id)) || !SHORT_ID_RE.test(shortId || '')) {
        console.error(`  ⚠ skipping malformed issue id/shortId: ${r.id} / ${shortId}`)
        continue
      }
      if (!seen.has(shortId)) {
        seen.set(shortId, {
          id: String(r.id),
          shortId,
          branch: `autofix/sentry-${shortId.toLowerCase()}`,
          project,
          level: r.level || 'error',
          count: Number(r.count) || 0,
          title: r.title || r.metadata?.value || r.culprit || shortId,
          permalink: r.permalink || '',
        })
      }
    }
  }

  const handled = handledShortIds()
  const fresh = [...seen.values()].filter((i) => {
    const already = handled.has(i.shortId.toLowerCase())
    if (already) console.error(`  ↷ ${i.shortId} already has a branch/PR — skipping`)
    return !already
  })

  // Most-frequent first, then cap, so a spike of new issues gets the highest-
  // impact ones fixed and the rest wait for the next run.
  fresh.sort((a, b) => b.count - a.count)
  const issues = fresh.slice(0, max)

  console.error(
    issues.length
      ? `✓ ${issues.length} issue(s) queued for fixing: ${issues.map((i) => i.shortId).join(', ')}`
      : '✓ nothing new to fix',
  )
  process.stdout.write(JSON.stringify({ count: issues.length, issues }))
}

// ─── context ───────────────────────────────────────────────────────────────—

function frameLine(f) {
  const where = f.filename || f.absPath || f.module || '<unknown>'
  const pos = [f.lineNo, f.colNo].filter((n) => n != null).join(':')
  const fn = f.function ? ` in ${f.function}` : ''
  const tag = f.inApp ? '  [in-app]' : ''
  return `    at ${where}${pos ? `:${pos}` : ''}${fn}${tag}`
}

function formatContext(issue, event) {
  const out = []
  out.push(`SENTRY ISSUE ${issue.shortId}  (id ${issue.id})`)
  out.push(
    `project=${issue.project?.slug || '?'}  level=${issue.level || '?'}  events=${issue.count || '?'}  ` +
      `firstSeen=${issue.firstSeen || '?'}  lastSeen=${issue.lastSeen || '?'}`,
  )
  if (issue.permalink) out.push(`permalink: ${issue.permalink}`)
  out.push(`title: ${issue.title || ''}`)
  if (issue.culprit) out.push(`culprit: ${issue.culprit}`)

  if (!event) {
    out.push('\n(no sample event available)')
    return out.join('\n')
  }

  const entries = event.entries || []
  const exc = entries.find((e) => e.type === 'exception')
  if (exc) {
    out.push('\nEXCEPTION')
    for (const v of exc.data?.values || []) {
      out.push(`  ${v.type || 'Error'}: ${v.value || ''}`)
      const frames = v.stacktrace?.frames || []
      // Sentry lists oldest -> newest; the throwing frame is last. Show in-app
      // frames in full plus a little surrounding framework context, newest first.
      const ordered = [...frames].reverse().slice(0, 30)
      for (const f of ordered) out.push(frameLine(f))
    }
  }

  const msg = entries.find((e) => e.type === 'message')
  if (msg?.data?.formatted) out.push(`\nMESSAGE\n  ${msg.data.formatted}`)

  const req = entries.find((e) => e.type === 'request')
  if (req?.data) out.push(`\nREQUEST\n  ${req.data.method || 'GET'} ${req.data.url || ''}`)

  const tags = event.tags || []
  if (tags.length) {
    const keep = ['environment', 'release', 'transaction', 'url', 'server_name', 'browser', 'os', 'runtime']
    const picked = tags.filter((t) => keep.includes(t.key)).map((t) => `${t.key}=${t.value}`)
    if (picked.length) out.push(`\nTAGS\n  ${picked.join('  ')}`)
  }

  const crumbs = entries.find((e) => e.type === 'breadcrumbs')
  const values = crumbs?.data?.values || []
  if (values.length) {
    out.push('\nBREADCRUMBS (last 10)')
    for (const c of values.slice(-10)) {
      out.push(`  ${c.timestamp || ''} [${c.category || c.type || '?'}] ${c.message || c.level || ''}`)
    }
  }

  return out.join('\n')
}

async function context(issueId) {
  if (!TOKEN || !ORG) die('SENTRY_AUTH_TOKEN and SENTRY_ORG are required')
  if (!ISSUE_ID_RE.test(issueId || '')) die(`Invalid issue id: ${issueId}`)
  const issue = await sentry(`/issues/${issueId}/`)
  const event = await sentry(`/issues/${issueId}/events/latest/`, { acceptMissing: true }).catch((e) => {
    console.error(`⚠ could not load latest event: ${e.message}`)
    return null
  })
  process.stdout.write(formatContext(issue, event) + '\n')
}

// ─── entry ─────────────────────────────────────────────────────────────────—

const [cmd, arg] = process.argv.slice(2)
try {
  if (cmd === 'scan') await scan()
  else if (cmd === 'context') await context(arg)
  else die(`Unknown command "${cmd || ''}". Use "scan" or "context <issueId>".`)
} catch (e) {
  die(e.message)
}
