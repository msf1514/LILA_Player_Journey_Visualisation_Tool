/**
 * build.mjs — turns 1,243 parquet files into one compact bundle the browser can fetch.
 *
 * Run: `npm run build:data`   Outputs: public/bundle.bin, public/meta.json
 *
 * WHY A BINARY BUNDLE, NOT JSON
 * The full dataset is only ~89k rows. Measured encodings:
 *     raw parquet, 1,243 files ...... 8.37 MB
 *     naive JSON .................... 15.45 MB  (2.40 MB gzipped)
 *     this columnar binary .......... ~2.1 MB   (~1.1 MB gzipped)
 * At ~1 MB over the wire the whole dataset ships to the client in a single request, which
 * is what lets the tool run with no backend at all — nothing to cold-start, nothing to fall
 * over while someone is evaluating it.
 *
 * WHY RAW ROWS INSTEAD OF PRECOMPUTED HEATMAPS
 * Precomputing aggregates would be smaller still, but it locks in the filter combinations
 * and destroys drill-down from a hot cell to the individual runs beneath it. Aggregating
 * 89k rows in the browser costs single-digit milliseconds, so there is nothing to buy.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'
import { parquetReadObjects } from 'hyparquet'
import { normalizeRow, describeEvent, isDeathEvent, isKillEvent } from './transform.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DATA_DIR = join(ROOT, 'player_data')
const OUT_DIR = join(ROOT, 'public')

const mapConfig = JSON.parse(readFileSync(join(HERE, 'mapConfig.json'), 'utf8')).maps

/** Day folders, in order. Note: folder names are UTC days and align with `ts` at 99.5%. */
function dayFolders() {
  return readdirSync(DATA_DIR)
    .filter((d) => /^February_\d+$/.test(d) && statSync(join(DATA_DIR, d)).isDirectory())
    .sort((a, b) => Number(a.split('_')[1]) - Number(b.split('_')[1]))
}

/**
 * Read every journey file exactly once.
 *
 * DEDUPE BY FILENAME, NEVER BY ROW.
 * One file — cfa03e9f-…_ac049b28-….nakama-0 — exists in both February_10 and February_11
 * and is byte-identical (same SHA-256), 88 rows. First occurrence wins.
 *
 * Row-level de-duplication would be a serious bug: 2,864 byte-identical rows across 449
 * files are legitimate. `ts` has one-second resolution, so a player looting three items
 * from one container in one second produces three identical rows. Calling drop_duplicates
 * here would delete ~18% of all loot events and quietly ruin the densest signal we have.
 */
async function readAll() {
  const rows = []
  const seenFiles = new Set()
  const duplicateFiles = []
  let filesOnDisk = 0
  let rowsSkipped = 0

  for (const day of dayFolders()) {
    for (const name of readdirSync(join(DATA_DIR, day))) {
      if (!name.endsWith('.nakama-0')) continue
      filesOnDisk++

      const buf = readFileSync(join(DATA_DIR, day, name))
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
      // No `compressors` option: hyparquet's built-in Snappy handles these files.
      // Passing hysnappy here fails with "decompressed page length 2 does not match header 40".
      const raw = await parquetReadObjects({ file: ab })

      if (seenFiles.has(name)) {
        duplicateFiles.push({ name, day, rows: raw.length })
        rowsSkipped += raw.length
        continue
      }
      seenFiles.add(name)

      for (const r of raw) rows.push({ ...normalizeRow(r, mapConfig), file: name, day })
    }
  }
  return { rows, filesOnDisk, uniqueFiles: seenFiles.size, duplicateFiles, rowsSkipped }
}

/** Stable dictionary in first-seen order. */
function dictionary(values) {
  const list = []
  const index = new Map()
  for (const v of values) {
    if (!index.has(v)) { index.set(v, list.length); list.push(v) }
  }
  return { list, index }
}

async function main() {
  const t0 = Date.now()
  console.log('Reading parquet …')
  const { rows, filesOnDisk, uniqueFiles, duplicateFiles, rowsSkipped } = await readAll()
  console.log(`  ${rows.length.toLocaleString()} rows from ${uniqueFiles} unique files ` +
              `(${filesOnDisk} on disk) in ${((Date.now() - t0) / 1000).toFixed(1)}s`)
  for (const d of duplicateFiles) {
    console.log(`  duplicate file skipped: ${d.name} (also in ${d.day}, ${d.rows} rows)`)
  }

  // ── Match-relative time ───────────────────────────────────────────────────
  // The timeline is normalised to match-elapsed seconds, not wall-clock. Matches are
  // independent sessions spread over five days, so only relative time aligns them — which
  // is what lets one scrubber answer "where is everyone at minute 3" across every match
  // in the current filter.
  const matchStart = new Map()
  for (const r of rows) {
    const cur = matchStart.get(r.matchId)
    if (cur === undefined || r.t < cur) matchStart.set(r.matchId, r.t)
  }

  // Sort so each journey is contiguous: cheaper path building, better compression.
  rows.sort((a, b) =>
    a.mapId.localeCompare(b.mapId) || a.matchId.localeCompare(b.matchId) ||
    a.userId.localeCompare(b.userId) || a.t - b.t)

  const users   = dictionary(rows.map((r) => r.userId))
  const matches = dictionary(rows.map((r) => r.matchId))
  const maps    = dictionary(rows.map((r) => r.mapId))
  const events  = dictionary(rows.map((r) => r.event))

  if (users.list.length > 65535 || matches.list.length > 65535) {
    throw new Error('dictionary exceeds Uint16 range — widen the column encoding')
  }

  // ── Columnar layout ───────────────────────────────────────────────────────
  // 24 bytes/row. Ordered widest-first so every typed array lands on its natural alignment.
  //   x,z,y (f32) + tSec (u32) = 16n | user,match,elapsed (u16) = 6n | map,event (u8) = 2n
  // `t` is stored as epoch SECONDS in a Uint32: epoch ms overflows u32, and the source
  // resolution is one second anyway, so nothing is lost.
  const n = rows.length
  const bytes = new ArrayBuffer(24 * n)
  const x       = new Float32Array(bytes, 0, n)
  const z       = new Float32Array(bytes, 4 * n, n)
  const y       = new Float32Array(bytes, 8 * n, n)
  const tSec    = new Uint32Array(bytes, 12 * n, n)
  const userIdx = new Uint16Array(bytes, 16 * n, n)
  const matchIdx= new Uint16Array(bytes, 18 * n, n)
  const elapsed = new Uint16Array(bytes, 20 * n, n)
  const mapIdx  = new Uint8Array(bytes, 22 * n, n)
  const evIdx   = new Uint8Array(bytes, 23 * n, n)

  let maxElapsed = 0
  rows.forEach((r, i) => {
    x[i] = r.x; z[i] = r.z; y[i] = r.y
    tSec[i] = Math.round(r.t / 1000)
    userIdx[i] = users.index.get(r.userId)
    matchIdx[i] = matches.index.get(r.matchId)
    const e = Math.round((r.t - matchStart.get(r.matchId)) / 1000)
    if (e > maxElapsed) maxElapsed = e
    elapsed[i] = Math.min(e, 65535)
    mapIdx[i] = maps.index.get(r.mapId)
    evIdx[i] = events.index.get(r.event)
  })
  if (maxElapsed > 65535) console.warn(`  WARNING: elapsed ${maxElapsed}s clipped to Uint16`)

  // ── Per-match metadata ────────────────────────────────────────────────────
  // Powers the match picker. Crucially it exposes participant counts: 743 of 796 matches
  // hold a single journey file, so a naive picker would keep dropping designers into a
  // match with one lonely dot. The UI uses `journeys` to surface the ~53 real ones.
  const byMatch = new Map()
  for (const r of rows) {
    let m = byMatch.get(r.matchId)
    if (!m) {
      m = { id: r.matchId, map: r.mapId, t0: r.t, t1: r.t,
            files: new Set(), humans: new Set(), bots: new Set(),
            kills: 0, deaths: 0, loot: 0, storm: 0, pvp: 0 }
      byMatch.set(r.matchId, m)
    }
    if (r.t < m.t0) m.t0 = r.t
    if (r.t > m.t1) m.t1 = r.t
    m.files.add(r.file)
    ;(r.bot ? m.bots : m.humans).add(r.userId)
    const d = describeEvent(r.event)
    if (isKillEvent(r.event)) m.kills++
    if (isDeathEvent(r.event)) m.deaths++
    if (d.category === 'loot') m.loot++
    if (d.cause === 'storm') m.storm++
    if (d.pvp) m.pvp++
  }

  const matchMeta = matches.list.map((id) => {
    const m = byMatch.get(id)
    return {
      map: m.map,
      date: new Date(m.t0).toISOString().slice(0, 10),
      start: Math.round(m.t0 / 1000),
      duration: Math.round((m.t1 - m.t0) / 1000),
      journeys: m.files.size,
      humans: m.humans.size,
      bots: m.bots.size,
      kills: m.kills, deaths: m.deaths, loot: m.loot, storm: m.storm, pvp: m.pvp,
    }
  })

  // ── Dataset-level stats (drives the honesty banner) ───────────────────────
  const eventCounts = {}
  for (const r of rows) eventCounts[r.event] = (eventCounts[r.event] ?? 0) + 1
  const combatInstants = new Set()
  for (const r of rows) if (isKillEvent(r.event) || isDeathEvent(r.event)) combatInstants.add(`${r.file}|${r.t}`)
  const dates = [...new Set(rows.map((r) => new Date(r.t).toISOString().slice(0, 10)))].sort()
  const outOfBounds = rows.reduce((a, r) => a + (r.inBounds ? 0 : 1), 0)
  const ambiguous = [...new Set(rows.filter((r) => r.ambiguous).map((r) => r.userId))].sort()

  // Playable-land masks from `npm run build:maps`. Optional so `build:data` can run alone
  // during development; the dead-space layer degrades to "unavailable" without them.
  let masks = null
  const masksPath = join(HERE, 'masks.json')
  if (existsSync(masksPath)) masks = JSON.parse(readFileSync(masksPath, 'utf8'))
  else console.warn('  note: pipeline/masks.json missing — run `npm run build:maps` for the dead-space layer')

  const meta = {
    generated: new Date().toISOString(),
    rows: n,
    masks,
    columns: ['x', 'z', 'y', 'tSec', 'userIdx', 'matchIdx', 'elapsed', 'mapIdx', 'evIdx'],
    bytesPerRow: 24,
    dict: { users: users.list, matches: matches.list, maps: maps.list, events: events.list },
    mapConfig,
    matchMeta,
    stats: {
      filesOnDisk, uniqueFiles,
      duplicateFilesSkipped: duplicateFiles.map((d) => d.name),
      rowsSkippedFromDuplicates: rowsSkipped,
      humans: users.list.filter((u) => !byMatchHasBot(u)).length,
      bots: users.list.filter((u) => byMatchHasBot(u)).length,
      matches: matches.list.length,
      dates, eventCounts, combatInstants: combatInstants.size,
      outOfBounds,
      ambiguousActors: ambiguous,
      maxElapsedSeconds: maxElapsed,
    },
  }
  function byMatchHasBot(u) { return !/^[0-9a-f]{8}-/i.test(u) }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const bin = Buffer.from(bytes)
  writeFileSync(join(OUT_DIR, 'bundle.bin'), bin)
  writeFileSync(join(OUT_DIR, 'meta.json'), JSON.stringify(meta))
  const metaBuf = Buffer.from(JSON.stringify(meta))

  console.log('\nBundle')
  console.log(`  bundle.bin  ${(bin.length / 1e6).toFixed(2)} MB  → ${(gzipSync(bin).length / 1e6).toFixed(2)} MB gzipped`)
  console.log(`  meta.json   ${(metaBuf.length / 1e3).toFixed(0)} KB  → ${(gzipSync(metaBuf).length / 1e3).toFixed(0)} KB gzipped`)
  console.log('\nDataset')
  console.log(`  rows ${n.toLocaleString()} · users ${users.list.length} · matches ${matches.list.length} · maps ${maps.list.join(', ')}`)
  console.log(`  dates ${dates[0]} → ${dates[dates.length - 1]}`)
  console.log(`  out-of-bounds ${outOfBounds} · combat instants ${combatInstants.size} · ambiguous actors ${ambiguous.join(', ') || 'none'}`)
  console.log(`  events ${JSON.stringify(eventCounts)}`)
  console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s`)

  if (outOfBounds > 0) throw new Error(`${outOfBounds} rows fall outside the minimap — check mapConfig.json`)
}

main().catch((err) => { console.error(err); process.exit(1) })
