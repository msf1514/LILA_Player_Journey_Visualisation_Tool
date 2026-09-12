/**
 * merge.ts — fold dropped telemetry into a new bundle the rest of the app can use unchanged.
 *
 * The Store, every query and every layer assume one thing: rows sorted so each map is a
 * contiguous block and each (match, actor) journey is a contiguous run, with matchMeta aligned
 * to the match dictionary. Rather than teach all of that to read from two sources, dropped data
 * is encoded into the SAME columnar shape the pipeline emits and merged into one bundle. One
 * code path downstream, no divergence.
 *
 * Dropped data is additive and deduped by match id: a dropped file whose match already exists
 * in the base bundle is skipped, so re-dropping the shipped data is a no-op rather than a
 * doubling, and genuinely new matches merge in. This keeps the encoding identical to
 * pipeline/build.mjs (see the matchMeta and elapsed computation, mirrored here on purpose).
 */

import { viewColumns, type Bundle } from './loader'
import type { MapConfig, MapMask, MatchMeta, DatasetStats } from './types'
import type { IngestedRow } from './ingest'
import { describeEvent, isKillEvent, isDeathEvent, isBot, isAmbiguousActor } from '../../pipeline/transform.mjs'

const BYTES_PER_ROW = 24

export interface MergeReport {
  /** Rows actually merged in (belonging to genuinely new matches). */
  addedRows: number
  /** New matches introduced. */
  addedMatches: number
  /** Distinct matches skipped because they already exist in the base data. */
  skippedExistingMatches: number
}

export interface MergeInput {
  rows: IngestedRow[]
  mapConfig?: Record<string, MapConfig>
  masks?: Record<string, MapMask>
}

/** Fold `added` into `base`, returning a fresh bundle and a report of what merged. */
export function buildMergedBundle(base: Bundle, added: MergeInput): { bundle: Bundle; report: MergeReport } {
  const baseMatches = new Set(base.meta.dict.matches)
  const skipped = new Set<string>()
  const kept: IngestedRow[] = []
  for (const r of added.rows) {
    if (baseMatches.has(r.matchId)) { skipped.add(r.matchId); continue }
    kept.push(r)
  }

  const report: MergeReport = { addedRows: kept.length, addedMatches: 0, skippedExistingMatches: skipped.size }

  const mapConfig = { ...base.meta.mapConfig, ...(added.mapConfig ?? {}) }
  const masks = base.meta.masks || added.masks ? { ...(base.meta.masks ?? {}), ...(added.masks ?? {}) } : null

  // Map ids configured through the UI but not present in the base dictionary. They must be
  // added to dict.maps even with no rows, so the map switcher lists them and their minimap
  // renders; they simply have no telemetry until files for them are dropped.
  const configuredNewMaps = Object.keys(added.mapConfig ?? {}).filter((id) => !base.meta.dict.maps.includes(id))

  if (kept.length === 0) {
    // Nothing new to encode. Still register any added map configs, masks, and their ids in the
    // dictionary so a map can be added and selected before its data arrives.
    const dict = configuredNewMaps.length
      ? { ...base.meta.dict, maps: [...base.meta.dict.maps, ...configuredNewMaps] }
      : base.meta.dict
    return {
      bundle: { ...base, meta: { ...base.meta, dict, mapConfig, masks } },
      report,
    }
  }

  // ── Extend the dictionaries; base entries keep their indices ────────────────
  const users = [...base.meta.dict.users]
  const matches = [...base.meta.dict.matches]
  const maps = [...base.meta.dict.maps]
  const events = [...base.meta.dict.events]
  const uIdx = new Map(users.map((v, i) => [v, i]))
  const mIdx = new Map(matches.map((v, i) => [v, i]))
  const gIdx = new Map(maps.map((v, i) => [v, i]))
  const eIdx = new Map(events.map((v, i) => [v, i]))
  const intern = (list: string[], index: Map<string, number>, v: string) => {
    let i = index.get(v)
    if (i === undefined) { i = list.length; list.push(v); index.set(v, i) }
    return i
  }

  // Register configured-but-dataless maps in the dictionary too, so they are selectable.
  for (const id of configuredNewMaps) intern(maps, gIdx, id)

  const baseMatchCount = base.meta.dict.matches.length

  // Per new match: earliest timestamp (ms), for match-elapsed time exactly as build.mjs does.
  const matchStart = new Map<string, number>()
  for (const r of kept) {
    const cur = matchStart.get(r.matchId)
    if (cur === undefined || r.t < cur) matchStart.set(r.matchId, r.t)
  }

  const N = base.n + kept.length

  // Unsorted combined columns.
  const x = new Float32Array(N), z = new Float32Array(N), y = new Float32Array(N)
  const tSec = new Uint32Array(N)
  const userIdx = new Uint16Array(N), matchIdx = new Uint16Array(N), elapsed = new Uint16Array(N)
  const mapIdx = new Uint8Array(N), evIdx = new Uint8Array(N)

  // Base rows copy straight over: their dictionary indices are unchanged under the extension.
  x.set(base.cols.x); z.set(base.cols.z); y.set(base.cols.y)
  tSec.set(base.cols.tSec)
  userIdx.set(base.cols.userIdx); matchIdx.set(base.cols.matchIdx); elapsed.set(base.cols.elapsed)
  mapIdx.set(base.cols.mapIdx); evIdx.set(base.cols.evIdx)

  let maxElapsed = base.meta.stats.maxElapsedSeconds
  for (let k = 0; k < kept.length; k++) {
    const r = kept[k]
    const i = base.n + k
    x[i] = r.x; z[i] = r.z; y[i] = r.y
    tSec[i] = Math.round(r.t / 1000)
    userIdx[i] = intern(users, uIdx, r.userId)
    matchIdx[i] = intern(matches, mIdx, r.matchId)
    mapIdx[i] = intern(maps, gIdx, r.mapId)
    evIdx[i] = intern(events, eIdx, r.event)
    const e = Math.round((r.t - matchStart.get(r.matchId)!) / 1000)
    if (e > maxElapsed) maxElapsed = e
    elapsed[i] = Math.min(Math.max(e, 0), 65535)
  }

  if (matches.length > 65535 || users.length > 65535) {
    throw new Error('merged dictionary exceeds Uint16 range — cannot add this much data client-side')
  }

  // ── Sort into (map, match, actor, time) order so contiguity holds ───────────
  const order = new Uint32Array(N)
  for (let i = 0; i < N; i++) order[i] = i
  const cmp = (a: number, b: number) =>
    mapIdx[a] - mapIdx[b] || matchIdx[a] - matchIdx[b] || userIdx[a] - userIdx[b] || tSec[a] - tSec[b]
  // Array.prototype.sort on a plain array; typed-array sort cannot take a comparator returning
  // the full range safely for our needs, and N is ~90k so this is a few milliseconds.
  const ord = Array.from(order).sort(cmp)

  const buffer = new ArrayBuffer(BYTES_PER_ROW * N)
  const out = viewColumns(buffer, N)
  for (let j = 0; j < N; j++) {
    const s = ord[j]
    out.x[j] = x[s]; out.z[j] = z[s]; out.y[j] = y[s]
    out.tSec[j] = tSec[s]
    out.userIdx[j] = userIdx[s]; out.matchIdx[j] = matchIdx[s]; out.elapsed[j] = elapsed[s]
    out.mapIdx[j] = mapIdx[s]; out.evIdx[j] = evIdx[s]
  }

  // ── matchMeta for the new matches, mirroring build.mjs exactly ──────────────
  interface Acc { map: string; t0: number; t1: number; files: Set<string>; humans: Set<string>; bots: Set<string>; kills: number; deaths: number; loot: number; storm: number; pvp: number }
  const acc = new Map<string, Acc>()
  for (const r of kept) {
    let m = acc.get(r.matchId)
    if (!m) { m = { map: r.mapId, t0: r.t, t1: r.t, files: new Set(), humans: new Set(), bots: new Set(), kills: 0, deaths: 0, loot: 0, storm: 0, pvp: 0 }; acc.set(r.matchId, m) }
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

  const matchMeta: MatchMeta[] = matches.map((id, i): MatchMeta => {
    if (i < baseMatchCount) return base.meta.matchMeta[i]
    const m = acc.get(id)!
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
  report.addedMatches = matches.length - baseMatchCount

  // ── Merged stats (keeps the honesty panel truthful after a drop) ────────────
  const eventCounts: Record<string, number> = { ...base.meta.stats.eventCounts }
  let addedOOB = 0
  const addedFiles = new Set<string>()
  const ambiguous = new Set(base.meta.stats.ambiguousActors)
  for (const r of kept) {
    eventCounts[r.event] = (eventCounts[r.event] ?? 0) + 1
    if (!r.inBounds) addedOOB++
    addedFiles.add(r.file)
    if (isAmbiguousActor(r.userId)) ambiguous.add(r.userId)
  }
  const dates = new Set(base.meta.stats.dates)
  for (const mm of matchMeta) dates.add(mm.date)

  const stats: DatasetStats = {
    ...base.meta.stats,
    filesOnDisk: base.meta.stats.filesOnDisk + addedFiles.size,
    uniqueFiles: base.meta.stats.uniqueFiles + addedFiles.size,
    humans: users.filter((u) => !isBot(u)).length,
    bots: users.filter((u) => isBot(u)).length,
    matches: matches.length,
    dates: [...dates].sort(),
    eventCounts,
    outOfBounds: base.meta.stats.outOfBounds + addedOOB,
    ambiguousActors: [...ambiguous].sort(),
    maxElapsedSeconds: maxElapsed,
  }

  const meta = {
    ...base.meta,
    generated: new Date().toISOString(),
    rows: N,
    masks,
    dict: { users, matches, maps, events },
    mapConfig,
    matchMeta,
    stats,
  }

  return { bundle: { meta, cols: out, n: N }, report }
}
