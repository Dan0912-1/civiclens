#!/usr/bin/env node
// Refresh the committed snapshot of current members of Congress.
//
// api/representatives.js fetches this same file at runtime (once a day) and
// only falls back to the snapshot when that fetch fails. The snapshot is the
// cold-start floor, so it should be re-committed occasionally — after a
// general election, or whenever a special election seats someone new.
//
//   node scripts/refresh-legislators.mjs
//
// Source: unitedstates/congress-legislators (public domain, no API key).

import { writeFileSync, readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEST = join(ROOT, 'api', 'assets', 'data', 'legislators-current.csv')
const SRC = 'https://unitedstates.github.io/congress-legislators/legislators-current.csv'

const resp = await fetch(SRC)
if (!resp.ok) {
  console.error(`fetch failed: ${resp.status} ${resp.statusText}`)
  process.exit(1)
}
const csv = await resp.text()
const rows = csv.trim().split('\n').length - 1

// Refuse to overwrite a good snapshot with a truncated or reshaped file.
if (rows < 400 || !csv.startsWith('last_name,first_name')) {
  console.error(`refusing to write: ${rows} rows, header "${csv.slice(0, 40)}"`)
  process.exit(1)
}

const before = existsSync(DEST) ? readFileSync(DEST, 'utf8').trim().split('\n').length - 1 : 0
writeFileSync(DEST, csv)
console.log(`✓ legislators-current.csv: ${before} → ${rows} members`)
