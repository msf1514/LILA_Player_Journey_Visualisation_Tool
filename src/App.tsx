import { useEffect, useMemo, useState } from 'react'
import { loadBundle, maskReader } from './data/loader'
import { Store } from './data/store'
import { filterRows, aggregate, deadSpace } from './data/query'
import type { Filter } from './data/types'
import { worldToUV, uvToWorldSpace, padBounds } from './map/project'
import type { UVBounds } from './map/project'
import {
  GRID_SIZE, heatPoints, trafficImage, dwellImage, heatLayer, deadSpaceLayer,
  collectEvents, eventLayer, buildPaths, pathLayer, actorLayer, eventStyle,
} from './map/layers'
import MapCanvas from './ui/MapCanvas'
import LayerPanel from './ui/LayerPanel'
import type { LayerId } from './ui/LayerPanel'
import FilterRail from './ui/FilterRail'
import FilterChips from './ui/FilterChips'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; store: Store }

export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    loadBundle()
      .then((bundle) => { if (!cancelled) setState({ status: 'ready', store: new Store(bundle) }) })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
        }
      })
    return () => { cancelled = true }
  }, [])

  if (state.status === 'loading') {
    return <Centered><p style={{ margin: 0 }}>Loading telemetry</p></Centered>
  }

  if (state.status === 'error') {
    return (
      <Centered>
        <p style={{ margin: 0, color: 'var(--ev-kill)' }}>Telemetry failed to load.</p>
        <p className="num" style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>
          {state.message}
        </p>
        <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 'var(--text-sm)' }}>
          Run <code style={{ fontFamily: 'var(--font-mono)' }}>npm run build:data</code> to regenerate the bundle.
        </p>
      </Centered>
    )
  }

  return <Workspace store={state.store} />
}

const POSITION_EVENTS = ['Position', 'BotPosition']
const LOOT_EVENTS = new Set(['Loot'])
const KILL_EVENTS = new Set(['BotKill', 'Kill'])
const DEATH_EVENTS = new Set(['BotKilled', 'Killed', 'KilledByStorm'])

function Workspace({ store }: { store: Store }) {
  const maps = store.meta.dict.maps
  // No date is set on purpose: the default view is ALL DAYS, and narrowing to one is a
  // deliberate act. A tool that silently opens on a single day invites wrong conclusions.
  const [filter, setFilter] = useState<Filter>(() => ({ map: maps[0] }))
  const [active, setActive] = useState<Set<LayerId>>(() => new Set<LayerId>(['traffic', 'loot']))

  const mapId = filter.map ?? maps[0]
  const config = store.meta.mapConfig[mapId]

  const toggle = (id: LayerId) =>
    setActive((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  /** One filter pass. Every layer, count and stat below derives from this single result. */
  const rows = useMemo(() => filterRows(store, filter), [store, filter])

  /**
   * Event counts under every filter EXCEPT the event filter itself.
   *
   * If the event filter were applied here, unchecking a type would report it as zero and a
   * designer could not tell "none of these happened under this filter" from "you switched it
   * off". Those are different facts, and on this data the first one matters: there are three
   * player-versus-player kills in the entire five days.
   */
  const eventCounts = useMemo(() => {
    const base = filterRows(store, { ...filter, events: undefined })
    const counts: Record<string, number> = {}
    for (const name of store.meta.dict.events) counts[name] = 0
    for (const r of base) counts[store.eventName(store.cols.evIdx[r])]++
    return counts
  }, [store, filter])

  const positionRows = useMemo(
    () => filterRows(store, { ...filter, events: intersectEvents(filter.events, POSITION_EVENTS) }),
    [store, filter],
  )

  /**
   * Heat images are rasterised only for the layers actually switched on.
   *
   * Building one is the most expensive thing a filter change triggers, and computing a
   * texture nobody is looking at would double that cost for nothing.
   */
  const wantTraffic = active.has('traffic')
  const wantDwell = active.has('dwell')

  const trafficImg = useMemo(
    () => (wantTraffic ? trafficImage(heatPoints(store, positionRows, config, 'traffic')) : null),
    [wantTraffic, store, positionRows, config],
  )
  const dwellImg = useMemo(
    () => (wantDwell ? dwellImage(heatPoints(store, positionRows, config, 'dwell')) : null),
    [wantDwell, store, positionRows, config],
  )

  /**
   * Coverage uses the traffic measure as a grid, whatever is currently displayed.
   *
   * Returns null when no position events are selected, rather than a coverage of 0%. Zero
   * would read as "players visited none of this map", when the truth is "you filtered out
   * the data coverage is computed from". Reporting a measurement you did not take is worse
   * than reporting nothing.
   */
  const coverage = useMemo(() => {
    const mask = store.meta.masks?.[mapId]
    if (!mask || positionRows.length === 0) return null
    const grid = aggregate(store, positionRows, GRID_SIZE, 'traffic')
    return deadSpace(grid, maskReader(mask.bits, mask.size), mask.size)
  }, [store, mapId, positionRows])

  const loot = useMemo(() => collectEvents(store, rows, config, LOOT_EVENTS), [store, rows, config])
  const kills = useMemo(() => collectEvents(store, rows, config, KILL_EVENTS), [store, rows, config])
  const deaths = useMemo(() => collectEvents(store, rows, config, DEATH_EVENTS), [store, rows, config])

  /**
   * Paths respect the filter by choosing which journeys to draw, not by trimming points from
   * them. A journey is a whole route: filtering it part-way would draw a fragment and imply
   * the player stopped where the filter did.
   */
  const mapIdx = maps.indexOf(mapId)
  const paths = useMemo(() => {
    const allowed = new Set<number>()
    for (const r of positionRows) allowed.add(store.cols.matchIdx[r] * 65536 + store.cols.userIdx[r])
    return buildPaths(store, config, mapIdx, (u, m) => allowed.has(m * 65536 + u))
  }, [store, config, mapIdx, positionRows])

  const actors = useMemo(() => {
    const stride = Math.max(1, Math.ceil(positionRows.length / 14000))
    const out: { position: [number, number]; bot: boolean }[] = []
    for (let i = 0; i < positionRows.length; i += stride) {
      const r = positionRows[i]
      const { u, v } = worldToUV(store.cols.x[r], store.cols.z[r], config)
      out.push({ position: uvToWorldSpace(u, v), bot: store.isBotUser[store.cols.userIdx[r]] })
    }
    return out
  }, [store, positionRows, config])

  /**
   * Framing follows the map, never the filter. If the view re-fitted on every filter change
   * the map would jump under the designer's hands, and two filtered views would be
   * impossible to compare by eye.
   */
  const focus = useMemo<UVBounds>(() => {
    const all = filterRows(store, { map: mapId })
    let uMin = 1, vMin = 1, uMax = 0, vMax = 0
    for (const r of all) {
      const { u, v } = worldToUV(store.cols.x[r], store.cols.z[r], config)
      if (u < uMin) uMin = u
      if (u > uMax) uMax = u
      if (v < vMin) vMin = v
      if (v > vMax) vMax = v
    }
    return uMax > uMin ? padBounds([uMin, vMin, uMax, vMax], 0.06) : [0, 0, 1, 1]
  }, [store, mapId, config])

  // Layers are built fresh every render on purpose. deck.gl layers are single-use
  // descriptors: reusing an instance breaks the lifecycle and it stops drawing, silently.
  // The expensive inputs above are memoised instead.
  const layers = useMemo(() => {
    const out = []
    if (trafficImg) out.push(heatLayer('traffic', trafficImg))
    if (dwellImg) out.push(heatLayer('dwell', dwellImg))
    if (active.has('dead') && coverage) out.push(deadSpaceLayer(coverage.dead, coverage.size))
    if (active.has('paths')) out.push(pathLayer(paths))
    if (active.has('actors')) out.push(actorLayer(actors))
    if (active.has('loot')) out.push(eventLayer('loot', loot, 9))
    if (active.has('kills')) out.push(eventLayer('kills', kills, 12))
    if (active.has('deaths')) out.push(eventLayer('deaths', deaths, 13))
    return out
  }, [active, trafficImg, dwellImg, coverage, paths, actors, loot, kills, deaths])

  const counts: Partial<Record<LayerId, number>> = {
    loot: loot.length, kills: kills.length, deaths: deaths.length,
    paths: paths.length, actors: actors.length, dead: coverage?.dead.length,
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">LILA BLACK</h1>
        <FilterChips store={store} filter={filter} onChange={setFilter} />
      </header>

      <FilterRail store={store} filter={filter} onChange={setFilter} eventCounts={eventCounts} />

      <div className="app-canvas">
        <MapCanvas mapId={mapId} config={config} layers={layers} focus={focus} getTooltip={tooltip} />
        <LayerPanel active={active} onToggle={toggle} counts={counts} />
        {rows.length === 0 && <EmptyState filter={filter} store={store} onChange={setFilter} />}
      </div>

      <StatStrip
        mapLabel={config.label}
        rows={rows.length}
        loot={loot.length}
        kills={kills.length}
        deaths={deaths.length}
        paths={paths.length}
        coverage={coverage}
        filtered={isFiltered(filter)}
      />
    </div>
  )
}

/** Intersect the user's event filter with the events a particular layer needs. */
function intersectEvents(selected: string[] | undefined, needed: string[]): string[] {
  if (!selected) return needed
  return needed.filter((e) => selected.includes(e))
}

const isFiltered = (f: Filter) => Boolean(f.dateFrom || f.matchIds?.length || f.actor || f.events)

/**
 * Empty state.
 *
 * Naming the culprit matters because empty combinations are easy to reach by accident: Grand
 * Rift has only 59 matches across five days, so a map plus a day can legitimately yield
 * nothing. A blank map with no explanation reads as a broken tool.
 */
function EmptyState({
  filter, store, onChange,
}: { filter: Filter; store: Store; onChange: (f: Filter) => void }) {
  const culprits: { label: string; clear: Partial<Filter> }[] = []
  if (filter.dateFrom) culprits.push({ label: 'the selected day', clear: { dateFrom: undefined, dateTo: undefined } })
  if (filter.matchIds?.length) culprits.push({ label: 'the selected match', clear: { matchIds: undefined } })
  if (filter.actor) culprits.push({ label: 'the actor filter', clear: { actor: undefined } })
  if (filter.events) culprits.push({ label: 'the event filter', clear: { events: undefined } })

  return (
    <div className="empty-state" role="status">
      <div>
        <p>
          No events on {store.meta.mapConfig[filter.map ?? store.meta.dict.maps[0]].label}
          {culprits.length > 0 && <> with {culprits.map((c) => c.label).join(' and ')}</>}.
        </p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'center', flexWrap: 'wrap' }}>
          {culprits.map((c) => (
            <button
              key={c.label}
              type="button"
              className="map-control"
              style={{ padding: '0 var(--space-3)' }}
              onClick={() => onChange({ ...filter, ...c.clear })}
            >
              Clear {c.label}
            </button>
          ))}
          <button
            type="button"
            className="map-control"
            style={{ padding: '0 var(--space-3)' }}
            onClick={() => onChange({ map: filter.map })}
          >
            Clear all filters
          </button>
        </div>
      </div>
    </div>
  )
}

function tooltip({ object }: { object?: unknown }) {
  const o = object as { event?: string; bot?: boolean; elapsed?: number } | undefined
  if (!o?.event) return null
  const s = eventStyle(o.event)
  const e = o.elapsed ?? 0
  const mmss = `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`
  return {
    text: `${s.label}\n${o.bot ? 'Bot' : 'Human'} · ${mmss} into the match`,
    style: {
      background: 'var(--bg-2)', color: 'var(--text-1)',
      border: '1px solid var(--line-strong)', borderRadius: '4px',
      fontSize: '12px', fontFamily: 'var(--font-sans)', padding: '6px 8px',
    },
  }
}

function StatStrip({
  mapLabel, rows, loot, kills, deaths, paths, coverage, filtered,
}: {
  mapLabel: string
  rows: number
  loot: number
  kills: number
  deaths: number
  paths: number
  coverage: { coverage: number; playable: number; visited: number; size: number } | null
  filtered: boolean
}) {
  return (
    <div className="stat-strip">
      <span><b>{mapLabel}</b></span>
      <span>rows <b className="num">{rows.toLocaleString()}</b></span>
      <span>loot <b className="num">{loot.toLocaleString()}</b></span>
      {/* "vs bots" is not decoration: 2,410 of these kills are against bots and 3 are not. */}
      <span>kills vs bots <b className="num">{kills.toLocaleString()}</b></span>
      <span>deaths <b className="num">{deaths.toLocaleString()}</b></span>
      <span>journeys <b className="num">{paths.toLocaleString()}</b></span>
      {coverage ? (
        <span>
          coverage <b className="num">{Math.round(coverage.coverage * 100)}%</b> of playable land,
          measured on a <b className="num">{coverage.size}×{coverage.size}</b> grid
          {filtered && <span style={{ color: 'var(--text-3)' }}> (filtered)</span>}
        </span>
      ) : (
        <span style={{ color: 'var(--text-3)' }}>coverage needs position events</span>
      )}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', placeItems: 'center', minHeight: '100dvh',
      textAlign: 'center', padding: 'var(--space-5)',
    }}>
      <div style={{ display: 'grid', gap: 'var(--space-2)', color: 'var(--text-2)', maxWidth: '65ch' }}>
        {children}
      </div>
    </div>
  )
}
