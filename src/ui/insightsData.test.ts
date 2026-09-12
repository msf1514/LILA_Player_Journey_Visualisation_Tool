/**
 * insights.test.ts — the insight sentences must match the data, not be typed in.
 *
 * Each figure is recomputed independently from the bundle and checked against the sentence, and
 * every insight's view must name a real map and valid layers so clicking it cannot land on a
 * broken state.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { viewColumns } from '../data/loader'
import { Store } from '../data/store'
import { filterRows, aggregate } from '../data/query'
import type { Meta } from '../data/types'
import { computeHotspots } from '../map/hotspots'
import { GRID_SIZE } from '../map/layers'
import { STORM_FLOOR_S } from './Timeline'
import { computeInsights } from './insightsData'

const ROOT = resolve(__dirname, '../..')
const META = resolve(ROOT, 'public/meta.json')
const BIN = resolve(ROOT, 'public/bundle.bin')
const ALL_LAYERS = new Set(['traffic', 'dwell', 'loot', 'kills', 'deaths', 'dead', 'paths', 'actors'])

let store: Store
let primaryMap: string

beforeAll(() => {
  if (!existsSync(META) || !existsSync(BIN)) throw new Error('run `npm run build:data` first')
  const meta = JSON.parse(readFileSync(META, 'utf8')) as Meta
  const buf = readFileSync(BIN)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  store = new Store({ meta, cols: viewColumns(ab, meta.rows), n: meta.rows })
  const c = new Map<string, number>()
  for (const m of store.meta.matchMeta) c.set(m.map, (c.get(m.map) ?? 0) + 1)
  primaryMap = [...store.meta.dict.maps].sort((a, b) => (c.get(b) ?? 0) - (c.get(a) ?? 0))[0]
})

describe('computeInsights', () => {
  it('every insight names a real map and valid layers', () => {
    for (const it of computeInsights(store)) {
      expect(store.meta.dict.maps).toContain(it.view.filter.map)
      for (const l of it.view.layers) expect(ALL_LAYERS.has(l)).toBe(true)
    }
  })

  it('the bot-combat figures are the store event counts, not typed in', () => {
    const ins = computeInsights(store).find((i) => i.id === 'bot-combat')!
    expect(ins.text).toContain((store.meta.stats.eventCounts.BotKill ?? 0).toLocaleString())
    expect(ins.text).toContain(String(store.meta.stats.eventCounts.Kill ?? 0))
  })

  it('the unconcentration figure equals the recomputed top cluster share', () => {
    const rows = filterRows(store, { map: primaryMap, events: ['Position', 'BotPosition'] })
    const hot = computeHotspots(aggregate(store, rows, GRID_SIZE, 'traffic'))
    const ins = computeInsights(store).find((i) => i.id === 'unconcentrated')!
    expect(ins.text).toContain(`${(hot.topShare * 100).toFixed(1)}%`)
    expect(hot.topShare).toBeLessThan(0.1)
    expect(ins.tab).toBe('hotspots')
  })

  it('the survivorship figure equals matches whose duration reaches the storm floor', () => {
    const durs = store.meta.matchMeta.filter((m) => m.map === primaryMap).map((m) => m.duration)
    const live = durs.filter((d) => d >= STORM_FLOOR_S).length
    const ins = computeInsights(store).find((i) => i.id === 'survivorship')!
    expect(ins.text).toContain(`${live} of ${durs.length}`)
    expect(ins.view.t).toBe(STORM_FLOOR_S)
    expect(ins.view.timeMode).toBe('window')
  })

  it('the volume-collapse view opens a day difference with two different days', () => {
    const ins = computeInsights(store).find((i) => i.id === 'volume-collapse')!
    expect(ins.view.compareMode).toBe('diff')
    expect(ins.view.compareDim).toBe('day')
    expect(ins.view.filter.dateFrom).toBeTruthy()
    expect(ins.view.compareValue).toBeTruthy()
    expect(ins.view.filter.dateFrom).not.toBe(ins.view.compareValue)
  })
})
