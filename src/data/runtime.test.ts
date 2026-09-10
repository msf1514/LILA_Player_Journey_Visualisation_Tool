/**
 * runtime.test.ts — proves the browser data layer agrees with the pipeline.
 *
 * The pipeline tests (pipeline/transform.test.mjs) verify the parquet is read correctly.
 * These verify the other half: that the bundle those tests produced is decoded, indexed
 * and aggregated without losing or inventing anything. A mismatch here would mean the
 * numbers on screen disagree with the numbers in the data, silently.
 *
 * Reads the built artifacts from public/, so `npm run build:data` must have run first.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { viewColumns, maskReader } from './loader'
import { Store } from './store'
import { filterRows, aggregate, diffGrids, deadSpace } from './query'
import type { Meta } from './types'

const ROOT = resolve(__dirname, '../..')
const META = resolve(ROOT, 'public/meta.json')
const BIN = resolve(ROOT, 'public/bundle.bin')

let store: Store

beforeAll(() => {
  if (!existsSync(META) || !existsSync(BIN)) {
    throw new Error('public/bundle.bin or meta.json missing — run `npm run build:data` first')
  }
  const meta = JSON.parse(readFileSync(META, 'utf8')) as Meta
  const buf = readFileSync(BIN)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  store = new Store({ meta, cols: viewColumns(ab, meta.rows), n: meta.rows })
})

describe('bundle decoding', () => {
  it('decodes the row count the pipeline wrote', () => {
    expect(store.n).toBe(89016)
    expect(store.meta.dict.users.length).toBe(339)
    expect(store.meta.dict.matches.length).toBe(796)
    expect(store.meta.dict.maps).toEqual(['AmbroseValley', 'GrandRift', 'Lockdown'])
  })

  it('rejects a bundle whose size disagrees with its metadata', () => {
    expect(() => viewColumns(new ArrayBuffer(24 * 10), 11)).toThrow(/out of sync/)
  })

  it('reconstructs timestamps in the documented Feb 2026 window, not 1970', () => {
    let min = Infinity, max = -Infinity
    for (let i = 0; i < store.n; i++) {
      const t = store.cols.tSec[i]
      if (t < min) min = t
      if (t > max) max = t
    }
    expect(new Date(min * 1000).toISOString().slice(0, 10)).toBe('2026-02-09')
    expect(new Date(max * 1000).toISOString().slice(0, 10)).toBe('2026-02-14')
  })

  it('preserves every event count from the pipeline', () => {
    const counts: Record<string, number> = {}
    for (let i = 0; i < store.n; i++) {
      const name = store.eventName(store.cols.evIdx[i])
      counts[name] = (counts[name] ?? 0) + 1
    }
    expect(counts).toEqual(store.meta.stats.eventCounts)
    expect(counts.Kill).toBe(3)
    expect(counts.Killed).toBe(3)
    expect(counts.KilledByStorm).toBe(39)
  })
})

describe('indices', () => {
  it('gives each map one contiguous row range covering every row', () => {
    let covered = 0
    for (const [name, [lo, hi]] of store.mapRanges) {
      expect(hi).toBeGreaterThan(lo)
      for (let i = lo; i < hi; i++) expect(store.mapName(store.cols.mapIdx[i])).toBe(name)
      covered += hi - lo
    }
    expect(covered).toBe(store.n)
  })

  it('splits journeys into contiguous single-actor single-match runs', () => {
    expect(store.journeys.length).toBe(1242)   // one per unique file
    let total = 0
    for (const j of store.journeys) {
      total += j.end - j.start
      expect(store.cols.userIdx[j.start]).toBe(store.cols.userIdx[j.end - 1])
      expect(store.cols.matchIdx[j.start]).toBe(store.cols.matchIdx[j.end - 1])
    }
    expect(total).toBe(store.n)
  })

  it('classifies bots by id shape and flags the three ambiguous accounts', () => {
    const bots = store.isBotUser.filter(Boolean).length
    expect(bots).toBe(94)
    expect(store.isBotUser.length - bots).toBe(245)
    const flagged = store.meta.dict.users.filter((_, i) => store.isAmbiguousUser[i]).sort()
    expect(flagged).toEqual(['1379', '1402', '1429'])
  })

  it('surfaces the multi-participant matches worth replaying', () => {
    const multi = store.multiParticipantMatches()
    expect(multi.length).toBe(53)                              // of 796
    expect(store.matchMeta(multi[0]).journeys).toBe(16)        // ranked by size
  })

  it('finds every date from ts, not from folder names', () => {
    expect(store.dates).toEqual([
      '2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13', '2026-02-14',
    ])
  })
})

describe('filtering', () => {
  it('returns every row when nothing is constrained', () => {
    expect(filterRows(store, {}).length).toBe(store.n)
  })

  it('filters by map to the indexed range', () => {
    const rows = filterRows(store, { map: 'Lockdown' })
    const [lo, hi] = store.mapRanges.get('Lockdown')!
    expect(rows.length).toBe(hi - lo)
    for (const i of rows) expect(store.mapName(store.cols.mapIdx[i])).toBe('Lockdown')
  })

  it('filters by actor type', () => {
    const humans = filterRows(store, { actor: 'human' })
    const bots = filterRows(store, { actor: 'bot' })
    expect(humans.length + bots.length).toBe(store.n)
    for (const i of bots) expect(store.isBotUser[store.cols.userIdx[i]]).toBe(true)
  })

  it('filters by event type', () => {
    const loot = filterRows(store, { events: ['Loot'] })
    expect(loot.length).toBe(store.meta.stats.eventCounts.Loot)
  })

  it('filters by date range', () => {
    const oneDay = filterRows(store, { dateFrom: '2026-02-14', dateTo: '2026-02-14' })
    expect(oneDay.length).toBeGreaterThan(0)
    expect(oneDay.length).toBeLessThan(store.n)
  })

  it('filters by match-elapsed window', () => {
    const early = filterRows(store, { elapsedFrom: 0, elapsedTo: 60 })
    for (const i of early) expect(store.cols.elapsed[i]).toBeLessThanOrEqual(60)
  })

  it('combines filters conjunctively', () => {
    const rows = filterRows(store, { map: 'AmbroseValley', actor: 'human', events: ['Loot'] })
    for (const i of rows) {
      expect(store.mapName(store.cols.mapIdx[i])).toBe('AmbroseValley')
      expect(store.isBotUser[store.cols.userIdx[i]]).toBe(false)
      expect(store.eventName(store.cols.evIdx[i])).toBe('Loot')
    }
  })

  it('returns empty for an unknown map rather than throwing', () => {
    expect(filterRows(store, { map: 'NotAMap' }).length).toBe(0)
  })
})

describe('aggregation', () => {
  const rowsFor = () => filterRows(store, { map: 'AmbroseValley' })

  it('counts events once per row', () => {
    const rows = filterRows(store, { map: 'AmbroseValley', events: ['Loot'] })
    const grid = aggregate(store, rows, 64, 'events')
    expect(grid.total).toBe(rows.length)
  })

  it('counts each actor once per cell in traffic mode', () => {
    const rows = rowsFor()
    const traffic = aggregate(store, rows, 64, 'traffic')
    const events = aggregate(store, rows, 64, 'events')
    // Same footprint, but traffic must be the smaller total: repeat samples collapse.
    expect(traffic.nonEmpty).toBe(events.nonEmpty)
    expect(traffic.total).toBeLessThan(events.total)
  })

  it('weights dwell by time, producing a different shape from traffic', () => {
    const rows = rowsFor()
    const traffic = aggregate(store, rows, 64, 'traffic')
    const dwell = aggregate(store, rows, 64, 'dwell')
    expect(dwell.total).toBeGreaterThan(traffic.total)
    // The hottest cell should differ between the two, which is the whole reason they
    // are separate layers: a corridor and a camp spot are not the same place.
    const peak = (g: typeof traffic) => g.values.indexOf(g.max)
    expect(peak(dwell)).not.toBe(peak(traffic))
  })

  it('places no data outside the grid', () => {
    const grid = aggregate(store, filterRows(store, {}), 32, 'events')
    expect(grid.total).toBe(store.n)
  })
})

describe('difference view', () => {
  it('normalises to share, so a volume drop alone reads as no change', () => {
    // Same spatial distribution, half the volume. A raw-count diff would paint the whole
    // map negative; a share diff must read as ~zero. Daily volume really does fall from
    // 98 to 47 players, so this is the difference between a true and a false headline.
    const rows = filterRows(store, { map: 'AmbroseValley' })
    const full = aggregate(store, rows, 32, 'events')
    const half = aggregate(store, rows.subarray(0, Math.floor(rows.length / 2)), 32, 'events')
    const d = diffGrids(full, half)
    expect(d.max).toBeLessThan(0.05)
  })

  it('detects a genuine distribution shift', () => {
    const a = aggregate(store, filterRows(store, { map: 'AmbroseValley', events: ['Loot'] }), 32, 'events')
    const b = aggregate(store, filterRows(store, { map: 'AmbroseValley', events: ['BotKill'] }), 32, 'events')
    expect(diffGrids(a, b).max).toBeGreaterThan(0.01)
  })
})

describe('dead space', () => {
  it('measures coverage against playable land, and reports the grid size used', () => {
    const masks = store.meta.masks!
    for (const map of store.meta.dict.maps) {
      const m = masks[map]
      const isPlayable = maskReader(m.bits, m.size)
      const grid = aggregate(store, filterRows(store, { map }), 64, 'traffic')
      const res = deadSpace(grid, isPlayable, m.size)

      expect(res.size).toBe(64)
      expect(res.playable).toBeGreaterThan(0)
      expect(res.coverage).toBeGreaterThan(0.3)
      expect(res.coverage).toBeLessThanOrEqual(1)
      expect(res.dead.length).toBe(res.playable - res.visited)
    }
  })

  it('ranks Lockdown as the least-covered map', () => {
    const masks = store.meta.masks!
    const coverage = store.meta.dict.maps.map((map) => {
      const m = masks[map]
      const grid = aggregate(store, filterRows(store, { map }), 64, 'traffic')
      return { map, c: deadSpace(grid, maskReader(m.bits, m.size), m.size).coverage }
    })
    coverage.sort((a, b) => a.c - b.c)
    expect(coverage[0].map).toBe('Lockdown')
  })
})
