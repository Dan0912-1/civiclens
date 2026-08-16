#!/usr/bin/env node
// Build the ZIP → congressional district lookup used by /api/representatives.
//
// Source: the Census Bureau's official ZCTA-to-Congressional-District
// relationship file for the 119th Congress. One row per (district, ZCTA)
// intersection, with the land area of the overlap — which is what lets us tell
// a ZIP that sits wholly inside one district (82.6% of them) from one that
// straddles two, and rank the parts of a split ZIP by how much of it each
// district holds.
//
//   node scripts/build-zip-districts.mjs
//
// Re-run after a redistricting cycle, or when the Census publishes the CD120
// file (change SRC below — the filename encodes the Congress: cd11920).
//
// Output format keeps the file small enough to load at boot: one key per ZIP,
// value is a comma-joined list of 4-character state+district GEOIDs ordered by
// how much of the ZIP each covers, most first.
//
//   { "99501": "0200",        // Anchorage — Alaska at-large ("00" = at-large)
//     "06001": "0905,0901" }  // Avon CT — mostly CT-05, a sliver of CT-01

import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DEST = join(ROOT, 'api', 'assets', 'data', 'zip-districts.json')
const SRC = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/cd-sld/tab20_cd11920_zcta520_natl.txt'

// A district holding less than this share of a ZIP's land is a boundary
// sliver, not somewhere the student plausibly lives. Listing those would turn
// a clean one-district answer into a hedge — 06032 splits 100%/0.02% and the
// second district is noise.
const MIN_SHARE = 0.01

const resp = await fetch(SRC)
if (!resp.ok) {
  console.error(`fetch failed: ${resp.status} ${resp.statusText}`)
  process.exit(1)
}
// The file is pipe-delimited and carries a UTF-8 BOM.
const text = (await resp.text()).replace(/^﻿/, '')
const lines = text.split(/\r?\n/).filter(Boolean)
const header = lines[0].split('|')
const iCd = header.indexOf('GEOID_CD119_20')
const iZip = header.indexOf('GEOID_ZCTA5_20')
const iArea = header.indexOf('AREALAND_PART')
if (iCd < 0 || iZip < 0 || iArea < 0) {
  console.error('unexpected header — column names changed:', header.join('|'))
  process.exit(1)
}

const byZip = new Map()
for (const line of lines.slice(1)) {
  const f = line.split('|')
  const zip = (f[iZip] || '').trim()
  const cd = (f[iCd] || '').trim()
  // Rows with no ZCTA are the district's own summary row, not an intersection.
  if (!zip || !cd) continue
  const area = Number(f[iArea]) || 0
  if (!byZip.has(zip)) byZip.set(zip, [])
  byZip.get(zip).push({ cd, area })
}

const out = {}
for (const [zip, parts] of byZip) {
  const total = parts.reduce((s, p) => s + p.area, 0)
  const ranked = parts.slice().sort((a, b) => b.area - a.area)
  // Keep everything above the sliver threshold; if the areas are all zero
  // (water-only ZCTAs), keep the first so the ZIP still resolves to something.
  const kept = total > 0 ? ranked.filter(p => p.area / total >= MIN_SHARE) : ranked.slice(0, 1)
  out[zip] = (kept.length ? kept : ranked.slice(0, 1)).map(p => p.cd).join(',')
}

const zips = Object.keys(out).length
if (zips < 30000) {
  console.error(`refusing to write: only ${zips} ZIPs parsed`)
  process.exit(1)
}
writeFileSync(DEST, JSON.stringify(out))
const single = Object.values(out).filter(v => !v.includes(',')).length
console.log(`✓ zip-districts.json: ${zips} ZIPs, ${single} single-district (${(single / zips * 100).toFixed(1)}%)`)
