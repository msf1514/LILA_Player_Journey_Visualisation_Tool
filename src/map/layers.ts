/**
 * layers.ts — pure data preparation for the map, with NO deck.gl dependency.
 *
 * Given a Store, some row indices and a map config, these functions return aggregated grids,
 * baked heat/diff textures (as canvases) and positioned geometry. No React, no component
 * state, and crucially nothing imported from deck.gl, so App can run every filter, aggregate
 * and image bake before the renderer chunk has arrived. The Layer factories that consume this
 * output live in deckLayers.ts, which is the sole deck.gl boundary and is code-split away from
 * the initial load.
 *
 * The catalogue is shaped by what this dataset actually contains, not by what an extraction
 * shooter usually contains:
 *
 *   - Loot is 12,866 events, roughly 80% of all non-position activity. It is the main
 *     gameplay loop here, so it is a first-class layer rather than an afterthought.
 *   - Combat is 2,410 kills against bots and 699 deaths to bots. Player-versus-player is
 *     THREE events across five days and 796 matches. Every combat label therefore says
 *     "vs Bots" explicitly. Implying PvP would be a lie a designer only discovers later,
 *     and a tool loses its credibility exactly once.
 *   - Storm deaths number 39, all past ~655s elapsed. Rare, but they are the only evidence
 *     of the storm existing at all, so they get their own marker rather than being pooled.
 */

import type { Store } from '../data/store'
import type { Grid, MapConfig } from '../data/types'
import { worldToUV, uvToWorldSpace, S } from './project'
import { rampDwell, rampTraffic, token } from './theme'
import type { RGB, ShapeName } from './theme'

/**
 * Aggregation grid resolution, used everywhere a grid is built.
 *
 * 64 divides the 256-cell playable mask exactly, so a coarse cell maps onto 4x4 fine cells
 * with no rounding. On Ambrose that is roughly a 14m cell, which is about the size of a
 * building - fine enough to separate a courtyard from the street beside it, coarse enough
 * that a single wandering player does not light up a region.
 *
 * Coverage percentages are meaningless without this number, because a finer grid always
 * reads lower. Anything reporting coverage must report the grid size beside it.
 */
export const GRID_SIZE = 64

export interface EventPoint {
  position: [number, number]
  event: string
  shape: ShapeName
  bot: boolean
  matchIdx: number
  userIdx: number
  elapsed: number
}

// ─── Heatmaps ───────────────────────────────────────────────────────────────

/**
 * Weighted points for a GPU heatmap, carrying the traffic-versus-dwell distinction.
 *
 * An earlier version fed the 64x64 aggregation grid's cell centres to HeatmapLayer. It was
 * semantically right and visually wrong: the kernel quantised onto the lattice and the map
 * read as a pegboard of dots rather than a surface.
 *
 * So the aggregation happens here instead, at full spatial resolution:
 *
 *   traffic - one point per (cell, actor) pair, weight 1, placed at the real sample. A
 *             player crossing a corridor counts once however many samples land there, so
 *             this answers "how many people came through".
 *   dwell   - every sample, weighted by the seconds it represents. Standing still for a
 *             minute weighs a minute, so this answers "how long people stayed".
 *
 * The distinction is not cosmetic. Position sampling is time-based, so a naive point count
 * conflates a corridor with a camping spot, and those call for opposite design responses.
 * The cell key still uses GRID_SIZE, so "counted once per cell" means the same thing here
 * as it does in the grid used for coverage.
 */
export interface WeightedPoint { position: [number, number]; weight: number }

/** Cap on the seconds one sample may contribute, so a 518s gap cannot dominate a map. */
const MAX_DWELL_WEIGHT = 30

export function heatPoints(
  store: Store,
  rows: Uint32Array,
  cfg: MapConfig,
  mode: 'traffic' | 'dwell',
): WeightedPoint[] {
  const { x, z, userIdx, tSec } = store.cols
  const out: WeightedPoint[] = []
  const seen = mode === 'traffic' ? new Set<number>() : null

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const { u, v } = worldToUV(x[r], z[r], cfg)
    if (u < 0 || u > 1 || v < 0 || v > 1) continue

    if (mode === 'traffic') {
      const col = Math.min(GRID_SIZE - 1, (u * GRID_SIZE) | 0)
      const row = Math.min(GRID_SIZE - 1, ((1 - v) * GRID_SIZE) | 0)
      const key = (row * GRID_SIZE + col) * 65536 + userIdx[r]
      if (seen!.has(key)) continue
      seen!.add(key)
      out.push({ position: uvToWorldSpace(u, v), weight: 1 })
    } else {
      const prev = i > 0 ? rows[i - 1] : -1
      const contiguous = prev >= 0 && r === prev + 1 && userIdx[r] === userIdx[prev]
      const dt = contiguous ? tSec[r] - tSec[prev] : 5   // 5s is the median sampling interval
      out.push({ position: uvToWorldSpace(u, v), weight: Math.min(Math.max(dt, 0), MAX_DWELL_WEIGHT) })
    }
  }
  return out
}

/**
 * Bake weighted points into a heat texture.
 *
 * deck.gl's HeatmapLayer re-aggregates on every viewport change and drags the whole layer
 * stack through the recomputation with it. Measured while panning at 1400x900:
 *
 *     traffic + paths (986)        2 fps
 *     traffic + loot (9,936)      11 fps
 *     traffic + kills (1,794)     25 fps
 *     all markers, no heatmap     58 fps
 *
 * The cost scaled with the object count of whatever was drawn *alongside* the heatmap,
 * which makes a live GPU heatmap the wrong tool here: a designer needs to pan a map with
 * markers on it, and that is exactly the case it degrades.
 *
 * So the heat is rendered once into a texture and shown as a BitmapLayer. Per-frame cost
 * becomes constant and independent of point count, because panning just samples an existing
 * image. The texture is rebuilt only when the data or the filter changes.
 *
 * Tradeoff: the heat is baked at HEAT_RES, so zooming far in softens it. At 256 across a
 * 1024-unit map that is 4 render units per texel, finer than the 64-cell analysis grid, and
 * a heatmap is a density impression rather than something to read pixel by pixel.
 */
const HEAT_RES = 256

/** Separable box blur, run three times to approximate a Gaussian. Cheap and predictable. */
function blur(src: Float32Array, n: number, radius: number): Float32Array {
  let buf = src
  const tmp = new Float32Array(n * n)
  for (let pass = 0; pass < 3; pass++) {
    // horizontal
    for (let y = 0; y < n; y++) {
      let sum = 0
      for (let x = -radius; x <= radius; x++) sum += buf[y * n + Math.min(n - 1, Math.max(0, x))]
      for (let x = 0; x < n; x++) {
        tmp[y * n + x] = sum / (radius * 2 + 1)
        const out = Math.min(n - 1, Math.max(0, x - radius))
        const inn = Math.min(n - 1, Math.max(0, x + radius + 1))
        sum += buf[y * n + inn] - buf[y * n + out]
      }
    }
    // vertical
    const next = new Float32Array(n * n)
    for (let x = 0; x < n; x++) {
      let sum = 0
      for (let y = -radius; y <= radius; y++) sum += tmp[Math.min(n - 1, Math.max(0, y)) * n + x]
      for (let y = 0; y < n; y++) {
        next[y * n + x] = sum / (radius * 2 + 1)
        const out = Math.min(n - 1, Math.max(0, y - radius))
        const inn = Math.min(n - 1, Math.max(0, y + radius + 1))
        sum += tmp[inn * n + x] - tmp[out * n + x]
      }
    }
    buf = next
  }
  return buf
}

function heatCanvas(points: WeightedPoint[], ramp: RGB[]): HTMLCanvasElement {
  const n = HEAT_RES
  const field = new Float32Array(n * n)

  for (const p of points) {
    const col = Math.min(n - 1, Math.max(0, ((p.position[0] / S) * n) | 0))
    // Texture rows run top-down; render space Y grows up.
    const row = Math.min(n - 1, Math.max(0, ((1 - p.position[1] / S) * n) | 0))
    field[row * n + col] += p.weight
  }

  const smooth = blur(field, n, 3)

  // Normalise to a high percentile rather than the maximum. One extreme cell - a spawn
  // point, or a player who idled in a corner - would otherwise flatten the entire map to
  // near-black and hide every real difference.
  const nonZero = Array.from(smooth).filter((v) => v > 0).sort((a, b) => a - b)
  const scale = nonZero.length ? nonZero[Math.floor(nonZero.length * 0.985)] || 1 : 1

  const canvas = document.createElement('canvas')
  canvas.width = n
  canvas.height = n
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(n, n)

  for (let i = 0; i < n * n; i++) {
    const t = Math.min(1, smooth[i] / scale)
    if (t <= 0.02) continue
    // Ramp stop 0 is the background; start at stop 1 so faint values still read.
    const pos = t * (ramp.length - 1)
    const lo = Math.min(ramp.length - 1, Math.floor(pos))
    const hi = Math.min(ramp.length - 1, lo + 1)
    const f = pos - lo
    const o = i * 4
    img.data[o] = ramp[lo][0] + (ramp[hi][0] - ramp[lo][0]) * f
    img.data[o + 1] = ramp[lo][1] + (ramp[hi][1] - ramp[lo][1]) * f
    img.data[o + 2] = ramp[lo][2] + (ramp[hi][2] - ramp[lo][2]) * f
    // Fade in with intensity so low-traffic ground stays legible beneath.
    img.data[o + 3] = Math.min(235, 40 + t * 215)
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

/**
 * Build the heat image. THIS is the expensive step and the one worth caching.
 *
 * Cache the returned canvas, never the Layer. deck.gl layers are single-use descriptors:
 * reusing an instance across renders breaks their lifecycle and the layer silently stops
 * drawing, with no error. Layers are cheap to construct, so build them fresh every render
 * and memoise the image they point at.
 */
export const trafficImage = (points: WeightedPoint[]) => heatCanvas(points, rampTraffic())
export const dwellImage = (points: WeightedPoint[]) => heatCanvas(points, rampDwell())

// ─── Event markers ──────────────────────────────────────────────────────────

/** Which shape and colour each event name draws as. Unknown names fall through to circle. */
const EVENT_STYLE: Record<string, { shape: ShapeName; color: string; label: string }> = {
  Loot:          { shape: 'square',   color: '--ev-loot',  label: 'Loot pickup' },
  BotKill:       { shape: 'triangle', color: '--ev-kill',  label: 'Kill (vs bot)' },
  Kill:          { shape: 'diamond',  color: '--ev-kill',  label: 'Kill (vs player)' },
  BotKilled:     { shape: 'cross',    color: '--ev-death', label: 'Death (to bot)' },
  Killed:        { shape: 'diamond',  color: '--ev-death', label: 'Death (to player)' },
  KilledByStorm: { shape: 'hexagon',  color: '--ev-storm', label: 'Death (storm)' },
}

export const eventStyle = (name: string) =>
  EVENT_STYLE[name] ?? { shape: 'circle' as ShapeName, color: '--ev-unknown', label: name }

/** Collect the rows matching `events` into positioned marker points. */
export function collectEvents(
  store: Store,
  rows: Uint32Array,
  cfg: MapConfig,
  events: ReadonlySet<string>,
): EventPoint[] {
  const out: EventPoint[] = []
  const { x, z, evIdx, userIdx, matchIdx, elapsed } = store.cols
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const name = store.eventName(evIdx[r])
    if (!events.has(name)) continue
    const { u, v } = worldToUV(x[r], z[r], cfg)
    out.push({
      position: uvToWorldSpace(u, v),
      event: name,
      shape: eventStyle(name).shape,
      bot: store.isBotUser[userIdx[r]],
      matchIdx: matchIdx[r],
      userIdx: userIdx[r],
      elapsed: elapsed[r],
    })
  }
  return out
}

// ─── Journeys ───────────────────────────────────────────────────────────────

export interface PathSegment {
  path: [number, number][]
  bot: boolean
  userIdx: number
  matchIdx: number
}

/** Gaps beyond this break a path rather than being drawn through. */
export const PATH_GAP_SECONDS = 30

/**
 * Build journey paths, split wherever sampling stops.
 *
 * Position sampling has a 5s median but a 518s maximum gap. Joining across a gap that size
 * draws a confident straight line through geometry the player never crossed, usually through
 * a building. A level designer who notices one such line stops trusting every other layer,
 * and they will not file a bug about it. Breaking the path is the honest rendering: it shows
 * what was measured and stays silent about what was not.
 */
export function buildPaths(
  store: Store,
  cfg: MapConfig,
  mapIdx: number,
  keep?: (userIdx: number, matchIdx: number) => boolean,
  /**
   * Match-elapsed window, in seconds. Points outside it are dropped.
   *
   * Clipping has to happen per point, not per journey. Filtering whole journeys is right for
   * map, date or actor, but for time it would draw a player's complete twelve-minute route
   * while the clock reads one minute. The map would be flatly contradicting the timeline,
   * and a designer scrubbing to minute 1 would see routes nobody had walked yet.
   */
  elapsed?: { from: number; to: number },
): PathSegment[] {
  const { x, z, tSec, evIdx } = store.cols
  const el = store.cols.elapsed
  const out: PathSegment[] = []

  for (const j of store.journeys) {
    if (j.mapIdx !== mapIdx) continue
    if (keep && !keep(j.userIdx, j.matchIdx)) continue

    let current: [number, number][] = []
    let prevT = -Infinity

    for (let i = j.start; i < j.end; i++) {
      const name = store.eventName(evIdx[i])
      if (name !== 'Position' && name !== 'BotPosition') continue
      if (elapsed && (el[i] < elapsed.from || el[i] > elapsed.to)) continue
      const t = tSec[i]
      if (current.length && t - prevT > PATH_GAP_SECONDS) {
        if (current.length > 1) out.push({ path: current, bot: j.bot, userIdx: j.userIdx, matchIdx: j.matchIdx })
        current = []
      }
      const { u, v } = worldToUV(x[i], z[i], cfg)
      current.push(uvToWorldSpace(u, v))
      prevT = t
    }
    if (current.length > 1) out.push({ path: current, bot: j.bot, userIdx: j.userIdx, matchIdx: j.matchIdx })
  }
  return out
}

/** Colour tokens the legend needs, resolved to CSS strings. */
export function legendColor(name: string): string {
  const [r, g, b] = token(name)
  return `rgb(${r} ${g} ${b})`
}

// ─── Difference view ────────────────────────────────────────────────────────

/**
 * Minimum raw support a cell needs on at least one side before its delta is drawn.
 *
 * Normalisation makes two differently-sized samples comparable, but it does NOT make a small
 * sample reliable. Ambrose Valley has 201 matches on Feb 10 and 24 on Feb 14: in a 24-match
 * day one player's route is a large share of the total, so a cell they happened to cross
 * produces a dramatic delta that is sampling noise rather than behaviour.
 *
 * The rule is deliberately "either side", not "both". A cell with nothing on one side and
 * plenty on the other is a real finding - an area that started or stopped being used - and
 * suppressing it would hide exactly what a designer is looking for.
 */
export const MIN_DIFF_SUPPORT = 5

export interface DiffStats {
  /** Cells drawn after the support threshold. */
  shown: number
  /** Cells suppressed for having too little data on either side. */
  suppressed: number
  /** Largest absolute share delta actually drawn. */
  maxDelta: number
}

/**
 * Bake a signed difference grid into a diverging texture.
 *
 * Symmetric about zero so neither direction reads louder than the other: an eye drawn to red
 * would make every comparison look like growth. Near-zero is transparent rather than a
 * midpoint colour, so the map underneath stays readable where nothing changed, which is most
 * of it.
 *
 * `diff` must come from diffGrids, which already normalises both sides to share of total.
 * Diffing raw counts here would report the volume collapse (201 matches down to 24) as a
 * map-wide behaviour change.
 */
export function diffImage(
  diff: Grid,
  supportA: Grid,
  supportB: Grid,
  minSupport = MIN_DIFF_SUPPORT,
): { canvas: HTMLCanvasElement; stats: DiffStats } {
  const n = diff.size
  const neg = token('--diff-neg')
  const pos = token('--diff-pos')

  // Scale to a high percentile of the drawn deltas rather than the maximum, so one extreme
  // cell cannot flatten every other difference to invisibility.
  const magnitudes: number[] = []
  for (let i = 0; i < n * n; i++) {
    if (Math.max(supportA.values[i], supportB.values[i]) < minSupport) continue
    const m = Math.abs(diff.values[i])
    if (m > 0) magnitudes.push(m)
  }
  magnitudes.sort((a, b) => a - b)
  const scale = magnitudes.length ? magnitudes[Math.floor(magnitudes.length * 0.97)] || 1 : 1

  const canvas = document.createElement('canvas')
  canvas.width = n
  canvas.height = n
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(n, n)

  let shown = 0
  let suppressed = 0
  let maxDelta = 0

  for (let i = 0; i < n * n; i++) {
    const support = Math.max(supportA.values[i], supportB.values[i])
    if (support <= 0) continue
    if (support < minSupport) { suppressed++; continue }

    const d = diff.values[i]
    const t = Math.min(1, Math.abs(d) / scale)
    if (t <= 0.06) continue          // no meaningful change: leave the map showing through

    shown++
    if (Math.abs(d) > maxDelta) maxDelta = Math.abs(d)

    const c = d > 0 ? pos : neg
    const o = i * 4
    img.data[o] = c[0]
    img.data[o + 1] = c[1]
    img.data[o + 2] = c[2]
    img.data[o + 3] = Math.min(225, 30 + t * 195)
  }

  ctx.putImageData(img, 0, 0)
  return { canvas, stats: { shown, suppressed, maxDelta } }
}
