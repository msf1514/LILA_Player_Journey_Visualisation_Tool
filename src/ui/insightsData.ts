/**
 * insights.ts — the deterministic reading of this data, in sentences.
 *
 * Every figure here is computed from the shipped bundle at call time; nothing is typed in. Each
 * insight also carries the exact view that demonstrates it, so a reader can click a sentence and
 * land on the map state that proves it rather than taking the claim on trust. The view is a full
 * ViewState, so applying it also updates the URL and is shareable.
 *
 * This is the tool arriving with an opinion instead of a blank map, and backing every opinion
 * with the view that supports it.
 */

import type { Store } from '../data/store'
import { filterRows, aggregate, deadSpace } from '../data/query'
import { maskReader } from '../data/loader'
import { computeHotspots } from '../map/hotspots'
import { GRID_SIZE } from '../map/layers'
import { defaultState, type ViewState } from '../state/url'
import { STORM_FLOOR_S } from './Timeline'

export interface Insight {
  id: string
  /** One plain sentence, numbers included. */
  text: string
  /** The view that demonstrates it. */
  view: ViewState
  /** Which right-hand panel to show the result in. */
  tab: 'layers' | 'hotspots'
}

const POSITION_EVENTS = ['Position', 'BotPosition']

function fmtDate(date: string): string {
  const [, m, d] = date.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${Number(d)} ${months[Number(m) - 1] ?? m}`
}

export function computeInsights(store: Store): Insight[] {
  const base = defaultState(store)
  const meta = store.meta
  const ec = meta.stats.eventCounts
  const label = (id: string) => meta.mapConfig[id]?.label ?? id

  // Primary map = the one with the most matches, so the demonstrations are the least noisy.
  const countByMap = new Map<string, number>()
  for (const m of meta.matchMeta) countByMap.set(m.map, (countByMap.get(m.map) ?? 0) + 1)
  const primaryMap = [...meta.dict.maps].sort((a, b) => (countByMap.get(b) ?? 0) - (countByMap.get(a) ?? 0))[0]

  const out: Insight[] = []

  // Shared traffic grid for the primary map, reused by unconcentration and coverage.
  const posRows = filterRows(store, { map: primaryMap, events: POSITION_EVENTS })
  const grid = aggregate(store, posRows, GRID_SIZE, 'traffic')

  // 1. Traffic is unconcentrated.
  const hot = computeHotspots(grid)
  out.push({
    id: 'unconcentrated',
    text: `On ${label(primaryMap)}, traffic is spread thin: the busiest cluster is only ${(hot.topShare * 100).toFixed(1)}% of it, and the ranks below are nearly tied.`,
    view: { ...base, filter: { map: primaryMap }, layers: ['traffic'], compareMode: 'single' },
    tab: 'hotspots',
  })

  // 2. Combat is against bots.
  const botKills = ec.BotKill ?? 0
  const pvpKills = ec.Kill ?? 0
  out.push({
    id: 'bot-combat',
    text: `Combat is almost entirely against bots: ${botKills.toLocaleString()} kills against bots, ${pvpKills} against other players across all five days.`,
    view: { ...base, filter: { map: primaryMap }, layers: ['kills'], compareMode: 'single' },
    tab: 'layers',
  })

  // 3. Survivorship drop-off by the storm floor.
  const durations = meta.matchMeta.filter((m) => m.map === primaryMap).map((m) => m.duration)
  const live = durations.filter((d) => d >= STORM_FLOOR_S).length
  out.push({
    id: 'survivorship',
    text: `On ${label(primaryMap)}, only ${live} of ${durations.length} matches are still running when the storm can first kill at 10:55; a thinning map after then is matches ending, not players going quiet.`,
    view: { ...base, filter: { map: primaryMap }, layers: ['traffic'], timeMode: 'window', t: STORM_FLOOR_S, compareMode: 'single' },
    tab: 'layers',
  })

  // 4. Coverage of playable land.
  const mask = meta.masks?.[primaryMap]
  if (mask) {
    const cov = deadSpace(grid, maskReader(mask.bits, mask.size), mask.size)
    out.push({
      id: 'coverage',
      text: `Players reach ${Math.round(cov.coverage * 100)}% of the playable land on ${label(primaryMap)}; the rest never sees a footstep.`,
      view: { ...base, filter: { map: primaryMap }, layers: ['traffic', 'dead'], compareMode: 'single' },
      tab: 'layers',
    })
  }

  // 5. Day-to-day volume collapse.
  const byDay = new Map<string, number>()
  for (const m of meta.matchMeta) if (m.map === primaryMap) byDay.set(m.date, (byDay.get(m.date) ?? 0) + 1)
  const days = [...byDay.entries()].sort((a, b) => b[1] - a[1])
  if (days.length >= 2) {
    const [busyDay, busyN] = days[0]
    const [thinDay, thinN] = days[days.length - 1]
    out.push({
      id: 'volume-collapse',
      text: `Daily volume on ${label(primaryMap)} collapses from ${busyN} matches on ${fmtDate(busyDay)} to ${thinN} on ${fmtDate(thinDay)}; the difference view normalises to share so this drop does not read as the map being abandoned.`,
      view: {
        ...base,
        filter: { map: primaryMap, dateFrom: busyDay, dateTo: busyDay },
        compareMode: 'diff', compareDim: 'day', compareValue: thinDay,
      },
      tab: 'layers',
    })
  }

  return out
}
