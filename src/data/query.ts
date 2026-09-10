/**
 * query.ts — filtering and grid aggregation.
 *
 * Two stages, deliberately separate: `filterRows` produces row indices, `aggregate` turns
 * indices into a grid. Keeping them apart means the same filtered selection feeds the
 * heatmap, the marker layers, the hotspot ranking and the stats panel without re-filtering,
 * and it is what makes drill-down from a hot cell back to individual runs possible at all.
 */

import type { Store } from './store'
import type { Filter, Grid } from './types'

/** Rows matching the filter, in ascending row order. */
export function filterRows(store: Store, f: Filter): Uint32Array {
  const { mapIdx, matchIdx, userIdx, evIdx, elapsed } = store.cols

  // Narrow the scan range first. Map is the cheapest and most common narrowing, and rows
  // are sorted by map, so a single map filter turns a full scan into a contiguous slice.
  let lo = 0
  let hi = store.n
  if (f.map) {
    const range = store.mapRanges.get(f.map)
    if (!range) return new Uint32Array(0)
    ;[lo, hi] = range
  }

  const matchAllowed = matchSet(store, f)
  const eventAllowed = f.events ? new Set(f.events.map((e) => store.eventNames.indexOf(e))) : null
  const wantBot = f.actor === 'bot' ? true : f.actor === 'human' ? false : null
  const eFrom = f.elapsedFrom ?? -1
  const eTo = f.elapsedTo ?? Infinity

  const out = new Uint32Array(hi - lo)
  let k = 0
  for (let i = lo; i < hi; i++) {
    if (matchAllowed && !matchAllowed.has(matchIdx[i])) continue
    if (eventAllowed && !eventAllowed.has(evIdx[i])) continue
    if (wantBot !== null && store.isBotUser[userIdx[i]] !== wantBot) continue
    const e = elapsed[i]
    if (e < eFrom || e > eTo) continue
    out[k++] = i
  }
  return out.subarray(0, k)
}

/**
 * The set of match indices allowed by the date and match filters, or null when neither
 * constrains anything. Resolving dates to matches up front avoids re-deriving a date
 * string per row, which at 89k rows is the difference between milliseconds and tens of ms.
 */
function matchSet(store: Store, f: Filter): Set<number> | null {
  const hasDate = Boolean(f.dateFrom || f.dateTo)
  const hasIds = Boolean(f.matchIds?.length)
  if (!hasDate && !hasIds) return null

  let allowed: Set<number> | null = null

  if (hasDate) {
    const from = f.dateFrom ?? '0000-00-00'
    const to = f.dateTo ?? '9999-99-99'
    allowed = new Set()
    for (const [date, matches] of store.matchesByDate) {
      if (date >= from && date <= to) for (const m of matches) allowed.add(m)
    }
  }

  if (hasIds) {
    const byId = new Set<number>()
    for (const id of f.matchIds!) {
      const idx = store.meta.dict.matches.indexOf(id)
      if (idx >= 0) byId.add(idx)
    }
    allowed = allowed ? new Set([...byId].filter((m) => allowed!.has(m))) : byId
  }

  return allowed
}

/**
 * Bin rows into a square grid in UV space.
 *
 * `mode` is the reason traffic and dwell are separate layers rather than one "density" map:
 *
 *   traffic — one count per (actor, cell). A player crossing a corridor counts once no
 *             matter how many samples land there, so this reads as "how many people came
 *             through here".
 *   dwell   — weighted by the time gap each sample represents, so standing still for a
 *             minute weighs a minute. This reads as "how long people stayed".
 *   events  — a plain count, correct for discrete events (kills, loot, deaths).
 *
 * Position sampling is time-based, so a naive point count conflates the two: a player
 * standing 60s emits ~12 samples where a sprinter emits 2. High traffic with low dwell is
 * a corridor; low traffic with high dwell is a camp spot or somewhere players get stuck.
 * Those call for opposite design responses, which is why one blended map is worse than two.
 */
export function aggregate(
  store: Store,
  rows: Uint32Array,
  size: number,
  mode: 'traffic' | 'dwell' | 'events',
): Grid {
  const { x, z, mapIdx, userIdx, tSec } = store.cols
  const values = new Float32Array(size * size)
  const cfgs = store.meta.mapConfig
  const maps = store.meta.dict.maps

  /** Cap the weight one sample can carry, so a 518s gap cannot dominate a whole map. */
  const MAX_DWELL_WEIGHT = 30

  // Traffic counts each actor once per cell. Tracking (cell, user) pairs in a Set of packed
  // integers avoids allocating a Set per cell.
  const seen = mode === 'traffic' ? new Set<number>() : null

  for (let r = 0; r < rows.length; r++) {
    const i = rows[r]
    const cfg = cfgs[maps[mapIdx[i]]]
    if (!cfg) continue

    const u = (x[i] - cfg.originX) / cfg.scale
    const v = (z[i] - cfg.originZ) / cfg.scale
    if (u < 0 || u > 1 || v < 0 || v > 1) continue

    const col = Math.min(size - 1, (u * size) | 0)
    const row = Math.min(size - 1, ((1 - v) * size) | 0)
    const cell = row * size + col

    if (mode === 'traffic') {
      const key = cell * 65536 + userIdx[i]
      if (seen!.has(key)) continue
      seen!.add(key)
      values[cell] += 1
    } else if (mode === 'dwell') {
      // Gap to the previous sample of the same journey approximates time spent here.
      const prev = r > 0 ? rows[r - 1] : -1
      const contiguous = prev >= 0 && i === prev + 1 && userIdx[i] === userIdx[prev]
      const dt = contiguous ? tSec[i] - tSec[prev] : 5   // 5s = the median sampling interval
      values[cell] += Math.min(Math.max(dt, 0), MAX_DWELL_WEIGHT)
    } else {
      values[cell] += 1
    }
  }

  let max = 0
  let total = 0
  let nonEmpty = 0
  for (let c = 0; c < values.length; c++) {
    const val = values[c]
    if (val > 0) { nonEmpty++; total += val; if (val > max) max = val }
  }
  return { size, values, max, total, nonEmpty }
}

/**
 * Difference between two grids, normalised to SHARE of total rather than raw counts.
 *
 * This normalisation is not optional. Daily player volume falls from 98 to 47 across the
 * five days, so a raw-count diff would paint the entire map "less" on every comparison --
 * a designer would read that as their map being abandoned when nothing about behaviour
 * changed. Comparing shares asks the question that is actually meant: did the distribution
 * move, not did fewer people play.
 *
 * Returns values in [-1, 1]: positive means a larger share in `b`.
 */
export function diffGrids(a: Grid, b: Grid): Grid {
  if (a.size !== b.size) throw new Error('grid sizes differ')
  const values = new Float32Array(a.size * a.size)
  const aTotal = a.total || 1
  const bTotal = b.total || 1
  let max = 0
  let nonEmpty = 0
  for (let c = 0; c < values.length; c++) {
    const d = b.values[c] / bTotal - a.values[c] / aTotal
    values[c] = d
    if (d !== 0) nonEmpty++
    const m = Math.abs(d)
    if (m > max) max = m
  }
  return { size: a.size, values, max, total: 0, nonEmpty }
}

/**
 * Cells that are playable but never visited.
 *
 * Measured against the playable-land mask, not the whole square image: most of each
 * minimap is void, and counting that as "unused map" overstates the problem badly.
 *
 * Coverage is grid-resolution dependent -- finer grids always read lower, because a cell
 * only needs one sample to count as visited. Callers must report the `size` they used
 * alongside any percentage, and comparisons across maps are only valid at equal size.
 */
export function deadSpace(
  grid: Grid,
  isPlayable: (col: number, row: number) => boolean,
  maskSize: number,
): { dead: number[]; playable: number; visited: number; coverage: number; size: number } {
  const { size, values } = grid
  const scale = maskSize / size
  const dead: number[] = []
  let playable = 0
  let visited = 0

  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      // A coarse cell is playable when enough of the fine mask beneath it is land.
      let on = 0
      let tot = 0
      for (let a = 0; a < scale; a++) {
        for (let b = 0; b < scale; b++) {
          tot++
          if (isPlayable(((col * scale + a) | 0), ((row * scale + b) | 0))) on++
        }
      }
      if (tot === 0 || on / tot <= 0.25) continue
      playable++
      const cell = row * size + col
      if (values[cell] > 0) visited++
      else dead.push(cell)
    }
  }
  return { dead, playable, visited, coverage: playable ? visited / playable : 0, size }
}
