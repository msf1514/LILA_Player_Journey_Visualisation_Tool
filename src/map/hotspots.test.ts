/**
 * hotspots.test.ts — the clustering must reproduce the measured, unconcentrated reality.
 *
 * Two things are locked here. First, on synthetic data the algorithm does what it claims:
 * merges adjacent hot cells, drops lone cells, ranks by summed share. Second, on the real
 * bundle the listed clusters stay honest — at most eight, every one more than a single cell,
 * and NO cluster dominating. A large top share would mean the threshold merged the map into
 * one blob, which is the specific failure this feature exists to avoid.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { viewColumns } from '../data/loader'
import { Store } from '../data/store'
import { filterRows, aggregate } from '../data/query'
import type { Meta, Grid } from '../data/types'
import { computeHotspots, HOT_CAP } from './hotspots'

function grid(size: number, values: number[]): Grid {
  const v = new Float32Array(values)
  let total = 0
  let max = 0
  let nonEmpty = 0
  for (const x of v) if (x > 0) { total += x; nonEmpty++; if (x > max) max = x }
  return { size, values: v, max, total, nonEmpty }
}

describe('computeHotspots on synthetic grids', () => {
  it('merges adjacent hot cells into one cluster and drops a lone cell', () => {
    // 4x4. A 2x2 block of hot cells top-left, plus one isolated hot cell.
    const g = grid(4, [
      10, 10, 0, 0,
      10, 10, 0, 0,
      0, 0, 0, 9,
      0, 0, 0, 0,
    ])
    // Threshold at the minimum non-empty value (9), kept strictly, so the block of 10s is hot
    // and the lone 9 is not — which also exercises the minCells drop.
    const h = computeHotspots(g, { percentile: 0, minCells: 2, cap: 8 })
    expect(h.clusters).toHaveLength(1)
    expect(h.clusters[0].cellCount).toBe(4)
    // The isolated single cell is excluded by minCells.
    expect(h.clusters.every((c) => c.cellCount >= 2)).toBe(true)
  })

  it('ranks clusters by summed share, not peak cell', () => {
    // Cluster A has the higher PEAK (10) but lower SUM (13); cluster B has a lower peak (7)
    // but higher sum (14). Ranking by peak would put A first; ranking by summed share, which
    // is the point, puts B first. The lone value-1 cell sets a threshold that keeps both.
    const g = grid(6, [
      10, 3, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      7, 7, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 0,
      0, 0, 0, 0, 0, 1,
    ])
    const h = computeHotspots(g, { percentile: 0, minCells: 2, cap: 8 })
    expect(h.clusters).toHaveLength(2)
    expect(h.clusters[0].share).toBeGreaterThan(h.clusters[1].share)
    expect(h.clusters[0].peakCount).toBe(7)  // cluster B, chosen by sum despite the lower peak
    expect(h.clusters[0].rank).toBe(1)
  })
})

const ROOT = resolve(__dirname, '../..')
const META = resolve(ROOT, 'public/meta.json')
const BIN = resolve(ROOT, 'public/bundle.bin')

describe('computeHotspots on the real bundle', () => {
  let store: Store
  beforeAll(() => {
    if (!existsSync(META) || !existsSync(BIN)) throw new Error('run `npm run build:data` first')
    const meta = JSON.parse(readFileSync(META, 'utf8')) as Meta
    const buf = readFileSync(BIN)
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    store = new Store({ meta, cols: viewColumns(ab, meta.rows), n: meta.rows })
  })

  const mapHotspots = (map: string) => {
    const rows = filterRows(store, { map, events: ['Position', 'BotPosition'] })
    return computeHotspots(aggregate(store, rows, 64, 'traffic'))
  }

  it('never lists more than the cap, and every cluster has more than one cell', () => {
    for (const map of store.meta.dict.maps) {
      const h = mapHotspots(map)
      expect(h.clusters.length).toBeLessThanOrEqual(HOT_CAP)
      expect(h.clusters.every((c) => c.cellCount >= 2)).toBe(true)
      expect(h.clusters.every((c) => c.share > 0)).toBe(true)
    }
  })

  it('no cluster dominates — a large top share would mean the map merged into one blob', () => {
    for (const map of store.meta.dict.maps) {
      const h = mapHotspots(map)
      // Measured tops are 4.1% / 7.1% / 3.8%. Anything near the 13% the 80th percentile
      // produced would signal over-merging.
      expect(h.topShare).toBeLessThan(0.1)
    }
  })

  it('finds a long tail of clusters beyond the eight it lists', () => {
    const ambrose = store.meta.dict.maps.find((m) => m.startsWith('Ambrose'))!
    const h = mapHotspots(ambrose)
    expect(h.totalClusters).toBeGreaterThan(HOT_CAP)
    expect(h.clusters[0].share).toBeLessThan(0.06)
    expect(h.clusters[0].share).toBeGreaterThan(0.02)
  })
})
