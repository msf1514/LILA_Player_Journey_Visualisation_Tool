import { useEffect, useMemo, useRef, useState } from 'react'
import { loadBundle, maskReader } from './data/loader'
import { Store } from './data/store'
import { filterRows, aggregate, deadSpace } from './data/query'
import { worldToUV, uvToWorldSpace, padBounds } from './map/project'
import type { UVBounds } from './map/project'
import {
  GRID_SIZE, heatPoints, trafficImage, dwellImage, heatLayer, deadSpaceLayer, collectEvents, eventLayer,
  buildPaths, pathLayer, actorLayer, eventStyle,
} from './map/layers'
import MapCanvas from './ui/MapCanvas'
import LayerPanel from './ui/LayerPanel'
import type { LayerId } from './ui/LayerPanel'

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

const LOOT_EVENTS = new Set(['Loot'])
const KILL_EVENTS = new Set(['BotKill', 'Kill'])
const DEATH_EVENTS = new Set(['BotKilled', 'Killed', 'KilledByStorm'])

function Workspace({ store }: { store: Store }) {
  const maps = store.meta.dict.maps
  const [mapId, setMapId] = useState(maps[0])
  const [active, setActive] = useState<Set<LayerId>>(() => new Set<LayerId>(['traffic', 'loot']))
  const config = store.meta.mapConfig[mapId]

  const toggle = (id: LayerId) =>
    setActive((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  /** Every row on the current map. Filters arrive in Phase 5. */
  const rows = useMemo(() => filterRows(store, { map: mapId }), [store, mapId])

  const positionRows = useMemo(
    () => filterRows(store, { map: mapId, events: ['Position', 'BotPosition'] }),
    [store, mapId],
  )

  /**
   * Traffic and dwell are aggregated separately, never derived from one another.
   * Traffic counts each actor once per cell; dwell weights each sample by the time it
   * represents. Same rows, different questions, genuinely different maps.
   */
  const trafficPoints = useMemo(
    () => heatPoints(store, positionRows, config, 'traffic'),
    [store, positionRows, config],
  )
  const dwellPoints = useMemo(
    () => heatPoints(store, positionRows, config, 'dwell'),
    [store, positionRows, config],
  )

  /** The same traffic measure as a grid, used for coverage and dead space. */
  const trafficGrid = useMemo(
    () => aggregate(store, positionRows, GRID_SIZE, 'traffic'),
    [store, positionRows],
  )

  /** Coverage is measured against playable land, and is only meaningful with its grid size. */
  const coverage = useMemo(() => {
    const mask = store.meta.masks?.[mapId]
    if (!mask) return null
    return deadSpace(trafficGrid, maskReader(mask.bits, mask.size), mask.size)
  }, [store, mapId, trafficGrid])

  const loot = useMemo(() => collectEvents(store, rows, config, LOOT_EVENTS), [store, rows, config])
  const kills = useMemo(() => collectEvents(store, rows, config, KILL_EVENTS), [store, rows, config])
  const deaths = useMemo(() => collectEvents(store, rows, config, DEATH_EVENTS), [store, rows, config])

  const mapIdx = maps.indexOf(mapId)
  const paths = useMemo(() => buildPaths(store, config, mapIdx), [store, config, mapIdx])

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

  /** Frame the region this map's data occupies, not the mostly-empty image square. */
  const focus = useMemo<UVBounds>(() => {
    let uMin = 1, vMin = 1, uMax = 0, vMax = 0
    for (const r of rows) {
      const { u, v } = worldToUV(store.cols.x[r], store.cols.z[r], config)
      if (u < uMin) uMin = u
      if (u > uMax) uMax = u
      if (v < vMin) vMin = v
      if (v > vMax) vMax = v
    }
    return uMax > uMin ? padBounds([uMin, vMin, uMax, vMax], 0.06) : [0, 0, 1, 1]
  }, [store, rows, config])

  /**
   * Cache the heat IMAGES, not the layers.
   *
   * Rasterising the heat field is the expensive step and depends only on the data, so it is
   * memoised. The Layer objects are rebuilt every render on purpose: deck.gl layers are
   * single-use descriptors, and reusing an instance breaks the layer lifecycle so it stops
   * drawing with no error at all. Constructing them is cheap.
   */
  const trafficImg = useMemo(() => trafficImage(trafficPoints), [trafficPoints])
  const dwellImg = useMemo(() => dwellImage(dwellPoints), [dwellPoints])

  // Draw order matters: heat sits under dead space, under paths, under discrete markers.
  // A loot pickup must never disappear beneath a heat blob.
  const layers = useMemo(() => {
    const out = []
    if (active.has('traffic')) out.push(heatLayer('traffic', trafficImg))
    if (active.has('dwell')) out.push(heatLayer('dwell', dwellImg))
    if (active.has('dead') && coverage) out.push(deadSpaceLayer(coverage.dead, coverage.size))
    if (active.has('paths')) out.push(pathLayer(paths))
    if (active.has('actors')) out.push(actorLayer(actors))
    if (active.has('loot')) out.push(eventLayer('loot', loot, 9))
    if (active.has('kills')) out.push(eventLayer('kills', kills, 12))
    if (active.has('deaths')) out.push(eventLayer('deaths', deaths, 13))
    return out
  }, [active, trafficImg, dwellImg, coverage, paths, actors, loot, kills, deaths])

  const counts: Partial<Record<LayerId, number>> = {
    loot: loot.length,
    kills: kills.length,
    deaths: deaths.length,
    paths: paths.length,
    actors: actors.length,
    dead: coverage?.dead.length,
  }

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr auto', height: '100dvh' }}>
      <header style={{
        display: 'flex', alignItems: 'center', gap: 'var(--space-4)',
        padding: '0 var(--space-4)', height: 52,
        borderBottom: '1px solid var(--line)', background: 'var(--bg-1)',
      }}>
        <h1 style={{
          margin: 0, fontSize: 'var(--text-md)', fontWeight: 600,
          letterSpacing: 'var(--tracking-tight)', whiteSpace: 'nowrap',
        }}>
          LILA BLACK
        </h1>
        <MapSwitcher
          maps={maps}
          value={mapId}
          onChange={setMapId}
          labelFor={(id) => store.meta.mapConfig[id].label}
        />
      </header>

      <div style={{ position: 'relative', minHeight: 0 }}>
        <MapCanvas
          mapId={mapId}
          config={config}
          layers={layers}
          focus={focus}
          getTooltip={tooltip}
        />
        <LayerPanel active={active} onToggle={toggle} counts={counts} />
      </div>

      <StatStrip
        mapLabel={config.label}
        rows={rows.length}
        loot={loot.length}
        kills={kills.length}
        deaths={deaths.length}
        paths={paths.length}
        coverage={coverage}
      />
    </div>
  )
}

/** deck.gl tooltip. Returns real counts, never a guess. */
function tooltip({ object }: { object?: unknown }) {
  const o = object as { event?: string; bot?: boolean; elapsed?: number } | undefined
  if (!o?.event) return null
  const s = eventStyle(o.event)
  const mmss = `${String(Math.floor((o.elapsed ?? 0) / 60)).padStart(2, '0')}:${String((o.elapsed ?? 0) % 60).padStart(2, '0')}`
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
  mapLabel, rows, loot, kills, deaths, paths, coverage,
}: {
  mapLabel: string
  rows: number
  loot: number
  kills: number
  deaths: number
  paths: number
  coverage: { coverage: number; playable: number; visited: number; size: number } | null
}) {
  return (
    <div className="stat-strip">
      <span><b>{mapLabel}</b></span>
      <span>rows <b className="num">{rows.toLocaleString()}</b></span>
      <span>loot <b className="num">{loot.toLocaleString()}</b></span>
      {/* "vs bots" is not decoration. 2,410 of these kills are against bots and 3 are not. */}
      <span>kills vs bots <b className="num">{kills.toLocaleString()}</b></span>
      <span>deaths <b className="num">{deaths.toLocaleString()}</b></span>
      <span>journeys <b className="num">{paths.toLocaleString()}</b></span>
      {coverage && (
        <span>
          coverage <b className="num">{Math.round(coverage.coverage * 100)}%</b>{' '}
          of playable land, measured on a{' '}
          <b className="num">{coverage.size}×{coverage.size}</b> grid
        </span>
      )}
    </div>
  )
}

/**
 * Map switcher as a real radiogroup: arrow keys move between maps and only the selected tab
 * is a tab stop, which is how a native radio group behaves and what a keyboard user expects.
 */
function MapSwitcher({
  maps, value, onChange, labelFor,
}: {
  maps: string[]
  value: string
  onChange: (id: string) => void
  labelFor: (id: string) => string
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const move = (delta: number) => {
    const next = (maps.indexOf(value) + delta + maps.length) % maps.length
    onChange(maps[next])
    refs.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-label="Map" style={{ display: 'flex', gap: 2 }}>
      {maps.map((id, i) => (
        <button
          key={id}
          ref={(el) => { refs.current[i] = el }}
          type="button"
          role="radio"
          aria-checked={id === value}
          tabIndex={id === value ? 0 : -1}
          className="map-tab"
          onClick={() => onChange(id)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); move(1) }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); move(-1) }
          }}
        >
          {labelFor(id)}
        </button>
      ))}
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
