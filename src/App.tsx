import { useEffect, useMemo, useRef, useState } from 'react'
import { loadBundle } from './data/loader'
import { Store } from './data/store'
import { filterRows } from './data/query'
import { worldToUV } from './map/project'
import MapCanvas, { debugPointsLayer } from './ui/MapCanvas'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; store: Store }

/**
 * Phase 3 shell.
 *
 * Deliberately minimal: a map switcher and the canvas, enough to inspect registration on
 * all three maps. The filter rail, layer panel, timeline and context panel arrive in later
 * phases and will replace this layout entirely.
 */
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

function Workspace({ store }: { store: Store }) {
  const maps = store.meta.dict.maps
  const [mapId, setMapId] = useState(maps[0])
  const [showPoints, setShowPoints] = useState(true)
  const config = store.meta.mapConfig[mapId]

  /**
   * Registration scaffolding for Phase 3, replaced by the real layers in Phase 4.
   *
   * A wrongly projected map still renders as a picture of a map, so neither a clean
   * compile nor an absent error proves anything. Plotting real position samples is the
   * only way to see whether points land on roads and inside buildings.
   *
   * Sampled rather than complete: the point is to check placement, not to draw a heatmap.
   */
  const points = useMemo<[number, number][]>(() => {
    const rows = filterRows(store, { map: mapId, events: ['Position', 'BotPosition'] })
    const stride = Math.max(1, Math.ceil(rows.length / 12000))
    const out: [number, number][] = []
    for (let i = 0; i < rows.length; i += stride) {
      const r = rows[i]
      const { u, v } = worldToUV(store.cols.x[r], store.cols.z[r], config)
      out.push([u, v])
    }
    return out
  }, [store, mapId, config])

  const layers = showPoints ? [debugPointsLayer(points)] : []

  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', height: '100dvh' }}>
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

        <MapSwitcher maps={maps} value={mapId} onChange={setMapId} labelFor={(id) => store.meta.mapConfig[id].label} />

        <label style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          marginLeft: 'auto', color: 'var(--text-2)', fontSize: 'var(--text-sm)', cursor: 'pointer',
        }}>
          <input
            type="checkbox"
            checked={showPoints}
            onChange={(e) => setShowPoints(e.target.checked)}
          />
          Position samples
          <span className="num" style={{ color: 'var(--text-3)' }}>
            {points.length.toLocaleString()}
          </span>
        </label>
      </header>

      <MapCanvas mapId={mapId} config={config} layers={layers} />
    </div>
  )
}

/**
 * Map switcher as a real radiogroup: arrow keys move between maps and only the selected
 * tab is a tab stop, which is how a native radio group behaves and what a keyboard user
 * expects. A row of plain buttons would technically work and feel wrong.
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
