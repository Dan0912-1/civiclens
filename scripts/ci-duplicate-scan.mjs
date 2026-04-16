#!/usr/bin/env node
// Cross-file duplicate-declaration scan for api/.
//
// Within a single ESM module a duplicate `const` is a SyntaxError that
// `node --check` catches. This script covers the next risk: the same
// identifier being declared (not just imported) in multiple modules and
// then re-exported from both, which is a latent bug waiting for someone
// to import both sides. Pass 2's VALID_TOPIC_TAGS collision was a
// single-file version of this; once server.js is split, cross-file
// matters more.
//
// It flags top-level declarations of the same name in more than one
// file. Pure re-exports and imports are ignored.

import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const ROOTS = ['api']
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'ios', 'android', 'public'])

async function walk(dir, out = []) {
  const entries = await readdir(dir, { withFileTypes: true })
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) await walk(full, out)
    else if (e.isFile() && /\.(m?js)$/.test(e.name)) out.push(full)
  }
  return out
}

// Matches top-level: const/let/var NAME, function NAME, class NAME.
// Ignores `export { NAME }` re-exports and `import { NAME }`.
const DECL = /^(?:export\s+)?(?:const|let|var|function|async\s+function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/gm

const files = []
for (const r of ROOTS) {
  try { files.push(...await walk(r)) } catch {}
}

const bySymbol = new Map()
for (const file of files) {
  const src = await readFile(file, 'utf8')
  const seenInFile = new Set()
  for (const m of src.matchAll(DECL)) {
    const name = m[1]
    if (seenInFile.has(name)) continue
    seenInFile.add(name)
    if (!bySymbol.has(name)) bySymbol.set(name, [])
    bySymbol.get(name).push(file)
  }
}

// Names that are allowed to collide (common helpers, or intentionally
// duplicated handler-scoped constants).
const ALLOWLIST = new Set([
  'handler',
  'router',
  'limit',
  'log',
  'supabase', // many route files may wrap a supabase client locally
])

const dupes = [...bySymbol.entries()]
  .filter(([name, files]) => files.length > 1 && !ALLOWLIST.has(name))

if (dupes.length === 0) {
  console.log('[duplicate-scan] no cross-file duplicates in api/')
  process.exit(0)
}

console.error('[duplicate-scan] cross-file duplicate declarations found:')
for (const [name, files] of dupes) {
  console.error(`  ${name}`)
  for (const f of files) console.error(`    ${f}`)
}
console.error(
  '\nIf the duplicate is intentional, add the name to ALLOWLIST in scripts/ci-duplicate-scan.mjs.'
)
process.exit(1)
