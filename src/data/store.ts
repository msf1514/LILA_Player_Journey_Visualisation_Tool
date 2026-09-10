/**
 * store.ts — the in-memory dataset with its lookup indices.
 *
 * Built once after load, then queried on every filter change. The indices exist so that
 * filtering never scans all 89,016 rows when it does not have to: picking a map or a match
 * narrows to a precomputed row range or list first, and only the remainder is scanned.
 *
 * Rows arrive sorted by (map, match, user, t) from the pipeline. Two consequences worth
 * relying on: each map occupies one contiguous block, and each actor's journey within a
 * match is one contiguous run -- so paths are built by slicing, never by grouping.
 */

import type { Bundle } from './loader'
import type { Columns, Journey, MatchMeta, Meta } from './types'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Accounts whose events contradict their id shape. Mirrors AMBIGUOUS_USER_IDS in
 * pipeline/transform.mjs. They stay classified by id shape (predictable, explainable)
 * and are flagged so the UI can disclose the caveat rather than hide it.
 */
export const AMBIGUOUS_USER_IDS = new Set(['1429', '1379', '1402'])

export class Store {
  readonly meta: Meta
  readonly cols: Columns
  readonly n: number

  /** map name -> [startRow, endRow) . Valid because rows are sorted by map. */
  readonly mapRanges = new Map<string, [number, number]>()
  /** match dictionary index -> row indices. */
  readonly matchRows = new Map<number, Uint32Array>()
  /** Contiguous per-actor-per-match runs. */
  readonly journeys: Journey[] = []
  /** YYYY-MM-DD -> match dictionary indices active that day. */
  readonly matchesByDate = new Map<string, number[]>()

  readonly isBotUser: boolean[] = []
  readonly isAmbiguousUser: boolean[] = []
  readonly eventNames: string[]
  readonly mapNames: string[]

  constructor(bundle: Bundle) {
    this.meta = bundle.meta
    this.cols = bundle.cols
    this.n = bundle.n
    this.eventNames = bundle.meta.dict.events
    this.mapNames = bundle.meta.dict.maps

    for (const id of bundle.meta.dict.users) {
      this.isBotUser.push(!UUID_RE.test(id))
      this.isAmbiguousUser.push(AMBIGUOUS_USER_IDS.has(id))
    }

    this.buildIndices()
  }

  private buildIndices() {
    const { mapIdx, matchIdx, userIdx } = this.cols
    const maps = this.meta.dict.maps

    // Map ranges + journey runs in one pass over the sorted rows.
    let mapStart = 0
    let runStart = 0
    for (let i = 1; i <= this.n; i++) {
      const end = i === this.n
      if (end || mapIdx[i] !== mapIdx[mapStart]) {
        this.mapRanges.set(maps[mapIdx[mapStart]], [mapStart, i])
        mapStart = i
      }
      if (end || matchIdx[i] !== matchIdx[runStart] || userIdx[i] !== userIdx[runStart]) {
        const u = userIdx[runStart]
        this.journeys.push({
          userIdx: u,
          matchIdx: matchIdx[runStart],
          mapIdx: mapIdx[runStart],
          start: runStart,
          end: i,
          bot: this.isBotUser[u],
          ambiguous: this.isAmbiguousUser[u],
        })
        runStart = i
      }
    }

    // Row lists per match. Counted first so each array is allocated exactly once.
    const counts = new Uint32Array(this.meta.dict.matches.length)
    for (let i = 0; i < this.n; i++) counts[matchIdx[i]]++
    const cursors = new Uint32Array(counts.length)
    for (let m = 0; m < counts.length; m++) this.matchRows.set(m, new Uint32Array(counts[m]))
    for (let i = 0; i < this.n; i++) {
      const m = matchIdx[i]
      this.matchRows.get(m)![cursors[m]++] = i
    }

    for (let m = 0; m < this.meta.matchMeta.length; m++) {
      const date = this.meta.matchMeta[m].date
      const list = this.matchesByDate.get(date)
      if (list) list.push(m)
      else this.matchesByDate.set(date, [m])
    }
  }

  matchMeta(matchIdx: number): MatchMeta { return this.meta.matchMeta[matchIdx] }
  matchId(matchIdx: number): string { return this.meta.dict.matches[matchIdx] }
  userId(userIdx: number): string { return this.meta.dict.users[userIdx] }
  eventName(evIdx: number): string { return this.eventNames[evIdx] }
  mapName(mapIdx: number): string { return this.mapNames[mapIdx] }

  /** Sorted list of dates present, derived from `ts` rather than the source folder names. */
  get dates(): string[] { return [...this.matchesByDate.keys()].sort() }

  /**
   * Matches worth replaying. 743 of 796 matches hold a single journey, so an unfiltered
   * picker keeps dropping designers into a match containing one lonely dot. This surfaces
   * the ~53 that actually have something to watch.
   */
  multiParticipantMatches(): number[] {
    const out: number[] = []
    this.meta.matchMeta.forEach((m, i) => { if (m.journeys > 1) out.push(i) })
    return out.sort((a, b) => this.meta.matchMeta[b].journeys - this.meta.matchMeta[a].journeys)
  }
}
