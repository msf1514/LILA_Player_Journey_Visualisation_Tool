/**
 * merge.test.ts — dropped data must fold in without corrupting the bundle's invariants.
 *
 * The Store trusts that rows are sorted so each map is contiguous and each journey is a
 * contiguous run, and that matchMeta lines up with the match dictionary. These tests merge
 * synthetic rows into the real base bundle and prove those invariants survive, that a genuinely
 * new match is added, and that re-dropping an existing match is skipped rather than doubled.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { viewColumns } from './loader'
import type { Bundle } from './loader'
import { Store } from './store'
import type { Meta } from './types'
import type { IngestedRow } from './ingest'
import { buildMergedBundle } from './merge'

const ROOT = resolve(__dirname, '../..')
const META = resolve(ROOT, 'public/meta.json')
const BIN = resolve(ROOT, 'public/bundle.bin')

let base: Bundle

beforeAll(() => {
  if (!existsSync(META) || !existsSync(BIN)) throw new Error('run `npm run build:data` first')
  const meta = JSON.parse(readFileSync(META, 'utf8')) as Meta
  const buf = readFileSync(BIN)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  base = { meta, cols: viewColumns(ab, meta.rows), n: meta.rows }
})

/** A tiny synthetic journey on an existing map, at the map's centre. */
function syntheticRows(matchId: string): IngestedRow[] {
  const mapId = base.meta.dict.maps[0]
  const cfg = base.meta.mapConfig[mapId]
  const x = cfg.originX + cfg.scale * 0.5
  const z = cfg.originZ + cfg.scale * 0.5
  const t0 = Date.parse('2026-02-20T12:00:00Z')
  const mk = (event: string, dt: number): IngestedRow => ({
    userId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', matchId, mapId,
    x, y: 0, z, u: 0.5, v: 0.5, t: t0 + dt, event, bot: false, ambiguous: false, inBounds: true,
    file: `${matchId}_synthetic.nakama-0`,
  })
  return [mk('Position', 0), mk('Loot', 5000), mk('Position', 10000)]
}

describe('buildMergedBundle', () => {
  it('adds a genuinely new match and keeps map blocks contiguous', () => {
    const { bundle, report } = buildMergedBundle(base, { rows: syntheticRows('NEW-MATCH-001') })
    expect(report.addedMatches).toBe(1)
    expect(report.addedRows).toBe(3)
    expect(bundle.n).toBe(base.n + 3)
    expect(bundle.meta.dict.matches.length).toBe(base.meta.dict.matches.length + 1)

    // The Store rebuilds indices from the merged columns; if contiguity broke it would throw
    // or lose rows. Each map must still be one contiguous [start,end) block covering all rows.
    const store = new Store(bundle)
    let covered = 0
    for (const [, [lo, hi]] of store.mapRanges) covered += hi - lo
    expect(covered).toBe(bundle.n)

    // The new match's metadata is computed, not inherited.
    const idx = bundle.meta.dict.matches.indexOf('NEW-MATCH-001')
    const mm = bundle.meta.matchMeta[idx]
    expect(mm.journeys).toBe(1)
    expect(mm.humans).toBe(1)
    expect(mm.loot).toBe(1)
    expect(mm.duration).toBe(10)
    expect(mm.date).toBe('2026-02-20')
  })

  it('skips a dropped match whose id already exists in the base data', () => {
    const existingMatch = base.meta.dict.matches[0]
    const { bundle, report } = buildMergedBundle(base, { rows: syntheticRows(existingMatch) })
    expect(report.addedRows).toBe(0)
    expect(report.skippedExistingMatches).toBe(1)
    expect(bundle.n).toBe(base.n)
    expect(bundle.meta.dict.matches.length).toBe(base.meta.dict.matches.length)
  })

  it('rolls added event counts into the stats the honesty panel reads', () => {
    const { bundle } = buildMergedBundle(base, { rows: syntheticRows('NEW-MATCH-002') })
    expect(bundle.meta.stats.eventCounts.Loot).toBe(base.meta.stats.eventCounts.Loot + 1)
    expect(bundle.meta.stats.matches).toBe(base.meta.stats.matches + 1)
  })

  it('renders a brand-new map from dropped rows plus a config (the no-redeploy path)', () => {
    // The provided dataset has only three maps, so this is the unit-level proof of the path the
    // UI drives: register a map, drop rows whose map_id matches, and it becomes a real map.
    const cfg = { label: 'New Map', scale: 900, originX: -370, originZ: -473, version: 'v1', source: { file: 'new.png', width: 1024, height: 1024 } }
    const rows: IngestedRow[] = [0, 5000, 10000].map((dt, i) => ({
      userId: 'ffffffff-1111-2222-3333-444444444444', matchId: 'NEWMAP-MATCH', mapId: 'NewMap',
      x: cfg.originX + cfg.scale * 0.5, y: 0, z: cfg.originZ + cfg.scale * 0.5, u: 0.5, v: 0.5,
      t: Date.parse('2026-02-21T09:00:00Z') + dt, event: i === 1 ? 'Loot' : 'Position', bot: false,
      ambiguous: false, inBounds: true, file: 'newmap.nakama-0',
    }))
    const { bundle } = buildMergedBundle(base, { rows, mapConfig: { NewMap: cfg } })
    expect(bundle.meta.dict.maps).toContain('NewMap')
    const store = new Store(bundle)
    expect(store.mapRanges.has('NewMap')).toBe(true)
    const [lo, hi] = store.mapRanges.get('NewMap')!
    expect(hi - lo).toBe(3)
  })

  it('registers an added map config even before any of its data arrives', () => {
    const { bundle } = buildMergedBundle(base, {
      rows: [],
      mapConfig: { NewMap: { label: 'New Map', scale: 900, originX: -370, originZ: -473, version: 'v1', source: { file: 'x.png', width: 1024, height: 1024 } } },
    })
    expect(bundle.meta.mapConfig.NewMap).toBeDefined()
    expect(bundle.n).toBe(base.n)
  })
})
