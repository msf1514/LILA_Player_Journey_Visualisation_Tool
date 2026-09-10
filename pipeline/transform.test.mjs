/**
 * transform.test.mjs — the six golden tests.
 *
 * Run: `npm test`
 *
 * Each test pins one of the data nuances the assignment brief flags as part of the
 * evaluation ("coordinate mapping, bytes encoding, bot detection, timestamps"), plus the
 * two counting rules that are easy to get silently wrong. They are deliberately written
 * against the real dataset rather than fixtures: a fixture would still pass if the real
 * files changed shape, which is exactly the failure these are meant to catch.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { parquetReadObjects } from 'hyparquet'
import {
  normalizeTs, isBot, isAmbiguousActor, AMBIGUOUS_USER_IDS,
  worldToUV, uvToPixel, isInBounds, normalizeEvent, describeEvent,
  normalizeRow, splitOnGaps, countCombatInstants, isKillEvent, isDeathEvent,
} from './transform.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const DATA_DIR = join(ROOT, 'player_data')
const mapConfig = JSON.parse(readFileSync(join(HERE, 'mapConfig.json'), 'utf8')).maps

/** Read the whole dataset once and share it across the integration tests (~1.5s). */
let cache = null
async function dataset() {
  if (cache) return cache
  const rows = []
  const seen = new Set()
  const duplicates = []
  let filesOnDisk = 0

  const days = readdirSync(DATA_DIR)
    .filter((d) => /^February_\d+$/.test(d) && statSync(join(DATA_DIR, d)).isDirectory())
    .sort((a, b) => Number(a.split('_')[1]) - Number(b.split('_')[1]))

  for (const day of days) {
    for (const name of readdirSync(join(DATA_DIR, day))) {
      if (!name.endsWith('.nakama-0')) continue
      filesOnDisk++
      const buf = readFileSync(join(DATA_DIR, day, name))
      const raw = await parquetReadObjects({
        file: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
      })
      if (seen.has(name)) { duplicates.push({ name, day, rows: raw.length }); continue }
      seen.add(name)
      for (const r of raw) rows.push({ ...normalizeRow(r, mapConfig), file: name, day })
    }
  }
  cache = { rows, filesOnDisk, uniqueFiles: seen.size, duplicates }
  return cache
}

// ── T1 · Timestamps ─────────────────────────────────────────────────────────
// `ts` holds epoch SECONDS inside a timestamp[ms] column. Read naively it reports 1970.
describe('T1 · timestamps are epoch seconds in a millisecond column', () => {
  it('scales a raw value into February 2026, not 1970', () => {
    const naive = new Date('1970-01-21T11:52:34.537Z')       // what a naive reader returns
    expect(naive.getUTCFullYear()).toBe(1970)                 // the trap
    const real = new Date(normalizeTs(naive))                 // the fix
    expect(real.getUTCFullYear()).toBe(2026)
    expect(real.getUTCMonth()).toBe(1)                        // February (0-indexed)
  })

  it('accepts Date, number and bigint identically', () => {
    const ms = 1770681535000
    expect(normalizeTs(new Date(1770681535))).toBe(ms)
    expect(normalizeTs(1770681535)).toBe(ms)
    expect(normalizeTs(1770681535n)).toBe(ms)
  })

  it('every row in the dataset lands inside the documented Feb 2026 window', async () => {
    const { rows } = await dataset()
    let min = Infinity, max = -Infinity
    for (const r of rows) { if (r.t < min) min = r.t; if (r.t > max) max = r.t }
    expect(new Date(min).toISOString().slice(0, 10)).toBe('2026-02-09')
    expect(new Date(max).toISOString().slice(0, 10)).toBe('2026-02-14')
  })
})

// ── T2 · Coordinates ────────────────────────────────────────────────────────
// The dataset README supplies a worked example; assert it exactly.
describe('T2 · world coordinates map to the documented pixel', () => {
  it("reproduces the README's AmbroseValley example → pixel (78, 890)", () => {
    const cfg = mapConfig.AmbroseValley
    const { u, v } = worldToUV(-301.45, -355.55, cfg)
    expect(u).toBeCloseTo(0.0762, 4)
    expect(v).toBeCloseTo(0.1305, 4)
    // The README works its example at 1024x1024. Real images differ (4320/2160x2158/9000),
    // which is precisely why width and height are parameters and never assumed.
    const { px, py } = uvToPixel(u, v, 1024, 1024)
    expect(Math.round(px)).toBe(78)
    expect(Math.round(py)).toBe(890)
  })

  it('flips V, because image origin is top-left', () => {
    expect(uvToPixel(0, 0, 1000, 1000).py).toBe(1000)   // world bottom → image bottom
    expect(uvToPixel(0, 1, 1000, 1000).py).toBe(0)      // world top    → image top
  })

  it('ignores Y — it is elevation, not a map coordinate', () => {
    const cfg = mapConfig.AmbroseValley
    expect(worldToUV(100, 200, cfg)).toEqual(worldToUV(100, 200, cfg))
    const row = { user_id: 'a'.repeat(8) + '-1111-2222-3333-444444444444', match_id: 'm',
                  map_id: 'AmbroseValley', x: 0, y: 999, z: 0, ts: new Date(1770681535), event: 'Position' }
    const low  = normalizeRow({ ...row, y: 1 }, mapConfig)
    const high = normalizeRow({ ...row, y: 999 }, mapConfig)
    expect(low.u).toBe(high.u)
    expect(low.v).toBe(high.v)
  })
})

// ── T3 · Bounds ─────────────────────────────────────────────────────────────
describe('T3 · every row projects inside the minimap', () => {
  it('has zero out-of-bounds rows across all three maps', async () => {
    const { rows } = await dataset()
    const bad = rows.filter((r) => !isInBounds(r.u, r.v))
    expect(bad.length).toBe(0)
  })

  it('covers all three maps', async () => {
    const { rows } = await dataset()
    expect([...new Set(rows.map((r) => r.mapId))].sort())
      .toEqual(['AmbroseValley', 'GrandRift', 'Lockdown'])
  })
})

// ── T4 · Bot detection ──────────────────────────────────────────────────────
// Only the id SHAPE is reliable. The dataset README's event-prefix rule is wrong.
describe('T4 · bots are identified by user_id shape, not by event name', () => {
  it('classifies UUIDs as human and numeric ids as bots', () => {
    expect(isBot('f4e072fa-b7af-4761-b567-1d95b7ad0108')).toBe(false)
    expect(isBot('1440')).toBe(true)
    expect(isBot('382')).toBe(true)
  })

  it("disproves the README's claim that only bots emit Bot* events", async () => {
    const { rows } = await dataset()
    const humansWithBotKilled = rows.filter((r) => !r.bot && r.event === 'BotKilled').length
    const botsWithPosition    = rows.filter((r) =>  r.bot && r.event === 'Position').length
    const botsWithLoot        = rows.filter((r) =>  r.bot && r.event === 'Loot').length
    expect(humansWithBotKilled).toBeGreaterThan(0)   // measured 403 raw
    expect(botsWithPosition).toBeGreaterThan(0)      // measured 636 raw
    expect(botsWithLoot).toBeGreaterThan(0)          // measured 115 raw
  })

  it('flags exactly the three accounts whose events contradict their id', async () => {
    const { rows } = await dataset()
    const flagged = [...new Set(rows.filter((r) => r.ambiguous).map((r) => r.userId))].sort()
    expect(flagged).toEqual(['1379', '1402', '1429'])
    expect(AMBIGUOUS_USER_IDS.size).toBe(3)
    expect(isAmbiguousActor('1429')).toBe(true)
    expect(isAmbiguousActor('1440')).toBe(false)
  })

  it('decodes the byte-encoded event column to a usable string', async () => {
    const { rows } = await dataset()
    expect(typeof rows[0].event).toBe('string')
    expect(normalizeEvent(new TextEncoder().encode('Position'))).toBe('Position')
    // Unknown names must degrade, never throw — there is no `Extracted` event yet.
    expect(() => describeEvent('Extracted')).not.toThrow()
    expect(describeEvent('Extracted').category).toBe('unknown')
  })
})

// ── T5 · Dedupe ─────────────────────────────────────────────────────────────
// Dedupe by FILE. Never by row: identical rows are legitimate same-second loot.
describe('T5 · deduplication removes the duplicated file and nothing else', () => {
  it('finds exactly one duplicated filename, byte-identical, worth 88 rows', async () => {
    const { filesOnDisk, uniqueFiles, duplicates } = await dataset()
    expect(filesOnDisk).toBe(1243)
    expect(uniqueFiles).toBe(1242)
    expect(duplicates.length).toBe(1)
    expect(duplicates[0].rows).toBe(88)

    const name = duplicates[0].name
    const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex')
    expect(sha(join(DATA_DIR, 'February_10', name))).toBe(sha(join(DATA_DIR, 'February_11', name)))
  })

  it('yields 89,016 rows after file-level dedupe', async () => {
    const { rows } = await dataset()
    expect(rows.length).toBe(89016)
  })

  it('KEEPS identical same-second loot rows — row-dedupe would destroy ~18% of loot', async () => {
    const { rows } = await dataset()
    const key = (r) => `${r.userId}|${r.matchId}|${r.t}|${r.event}|${r.x}|${r.y}|${r.z}`
    const seen = new Set()
    let identical = 0
    for (const r of rows) { const k = key(r); if (seen.has(k)) identical++; else seen.add(k) }
    expect(identical).toBeGreaterThan(1000)   // measured ~1,300 surviving duplicate rows

    const loot = rows.filter((r) => r.event === 'Loot')
    const lootKeys = new Set(loot.map(key))
    const wouldLose = loot.length - lootKeys.size
    expect(wouldLose / loot.length).toBeGreaterThan(0.05)   // proves the damage is material
  })
})

// ── T6 · Combat counting ────────────────────────────────────────────────────
// Count instants, not rows: Kill+Killed are one incident, and 1s resolution collapses multis.
describe('T6 · combat is counted by instant, not by row', () => {
  it('treats each Kill/Killed pair as ONE PvP incident, not two', async () => {
    const { rows } = await dataset()
    const pvpRows = rows.filter((r) => r.event === 'Kill' || r.event === 'Killed')
    expect(pvpRows.length).toBe(6)                                   // the trap: looks like 6
    const instants = new Set(pvpRows.map((r) => `${r.file}|${r.t}`))
    expect(instants.size).toBe(3)                                    // the truth: 3 incidents

    // Each pair shares one file, one timestamp and one position.
    for (const inst of instants) {
      const pair = pvpRows.filter((r) => `${r.file}|${r.t}` === inst)
      expect(pair.length).toBe(2)
      expect(new Set(pair.map((r) => r.event))).toEqual(new Set(['Kill', 'Killed']))
      expect(pair[0].x).toBe(pair[1].x)
      expect(pair[0].z).toBe(pair[1].z)
    }
  })

  it('collapses same-second multi-kills', async () => {
    const { rows } = await dataset()
    const kills = rows.filter((r) => r.event === 'BotKill')
    const instants = new Set(kills.map((r) => `${r.file}|${r.t}`))
    expect(kills.length).toBeGreaterThan(instants.size)   // rows 2,410 → instants 2,356
  })

  it('countCombatInstants counts kills and deaths but not loot or movement', () => {
    const rows = [
      { file: 'f', t: 1, event: 'BotKill' },
      { file: 'f', t: 1, event: 'BotKill' },   // same instant → counts once
      { file: 'f', t: 2, event: 'Loot' },      // not combat
      { file: 'f', t: 3, event: 'Position' },  // not combat
      { file: 'f', t: 4, event: 'KilledByStorm' },
    ]
    expect(countCombatInstants(rows)).toBe(2)
    expect(isKillEvent('BotKill')).toBe(true)
    expect(isDeathEvent('KilledByStorm')).toBe(true)
    expect(isKillEvent('Loot')).toBe(false)
  })
})

// ── Path integrity ──────────────────────────────────────────────────────────
// Not one of the six, but it guards decision D12: never draw a stride the player didn't take.
describe('paths break on sampling gaps', () => {
  it('splits a journey when the gap exceeds the threshold', () => {
    const pts = [{ t: 0 }, { t: 5_000 }, { t: 10_000 }, { t: 200_000 }, { t: 205_000 }]
    const segs = splitOnGaps(pts)
    expect(segs.length).toBe(2)
    expect(segs[0].length).toBe(3)
    expect(segs[1].length).toBe(2)
  })

  it('the dataset really does contain gaps worth breaking', async () => {
    const { rows } = await dataset()
    const journeys = new Map()
    for (const r of rows) {
      if (r.event !== 'Position' && r.event !== 'BotPosition') continue
      const k = `${r.userId}|${r.matchId}`
      if (!journeys.has(k)) journeys.set(k, [])
      journeys.get(k).push(r.t)
    }
    let maxGap = 0
    for (const ts of journeys.values()) {
      ts.sort((a, b) => a - b)
      for (let i = 1; i < ts.length; i++) maxGap = Math.max(maxGap, ts[i] - ts[i - 1])
    }
    expect(maxGap).toBeGreaterThan(300_000)   // measured 518s
  })
})
