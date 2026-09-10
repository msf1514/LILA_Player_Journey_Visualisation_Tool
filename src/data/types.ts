/**
 * Shared types for the data runtime.
 *
 * The dataset is held columnar in typed arrays rather than as an array of row objects.
 * At 89,016 rows an object-per-row would be ~89k allocations and roughly 20x the memory;
 * typed arrays keep the whole thing near 2 MB, let filters run over contiguous memory,
 * and hand deck.gl accessors data it can read without an intermediate copy.
 */

export interface MapConfig {
  label: string
  note?: string
  scale: number
  originX: number
  originZ: number
  version: string
  source: { file: string; width: number; height: number }
}

/** Playable-land mask derived from the minimap art (see pipeline/minimaps.mjs). */
export interface MapMask {
  size: number
  threshold: number
  playableCells: number
  playableFraction: number
  bits: string // base64, row-major, MSB first
}

export interface MatchMeta {
  map: string
  date: string      // YYYY-MM-DD, derived from ts (never from the folder name)
  start: number     // epoch seconds
  duration: number  // seconds
  journeys: number  // files in this match
  humans: number
  bots: number
  kills: number
  deaths: number
  loot: number
  storm: number
  pvp: number
}

export interface DatasetStats {
  filesOnDisk: number
  uniqueFiles: number
  duplicateFilesSkipped: string[]
  rowsSkippedFromDuplicates: number
  humans: number
  bots: number
  matches: number
  dates: string[]
  eventCounts: Record<string, number>
  combatInstants: number
  outOfBounds: number
  ambiguousActors: string[]
  maxElapsedSeconds: number
}

export interface Meta {
  generated: string
  rows: number
  columns: string[]
  bytesPerRow: number
  masks: Record<string, MapMask> | null
  dict: { users: string[]; matches: string[]; maps: string[]; events: string[] }
  mapConfig: Record<string, MapConfig>
  matchMeta: MatchMeta[]
  stats: DatasetStats
}

/** One column per field, all of length `n`. Index `i` addresses the same row across all. */
export interface Columns {
  x: Float32Array
  z: Float32Array
  y: Float32Array        // elevation. Kept for QA and filtering; never used for 2D placement.
  tSec: Uint32Array      // epoch SECONDS (ms overflows Uint32; source resolution is 1s)
  userIdx: Uint16Array
  matchIdx: Uint16Array
  elapsed: Uint16Array   // seconds since this match's first sample
  mapIdx: Uint8Array
  evIdx: Uint8Array
}

/** A contiguous run of rows belonging to one actor in one match. */
export interface Journey {
  userIdx: number
  matchIdx: number
  mapIdx: number
  start: number  // inclusive row index
  end: number    // exclusive row index
  bot: boolean
  ambiguous: boolean
}

export interface Filter {
  map?: string
  /** Inclusive YYYY-MM-DD range. Undefined means all days, which is the default view. */
  dateFrom?: string
  dateTo?: string
  matchIds?: string[]
  /** 'human' | 'bot' | undefined for both */
  actor?: 'human' | 'bot'
  /** Event names to include. Undefined means all. */
  events?: string[]
  /** Match-elapsed seconds window, inclusive. */
  elapsedFrom?: number
  elapsedTo?: number
}

export type GridMode = 'traffic' | 'dwell' | 'events'

export interface Grid {
  size: number
  values: Float32Array
  max: number
  total: number
  nonEmpty: number
}
