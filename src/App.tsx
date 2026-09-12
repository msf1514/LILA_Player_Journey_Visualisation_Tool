import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { loadBundle, maskReader, type Bundle } from './data/loader'
import { Store } from './data/store'
import { filterRows, aggregate, deadSpace, diffGrids } from './data/query'
import type { Filter, MapConfig } from './data/types'
import { buildMergedBundle } from './data/merge'
import { loadPersisted, savePersisted, clearPersisted, type PersistedData, type AddedMap } from './data/persist'
import type { IngestResult } from './data/ingest'
import { worldToUV, uvToWorldSpace, padBounds, registerMinimap } from './map/project'
import type { UVBounds } from './map/project'
import {
  GRID_SIZE, heatPoints, trafficImage, dwellImage,
  collectEvents, buildPaths, eventStyle, diffImage,
} from './map/layers'
import type { SharedView } from './ui/MapStage'
import { computeHotspots } from './map/hotspots'
import Hotspots from './ui/Hotspots'
import type { RunKey, JourneyRow, RunDetail } from './ui/Hotspots'
import LayerPanel from './ui/LayerPanel'
import type { LayerId } from './ui/LayerPanel'
import CopyLink from './ui/CopyLink'
import DataNotes, { OrientationHint } from './ui/DataNotes'
import DataManager from './ui/DataManager'
import { useUrlState, readInitialState } from './ui/useUrlState'
import type { ViewState } from './state/url'
import FilterRail from './ui/FilterRail'
import FilterChips from './ui/FilterChips'
import CompareBar, { makeFilterB } from './ui/CompareBar'
import type { CompareDim, CompareMode } from './ui/CompareBar'
import Timeline, { STORM_FLOOR_S, WINDOW_S, mmss } from './ui/Timeline'
import type { TimeMode } from './ui/Timeline'
import { usePlayback, useThrottled } from './ui/usePlayback'

/**
 * The renderer (deck.gl) and the data bundle are both started the instant this module runs,
 * before React has mounted, so the two large downloads overlap instead of serialising.
 *
 *   - `bundlePromise` fetches meta.json + bundle.bin (~2.1 MB) at once.
 *   - `warmMapStage()` pulls the code-split deck.gl chunk (~1 MB) alongside it.
 *
 * By the time the data resolves the renderer chunk is usually already resident, so the map
 * appears without a second wait. The shell paints first from a small initial chunk that has
 * no deck.gl in it at all.
 */
const loadMapStage = () => import('./ui/MapStage')
const MapStage = lazy(loadMapStage)
const bundlePromise = loadBundle()
loadMapStage()

export default function App() {
  const [base, setBase] = useState<Bundle | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<PersistedData>({ rows: [], maps: [] })

  useEffect(() => {
    let cancelled = false
    Promise.all([bundlePromise, loadPersisted()])
      .then(([bundle, persisted]) => {
        if (cancelled) return
        for (const m of persisted.maps) registerMinimap(m.id, m.minimap)
        setBase(bundle)
        setAdded(persisted)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
    return () => { cancelled = true }
  }, [])

  // The store the whole app runs on: base telemetry with any dropped data merged in.
  const store = useMemo(() => {
    if (!base) return null
    const mapConfig: Record<string, MapConfig> = {}
    for (const m of added.maps) mapConfig[m.id] = m.config
    const { bundle } = buildMergedBundle(base, { rows: added.rows, mapConfig })
    return new Store(bundle)
  }, [base, added])

  const onIngest = (result: IngestResult) => {
    if (!base) return
    setAdded((prev) => {
      // Only persist rows for genuinely new matches; re-dropping shipped or already-added data
      // is a no-op at merge time, so keeping those rows would just bloat storage.
      const known = new Set(base.meta.dict.matches)
      for (const r of prev.rows) known.add(r.matchId)
      const fresh = result.rows.filter((r) => !known.has(r.matchId))
      if (!fresh.length) return prev
      const next: PersistedData = { rows: [...prev.rows, ...fresh], maps: prev.maps }
      void savePersisted(next)
      return next
    })
  }

  const onAddMap = (map: AddedMap) => {
    registerMinimap(map.id, map.minimap)
    setAdded((prev) => {
      const next: PersistedData = { rows: prev.rows, maps: [...prev.maps.filter((m) => m.id !== map.id), map] }
      void savePersisted(next)
      return next
    })
  }

  const onClearData = () => {
    void clearPersisted()
    setAdded({ rows: [], maps: [] })
  }

  if (error) {
    return (
      <Centered>
        <p style={{ margin: 0, color: 'var(--ev-kill)' }}>Telemetry failed to load.</p>
        <p className="num" style={{ margin: 0, fontSize: 'var(--text-xs)', color: 'var(--text-3)' }}>
          {error}
        </p>
        <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 'var(--text-sm)' }}>
          Run <code style={{ fontFamily: 'var(--font-mono)' }}>npm run build:data</code> to regenerate the bundle.
        </p>
      </Centered>
    )
  }

  if (!store) return <AppSkeleton />

  return (
    <Workspace
      store={store}
      added={added}
      onIngest={onIngest}
      onAddMap={onAddMap}
      onClearData={onClearData}
    />
  )
}

const POSITION_EVENTS = ['Position', 'BotPosition']
const LOOT_EVENTS = new Set(['Loot'])
const KILL_EVENTS = new Set(['BotKill', 'Kill'])
const DEATH_EVENTS = new Set(['BotKilled', 'Killed', 'KilledByStorm'])

function Workspace({
  store, added, onIngest, onAddMap, onClearData,
}: {
  store: Store
  added: PersistedData
  onIngest: (r: IngestResult) => void
  onAddMap: (m: AddedMap) => void
  onClearData: () => void
}) {
  // File names already loaded, so re-dropping the same file is skipped by the parser.
  const existingFileNames = useMemo(() => new Set(added.rows.map((r) => r.file)), [added.rows])
  const maps = store.meta.dict.maps

  /**
   * Every piece of state below is seeded from the address bar, so opening a shared link lands
   * directly on that view instead of rendering the default and then jumping.
   *
   * No date is set by default on purpose: the default view is ALL DAYS, and narrowing to one
   * is a deliberate act. A tool that silently opens on a single day invites wrong conclusions.
   */
  const initial = useRef(readInitialState(store)).current

  const [filter, setFilter] = useState<Filter>(initial.state.filter)
  const [active, setActive] = useState<Set<LayerId>>(() => new Set(initial.state.layers))

  // Comparison state. The B side is always "A with one dimension swapped".
  const [compareMode, setCompareMode] = useState<CompareMode>(initial.state.compareMode)
  const [compareDim, setCompareDim] = useState<CompareDim>(initial.state.compareDim)
  const [compareValue, setCompareValue] = useState<string | null>(initial.state.compareValue)

  // Timeline state. `t` is the raw scrubber position: immediate, so the thumb and the clock
  // never lag the hand. The expensive work follows a throttled copy of it.
  const [mode, setMode] = useState<TimeMode>(initial.state.timeMode)
  // Playback is deliberately NOT restorable from a link. A shared view that starts playing
  // takes control away from whoever opened it: share the position, never the motion.
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [t, setT] = useState(() => initial.state.t ?? store.meta.stats.maxElapsedSeconds)

  /** Anything the current data could not honour from the link, reported once. */
  const [dropped, setDropped] = useState<string[]>(initial.dropped)

  // Right-hand panel: layers, or the hotspot drill-down. Selection is by cluster id (its peak
  // cell), which survives a re-rank; the run is one actor in one match.
  const [rightTab, setRightTab] = useState<'layers' | 'hotspots'>('layers')
  const [selectedClusterId, setSelectedClusterId] = useState<number | null>(null)
  const [selectedRun, setSelectedRun] = useState<RunKey | null>(null)

  // Fall back to the first map if the selected one is gone: removing added data can drop the
  // map the view was on, and reading a config for a map that no longer exists would crash.
  const mapId = filter.map && maps.includes(filter.map) ? filter.map : maps[0]
  const config = store.meta.mapConfig[mapId]

  // Self-heal a filter left pointing at a map that no longer exists (added data was removed),
  // so the switcher, chips and URL all settle back onto a real map.
  useEffect(() => {
    if (filter.map && !maps.includes(filter.map)) setFilter((f) => ({ ...f, map: maps[0] }))
  }, [filter.map, maps])

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
  // Skipped on the very first run when the link supplied a time, which would otherwise be
  // overwritten the moment the page settled.
  // Declared after the clock: an earlier version sat above it and died on the temporal dead
  // zone, which blanked the whole app with only "Cannot access 'ne' before initialization".
  const seededTime = useRef(initial.state.t !== null)
  useEffect(() => {
    if (seededTime.current) { seededTime.current = false; return }
    clock.seek(maxT); setT(maxT); setPlaying(false)
  }, [maxT, clock])
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

  // ── Hotspots ─────────────────────────────────────────────────────────────
  // The traffic grid that the heat map already uses, ranked into clusters. It follows the
  // current filter, so hotspots are of what is on screen, not of the whole dataset.
  const trafficGrid = useMemo(
    () => aggregate(store, positionRows, GRID_SIZE, 'traffic'),
    [store, positionRows],
  )
  const hotspots = useMemo(() => computeHotspots(trafficGrid), [trafficGrid])
  const hotspotMode = rightTab === 'hotspots' && compareMode === 'single'

  const selectedCluster = useMemo(
    () => hotspots.clusters.find((c) => c.id === selectedClusterId) ?? null,
    [hotspots, selectedClusterId],
  )

  // A selection made against one view can be meaningless in another (different map, or the
  // cluster no longer exists after a filter change). Drop it rather than point at nothing.
  useEffect(() => {
    if (selectedClusterId !== null && !hotspots.clusters.some((c) => c.id === selectedClusterId)) {
      setSelectedClusterId(null)
      setSelectedRun(null)
    }
  }, [hotspots, selectedClusterId])

  /** Journeys that passed through the selected cluster, most-present first. */
  const journeys = useMemo<JourneyRow[] | null>(() => {
    if (!selectedCluster) return null
    const cellSet = new Set(selectedCluster.cells)
    const counts = new Map<number, number>()
    const { x, z, userIdx, matchIdx } = store.cols
    for (const r of positionRows) {
      const { u, v } = worldToUV(x[r], z[r], config)
      if (u < 0 || u > 1 || v < 0 || v > 1) continue
      const col = Math.min(GRID_SIZE - 1, (u * GRID_SIZE) | 0)
      const row = Math.min(GRID_SIZE - 1, ((1 - v) * GRID_SIZE) | 0)
      if (!cellSet.has(row * GRID_SIZE + col)) continue
      const key = matchIdx[r] * 65536 + userIdx[r]
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    const out: JourneyRow[] = []
    for (const [key, samples] of counts) {
      const u = key % 65536
      out.push({ userIdx: u, matchIdx: (key - u) / 65536, bot: store.isBotUser[u], samplesInCluster: samples })
    }
    out.sort((a, b) => b.samplesInCluster - a.samplesInCluster)
    return out
  }, [selectedCluster, store, positionRows, config])

  /** The one selected run, drawn as a bright path over everything else. Whole route, not clipped. */
  const runPath = useMemo(() => {
    if (!selectedRun) return null
    return buildPaths(store, config, mapIdx, (u, m) => u === selectedRun.userIdx && m === selectedRun.matchIdx)
  }, [selectedRun, store, config, mapIdx])

  const runDetail = useMemo<RunDetail | null>(() => {
    if (!selectedRun) return null
    const j = store.journeys.find(
      (jr) => jr.userIdx === selectedRun.userIdx && jr.matchIdx === selectedRun.matchIdx && jr.mapIdx === mapIdx,
    )
    if (!j) return null
    let loot = 0, kills = 0, deaths = 0, positions = 0
    for (let i = j.start; i < j.end; i++) {
      const name = store.eventName(store.cols.evIdx[i])
      if (name === 'Loot') loot++
      else if (name === 'BotKill' || name === 'Kill') kills++
      else if (name === 'BotKilled' || name === 'Killed' || name === 'KilledByStorm') deaths++
      else if (name === 'Position' || name === 'BotPosition') positions++
    }
    const m = store.matchMeta(selectedRun.matchIdx)
    return {
      bot: store.isBotUser[selectedRun.userIdx],
      matchIdShort: store.matchId(selectedRun.matchIdx).slice(0, 8),
      date: m.date,
      durationS: m.duration,
      loot, kills, deaths, positions,
    }
  }, [selectedRun, store, mapIdx])

  const selectCluster = (id: number | null) => {
    setRightTab('hotspots')
    setSelectedClusterId(id)
    setSelectedRun(null)
  }

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

  // The deck.gl layer arrays are built inside MapStage, the code-split renderer. App produces
  // only the deck.gl-free inputs above (baked textures, positioned geometry, event points) and
  // hands them across, so nothing in the load path imports deck.gl.

  /**
   * The shareable view, assembled from the pieces above.
   *
   * `t` is stored as null when the timeline covers the whole match, so an unscrubbed view
   * produces no time parameter and the default link stays bare.
   */
  const viewState = useMemo<ViewState>(() => ({
    filter,
    layers: [...active],
    timeMode: mode,
    t: timeActive ? Math.round(appliedT) : null,
    compareMode,
    compareDim,
    compareValue,
  }), [filter, active, mode, timeActive, appliedT, compareMode, compareDim, compareValue])

  const applyFromHistory = (next: ViewState, drops: string[]) => {
    setFilter(next.filter)
    setActive(new Set(next.layers))
    setMode(next.timeMode)
    setCompareMode(next.compareMode)
    setCompareDim(next.compareDim)
    setCompareValue(next.compareValue)
    setPlaying(false)
    const nt = next.t ?? maxT
    clock.seek(nt)
    setT(nt)
    setDropped(drops)
  }

  useUrlState(viewState, store, applyFromHistory)

  const counts: Partial<Record<LayerId, number>> = {
    loot: loot.length, kills: kills.length, deaths: deaths.length,
    paths: paths.length, actors: actors.length, dead: coverage?.dead.length,
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">LILA BLACK</h1>
        <CopyLink />
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
        <span className="header-right">
          <DataManager
            store={store}
            addedRows={added.rows.length}
            addedMaps={added.maps}
            existingFileNames={existingFileNames}
            onIngest={onIngest}
            onAddMap={onAddMap}
            onClear={onClearData}
          />
          <DataNotes store={store} />
        </span>
      </header>

      <FilterRail store={store} filter={filter} onChange={setFilter} eventCounts={eventCounts} />

      <div className={compareMode === 'side' && comparing ? 'app-canvas app-canvas-split' : 'app-canvas'}>
        <Suspense fallback={<MapAreaSkeleton split={compareMode === 'side' && comparing} />}>
          <MapStage
            mapId={mapId}
            config={config}
            focus={focus}
            active={active}
            trafficImg={trafficImg}
            dwellImg={dwellImg}
            coverage={coverage}
            paths={paths}
            actors={actors}
            loot={loot}
            kills={kills}
            deaths={deaths}
            diffCanvas={diff ? diff.canvas : null}
            getTooltip={tooltip}
            compareMode={compareMode}
            store={store}
            rowsB={rowsB}
            filterB={filterB}
            eventsFilter={filter.events}
            sharedView={sharedView}
            setSharedView={setSharedView}
            hotspotMode={hotspotMode}
            clusters={hotspots.clusters}
            gridValues={trafficGrid.values}
            selectedClusterId={selectedClusterId}
            runPath={runPath}
            onSelectCluster={selectCluster}
          />
        </Suspense>
        {compareMode === 'single' && (
          <div className="left-stack">
            <div role="tablist" aria-label="Panel" className="panel-tabs">
              <button
                type="button" role="tab" aria-selected={rightTab === 'layers'}
                className="panel-tab" onClick={() => setRightTab('layers')}
              >
                Layers
              </button>
              <button
                type="button" role="tab" aria-selected={rightTab === 'hotspots'}
                className="panel-tab" onClick={() => setRightTab('hotspots')}
              >
                Hotspots
              </button>
            </div>
            {rightTab === 'layers' ? (
              <LayerPanel active={active} onToggle={toggle} counts={counts} />
            ) : (
              <Hotspots
                store={store}
                hotspots={hotspots}
                selectedCluster={selectedCluster}
                journeys={journeys}
                selectedRun={selectedRun}
                runDetail={runDetail}
                onSelectCluster={selectCluster}
                onSelectRun={setSelectedRun}
              />
            )}
          </div>
        )}
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
        {compareMode === 'side' && !comparing && (
          <div className="diff-note" role="status">Choose something to compare against, and the second map appears here.</div>
        )}
        <OrientationHint />
        {dropped.length > 0 && (
          <div className="link-note" role="status">
            <span>
              This link was made against different data.{' '}
              {dropped.join('. ')}. Everything else was restored.
            </span>
            <button type="button" className="map-control" onClick={() => setDropped([])}>
              Dismiss
            </button>
          </div>
        )}
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
          No events on {store.meta.mapConfig[filter.map ?? store.meta.dict.maps[0]]?.label ?? 'this map'}
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

const tooltipStyle = {
  background: 'var(--bg-2)', color: 'var(--text-1)',
  border: '1px solid var(--line-strong)', borderRadius: '4px',
  fontSize: '12px', fontFamily: 'var(--font-sans)', padding: '6px 8px',
}

function tooltip({ object }: { object?: unknown }) {
  const o = object as { event?: string; bot?: boolean; elapsed?: number; count?: number; rank?: number } | undefined
  // Hotspot cell: report that cell's own traffic, the number the ranking is built from.
  if (o && o.count !== undefined && o.rank !== undefined) {
    return {
      text: `Cluster ${o.rank}\n${o.count.toLocaleString()} players through this cell`,
      style: tooltipStyle,
    }
  }
  if (!o?.event) return null
  const s = eventStyle(o.event)
  const e = o.elapsed ?? 0
  const mmss = `${String(Math.floor(e / 60)).padStart(2, '0')}:${String(e % 60).padStart(2, '0')}`
  return {
    text: `${s.label}\n${o.bot ? 'Bot' : 'Human'} · ${mmss} into the match`,
    style: tooltipStyle,
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

/**
 * Full-layout skeleton, shown while the data bundle downloads.
 *
 * It reuses the real `.app` grid so the header, rail, map, timeline and stat strip land in
 * exactly the positions they will occupy once the data arrives. That is the point of a
 * skeleton over a spinner: the reader sees the shape of the tool filling in, and nothing
 * jumps when the real content replaces it. The map area carries its own status text, since
 * it is the one region that stays a placeholder longest.
 */
function AppSkeleton() {
  return (
    <div className="app app-skeleton" role="status" aria-busy="true" aria-label="Loading telemetry">
      <div className="app-header">
        <h1 className="app-title">LILA BLACK</h1>
        <span className="sk sk-pill" style={{ width: 96 }} />
        <span className="sk sk-pill" style={{ width: 132 }} />
        <span className="sk sk-pill" style={{ width: 180 }} />
      </div>
      <div className="rail sk-rail">
        {[64, 120, 220, 96].map((h, i) => (
          <div className="sk-rail-section" key={i}>
            <span className="sk sk-line" style={{ width: 90 }} />
            <span className="sk sk-block" style={{ height: h }} />
          </div>
        ))}
      </div>
      <div className="app-canvas">
        <MapAreaSkeleton />
      </div>
      <div className="timeline">
        <span className="sk sk-block" style={{ width: 28, height: 28 }} />
        <span className="sk sk-block" style={{ height: 8 }} />
      </div>
      <div className="stat-strip">
        {[60, 90, 70, 110, 80, 90].map((w, i) => (
          <span className="sk sk-line" key={i} style={{ width: w }} />
        ))}
      </div>
    </div>
  )
}

/**
 * The map area on its own, used both inside the full skeleton and as the Suspense fallback
 * while the renderer chunk loads. The two overlap in time, so in practice this rarely shows
 * on its own; when it does it says what is happening rather than spinning silently.
 */
function MapAreaSkeleton({ split = false }: { split?: boolean }) {
  const panel = (
    <div className="sk-map" role="status" aria-busy="true">
      <span className="sk-map-text">Preparing the map</span>
    </div>
  )
  return split ? <>{panel}{panel}</> : panel
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
