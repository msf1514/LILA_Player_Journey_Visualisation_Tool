import { useEffect, useMemo, useState } from 'react'
import { loadBundle, maskReader } from './data/loader'
import { Store } from './data/store'
import { filterRows, aggregate, deadSpace, diffGrids } from './data/query'
import type { Filter } from './data/types'
import { worldToUV, uvToWorldSpace, padBounds } from './map/project'
import type { UVBounds } from './map/project'
import {
  GRID_SIZE, heatPoints, trafficImage, dwellImage, heatLayer, deadSpaceLayer,
  collectEvents, eventLayer, buildPaths, pathLayer, actorLayer, eventStyle,
  diffImage, diffLayer,
} from './map/layers'
import MapCanvas from './ui/MapCanvas'
import LayerPanel from './ui/LayerPanel'
import type { LayerId } from './ui/LayerPanel'
import FilterRail from './ui/FilterRail'
import FilterChips from './ui/FilterChips'
import CompareBar, { makeFilterB } from './ui/CompareBar'
import type { CompareDim, CompareMode } from './ui/CompareBar'
import Timeline, { STORM_FLOOR_S, WINDOW_S, mmss } from './ui/Timeline'
import type { TimeMode } from './ui/Timeline'
import { usePlayback, useThrottled } from './ui/usePlayback'

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

  // Timeline state. `t` is the raw scrubber position: immediate, so the thumb and the clock
  // never lag the hand. The expensive work follows a throttled copy of it.
  // Comparison state. The B side is always "A with one dimension swapped".
  const [compareMode, setCompareMode] = useState<CompareMode>('single')
  const [compareDim, setCompareDim] = useState<CompareDim>('day')
  const [compareValue, setCompareValue] = useState<string | null>(null)

  const [mode, setMode] = useState<TimeMode>('cumulative')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [t, setT] = useState(() => store.meta.stats.maxElapsedSeconds)

  const mapId = filter.map ?? maps[0]
  const config = store.meta.mapConfig[mapId]

  /**
   * Axis length. Clamps to the chosen match's own duration when exactly one is selected, so
   * a 9-minute match does not sit on a 15-minute axis with five dead minutes to its right.
   */
  const selectedMatchIdx = useMemo(() => {
    const id = filter.matchIds?.[0]
    return id ? store.meta.dict.matches.indexOf(id) : -1
  }, [store, filter.matchIds])

  const maxT = selectedMatchIdx >= 0
    ? Math.max(1, store.matchMeta(selectedMatchIdx).duration)
    : store.meta.stats.maxElapsedSeconds

  /**
   * Sorted durations of the matches this filter covers, for the survivor curve.
   *
   * Deliberately ignores the actor and event filters: a match either ran to a given second
   * or it did not, regardless of which events you are looking at.
   */
  const durations = useMemo(() => {
    const out: number[] = []
    const from = filter.dateFrom
    const to = filter.dateTo ?? filter.dateFrom
    const ids = filter.matchIds ? new Set(filter.matchIds) : null
    store.meta.matchMeta.forEach((m, i) => {
      if (m.map !== mapId) return
      if (from && (m.date < from || m.date > (to ?? from))) return
      if (ids && !ids.has(store.matchId(i))) return
      out.push(m.duration)
    })
    return out.sort((a, b) => a - b)
  }, [store, mapId, filter.dateFrom, filter.dateTo, filter.matchIds])

  /**
   * The expensive work follows a throttled copy of `t`. Rebuilding a heat raster on every
   * animation frame would make the scrubber itself stutter, which is the one thing that has
   * to stay immediate. 90ms keeps the map feeling attached to the hand while cutting the
   * recomputation rate by about an order of magnitude during a fast drag.
   */
  const appliedT = useThrottled(t, 90)

  const atEnd = appliedT >= maxT - 0.5
  /** Cumulative at full range is not a filter at all, so the default view stays unfiltered. */
  const timeActive = !(mode === 'cumulative' && atEnd)

  const elapsedFrom = timeActive
    ? (mode === 'cumulative' ? 0 : Math.max(0, Math.round(appliedT - WINDOW_S)))
    : undefined
  const elapsedTo = timeActive ? Math.round(appliedT) : undefined

  /** One object. The timeline is just another filter, so every layer responds through it. */
  const effective = useMemo<Filter>(
    () => ({ ...filter, elapsedFrom, elapsedTo }),
    [filter, elapsedFrom, elapsedTo],
  )

  const clock = usePlayback(playing, speed, maxT, setT, () => setPlaying(false))

  /** Seeking moves both the UI value and the clock, so playback resumes from where you left it. */
  const seek = (v: number) => { clock.seek(v); setT(v) }

  // Park the scrubber at the end of a newly clamped axis rather than stranding it beyond one.
  // Declared after the clock: an earlier version sat above it and died on the temporal dead
  // zone, which blanked the whole app with only "Cannot access 'ne' before initialization".
  useEffect(() => { clock.seek(maxT); setT(maxT); setPlaying(false) }, [maxT, clock])
  const clearTime = () => { setMode('cumulative'); seek(maxT); setPlaying(false) }

  const toggle = (id: LayerId) =>
    setActive((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  /** One filter pass. Every layer, count and stat below derives from this single result. */
  const rows = useMemo(() => filterRows(store, effective), [store, effective])

  /**
   * Event counts under every filter EXCEPT the event filter itself.
   *
   * If the event filter were applied here, unchecking a type would report it as zero and a
   * designer could not tell "none of these happened under this filter" from "you switched it
   * off". Those are different facts, and on this data the first one matters: there are three
   * player-versus-player kills in the entire five days.
   */
  const eventCounts = useMemo(() => {
    const base = filterRows(store, { ...effective, events: undefined })
    const counts: Record<string, number> = {}
    for (const name of store.meta.dict.events) counts[name] = 0
    for (const r of base) counts[store.eventName(store.cols.evIdx[r])]++
    return counts
  }, [store, effective])

  const positionRows = useMemo(
    () => filterRows(store, { ...effective, events: intersectEvents(filter.events, POSITION_EVENTS) }),
    [store, effective, filter.events],
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
   * Paths take the two filter kinds differently, and the distinction matters.
   *
   * Map, date and actor choose WHICH journeys to draw: a journey is a whole route, and
   * part-filtering one would draw a fragment implying the player stopped where the filter did.
   *
   * Time is the exception. It clips points, because a route is walked over time: at minute
   * one the map must show only the first minute of it. Drawing the full route under a clock
   * reading 01:00 would have the map contradicting the timeline.
   */
  const mapIdx = maps.indexOf(mapId)
  const paths = useMemo(() => {
    const allowed = new Set<number>()
    for (const r of positionRows) allowed.add(store.cols.matchIdx[r] * 65536 + store.cols.userIdx[r])
    const window = elapsedTo !== undefined
      ? { from: elapsedFrom ?? 0, to: elapsedTo }
      : undefined
    return buildPaths(store, config, mapIdx, (u, m) => allowed.has(m * 65536 + u), window)
  }, [store, config, mapIdx, positionRows, elapsedFrom, elapsedTo])

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

  // ── Comparison ───────────────────────────────────────────────────────────
  const comparing = compareMode !== 'single' && compareValue !== null

  const filterB = useMemo<Filter | null>(
    () => (comparing ? makeFilterB(effective, compareDim, compareValue!) : null),
    [comparing, effective, compareDim, compareValue],
  )

  const rowsB = useMemo(
    () => (filterB ? filterRows(store, filterB) : null),
    [store, filterB],
  )

  /** Match counts per side. Sample size decides whether a difference is readable at all. */
  const matchCount = (f: Filter | null) => {
    if (!f) return 0
    const map = f.map ?? maps[0]
    const from = f.dateFrom
    const ids = f.matchIds ? new Set(f.matchIds) : null
    let n = 0
    store.meta.matchMeta.forEach((m, i) => {
      if (m.map !== map) return
      if (from && (m.date < from || m.date > (f.dateTo ?? from))) return
      if (ids && !ids.has(store.matchId(i))) return
      n++
    })
    return n
  }
  const countA = useMemo(() => matchCount(effective), [store, effective])
  const countB = useMemo(() => matchCount(filterB), [store, filterB])

  /**
   * Difference texture.
   *
   * Both sides are aggregated with the same measure and grid, then diffGrids normalises each
   * to SHARE of its own total. That normalisation is not optional: matches per day on Ambrose
   * fall from 201 to 24 across the window, so a raw-count diff would paint every later day
   * "less everywhere" and read as the map being abandoned.
   */
  const diff = useMemo(() => {
    if (compareMode !== 'diff' || !rowsB) return null
    const gridA = aggregate(store, positionRows, GRID_SIZE, 'traffic')
    const posB = filterRows(store, { ...filterB!, events: intersectEvents(filter.events, POSITION_EVENTS) })
    const gridB = aggregate(store, posB, GRID_SIZE, 'traffic')
    if (gridA.total === 0 || gridB.total === 0) return null
    return { ...diffImage(diffGrids(gridA, gridB), gridA, gridB), gridA, gridB }
  }, [compareMode, store, positionRows, rowsB, filterB, filter.events])

  /** Side-by-side needs one shared view state, or the two maps cannot be compared. */
  const [sharedView, setSharedView] = useState<SharedView | undefined>(undefined)

  const layersB = useMemo(() => {
    if (compareMode !== 'side' || !rowsB || !filterB) return []
    const posB = filterRows(store, { ...filterB, events: intersectEvents(filter.events, POSITION_EVENTS) })
    const out = []
    if (active.has('traffic')) out.push(heatLayer('traffic-b', trafficImage(heatPoints(store, posB, config, 'traffic'))))
    if (active.has('loot')) out.push(eventLayer('loot-b', collectEvents(store, rowsB, config, LOOT_EVENTS), 9))
    if (active.has('kills')) out.push(eventLayer('kills-b', collectEvents(store, rowsB, config, KILL_EVENTS), 12))
    if (active.has('deaths')) out.push(eventLayer('deaths-b', collectEvents(store, rowsB, config, DEATH_EVENTS), 13))
    return out
  }, [compareMode, store, rowsB, filterB, config, active, filter.events])

  // Layers are built fresh every render on purpose. deck.gl layers are single-use
  // descriptors: reusing an instance breaks the lifecycle and it stops drawing, silently.
  // The expensive inputs above are memoised instead.
  const layers = useMemo(() => {
    const out = []

    /**
     * Difference mode draws the delta and NOTHING else.
     *
     * Every other layer is built from side A alone, so overlaying them on an A-versus-B delta
     * mixes two incompatible things in one picture. A designer seeing side A's loot markers
     * sitting on top of the comparison would reasonably take them as part of it, and conclude
     * that loot moved when all they are looking at is where loot was on one of the two days.
     */
    if (diff) { out.push(diffLayer(diff.canvas)); return out }

    if (trafficImg) out.push(heatLayer('traffic', trafficImg))
    if (dwellImg) out.push(heatLayer('dwell', dwellImg))
    if (active.has('dead') && coverage) out.push(deadSpaceLayer(coverage.dead, coverage.size))
    if (active.has('paths')) out.push(pathLayer(paths))
    if (active.has('actors')) out.push(actorLayer(actors))
    if (active.has('loot')) out.push(eventLayer('loot', loot, 9))
    if (active.has('kills')) out.push(eventLayer('kills', kills, 12))
    if (active.has('deaths')) out.push(eventLayer('deaths', deaths, 13))
    return out
  }, [active, trafficImg, dwellImg, coverage, paths, actors, loot, kills, deaths, diff])

  const counts: Partial<Record<LayerId, number>> = {
    loot: loot.length, kills: kills.length, deaths: deaths.length,
    paths: paths.length, actors: actors.length, dead: coverage?.dead.length,
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">LILA BLACK</h1>
        <CompareBar
          store={store}
          mode={compareMode}
          dim={compareDim}
          value={compareValue}
          filter={effective}
          countA={countA}
          countB={countB}
          onMode={setCompareMode}
          onDim={setCompareDim}
          onValue={setCompareValue}
        />
        <FilterChips
          store={store}
          filter={filter}
          onChange={setFilter}
          timeLabel={timeActive ? timeChipLabel(mode, appliedT) : null}
          onClearTime={clearTime}
        />
      </header>

      <FilterRail store={store} filter={filter} onChange={setFilter} eventCounts={eventCounts} />

      <div className={compareMode === 'side' ? 'app-canvas app-canvas-split' : 'app-canvas'}>
        <MapCanvas
          mapId={mapId}
          config={config}
          layers={layers}
          focus={focus}
          getTooltip={tooltip}
          viewState={compareMode === 'side' ? sharedView : undefined}
          onViewState={compareMode === 'side' ? setSharedView : undefined}
        />
        {compareMode === 'side' && filterB && (
          <MapCanvas
            mapId={filterB.map ?? mapId}
            config={store.meta.mapConfig[filterB.map ?? mapId]}
            layers={layersB}
            focus={focus}
            viewState={sharedView}
            onViewState={setSharedView}
          />
        )}
        {compareMode === 'single' && <LayerPanel active={active} onToggle={toggle} counts={counts} />}
        {compareMode === 'diff' && (
          <div className="layer-note" role="note">
            Difference mode shows the change in traffic share only. Layers come from one side
            at a time, so they are hidden here. Switch to single or side by side to use them.
          </div>
        )}
        {rows.length === 0 && compareMode !== 'side' && (
          <EmptyState filter={effective} store={store} onChange={setFilter} onClearTime={clearTime} />
        )}
        {compareMode === 'diff' && <DiffNote comparing={comparing} diff={diff} />}
      </div>

      <Timeline
        t={t}
        max={maxT}
        mode={mode}
        playing={playing}
        speed={speed}
        durations={durations}
        totalMatches={durations.length}
        singleMatch={selectedMatchIdx >= 0}
        timeActive={timeActive}
        onSeek={(v) => { seek(v); setPlaying(false) }}
        onMode={setMode}
        onPlay={setPlaying}
        onSpeed={setSpeed}
        onReset={clearTime}
      />

      <StatStrip
        mapLabel={config.label}
        rows={rows.length}
        loot={loot.length}
        kills={kills.length}
        deaths={deaths.length}
        paths={paths.length}
        coverage={coverage}
        filtered={isFiltered(effective)}
      />
    </div>
  )
}

/** Intersect the user's event filter with the events a particular layer needs. */
function intersectEvents(selected: string[] | undefined, needed: string[]): string[] {
  if (!selected) return needed
  return needed.filter((e) => selected.includes(e))
}

const isFiltered = (f: Filter) =>
  Boolean(f.dateFrom || f.matchIds?.length || f.actor || f.events || f.elapsedTo !== undefined)

/**
 * Empty state.
 *
 * Naming the culprit matters because empty combinations are easy to reach by accident: Grand
 * Rift has only 59 matches across five days, so a map plus a day can legitimately yield
 * nothing. A blank map with no explanation reads as a broken tool.
 */
/** Chip text for the active time window. */
function timeChipLabel(mode: TimeMode, t: number): string {
  return mode === 'cumulative' ? 'Up to ' + mmss(t) : mmss(t) + ' (last ' + WINDOW_S + 's)'
}

function EmptyState({
  filter, store, onChange, onClearTime,
}: { filter: Filter; store: Store; onChange: (f: Filter) => void; onClearTime: () => void }) {
  const culprits: { label: string; clear?: Partial<Filter>; run?: () => void }[] = []
  if (filter.elapsedTo !== undefined) culprits.push({ label: 'the time window', run: onClearTime })
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
              onClick={() => (c.run ? c.run() : onChange({ ...filter, ...c.clear }))}
            >
              Clear {c.label}
            </button>
          ))}
          <button
            type="button"
            className="map-control"
            style={{ padding: '0 var(--space-3)' }}
            onClick={() => { onClearTime(); onChange({ map: filter.map }) }}
          >
            Clear all filters
          </button>
        </div>
      </div>
    </div>
  )
}

/** deck.gl view state, mirrored here so two canvases can share one. */
interface SharedView {
  target: [number, number, number]
  zoom: number
  minZoom?: number
  maxZoom?: number
  transitionDuration?: number
}

/**
 * Says why a difference cannot be drawn, instead of rendering an empty map.
 *
 * A blank difference view is ambiguous: it could mean "nothing changed", which is a real and
 * useful answer, or it could mean "this comparison was never computed". Those must not look
 * the same.
 */
function DiffNote({ comparing, diff }: { comparing: boolean; diff: { stats: { shown: number; suppressed: number } } | null }) {
  let text: string | null = null
  if (!comparing) text = 'Choose something to compare against.'
  else if (!diff) text = 'One side has no data on this map, so there is nothing to compare.'
  else if (diff.stats.shown === 0) {
    text = diff.stats.suppressed > 0
      ? `No difference worth showing. ${diff.stats.suppressed.toLocaleString()} cells had too little data on both sides.`
      : 'No meaningful difference between these two.'
  }
  if (!text) return null
  return <div className="diff-note" role="status">{text}</div>
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
      <span style={{ color: 'var(--text-3)' }}>storm from <b className="num">{mmss(STORM_FLOOR_S)}</b></span>
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
