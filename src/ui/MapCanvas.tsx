import { useCallback, useMemo, useState } from 'react'
import { DeckGL, OrthographicView, BitmapLayer, ScatterplotLayer } from 'deck.gl'
import type { Layer } from 'deck.gl'
import {
  MAP_BOUNDS, MIN_ZOOM, MAX_ZOOM, initialViewState, minimapUrl, S,
} from '../map/project'
import type { MapConfig } from '../data/types'

/** deck.gl's OrthographicViewState is not exported cleanly; this is the shape we use. */
interface ViewState {
  target: [number, number, number]
  zoom: number
  minZoom?: number
  maxZoom?: number
  transitionDuration?: number
  transitionEasing?: (t: number) => number
}

export interface MapCanvasProps {
  mapId: string
  config: MapConfig
  /** Data layers supplied by later phases. The canvas owns the map, never the data. */
  layers?: Layer[]
}

/**
 * The map canvas.
 *
 * Renders a minimap into a fixed S x S orthographic space and hands that same space to any
 * data layers passed in, so a layer never has to know how the map is framed, panned or
 * zoomed. Everything above this component works in UV; everything below works in render
 * units; `src/map/project.ts` is the only place that converts between them.
 *
 * `flipY: false` matters. It makes render-space Y grow upward exactly as world Z does, so
 * the projection needs no flip either. Flipping in both places cancels out and looks
 * correct on a symmetric map while being wrong everywhere else, which is the worst
 * available way for this to fail.
 */
export default function MapCanvas({ mapId, config, layers = [] }: MapCanvasProps) {
  const [viewState, setViewState] = useState<ViewState>(() => initialViewState())
  const [imageError, setImageError] = useState<string | null>(null)

  // Recreated only when the map changes, not on every pan frame.
  const view = useMemo(() => new OrthographicView({ id: 'ortho', flipY: false }), [])

  const onViewStateChange = useCallback(({ viewState: next }: { viewState: ViewState }) => {
    // Panning is continuous input. It is never eased: adding a transition here puts lag
    // between the designer's hand and the map.
    setViewState({ ...next, transitionDuration: 0 })
  }, [])

  const reset = useCallback(() => {
    // Reset is an occasional action, so it is the one place a transition earns its keep.
    setViewState({ ...initialViewState(), transitionDuration: 220 })
  }, [])

  const minimap = useMemo(
    () =>
      new BitmapLayer({
        id: `minimap-${mapId}`,
        image: minimapUrl(mapId),
        bounds: MAP_BOUNDS,
        // Nearest-neighbour would alias the fine map detail when zoomed out.
        textureParameters: { minFilter: 'linear', magFilter: 'linear' },
        onError: () => setImageError(`Minimap for ${config.label} did not load.`),
      }),
    [mapId, config.label],
  )

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--bg-0)' }}>
      <DeckGL
        views={view}
        viewState={viewState}
        onViewStateChange={onViewStateChange as never}
        controller={{ dragRotate: false, doubleClickZoom: true, scrollZoom: { speed: 0.012, smooth: false } }}
        layers={[minimap, ...layers]}
        style={{ position: 'absolute', inset: 0 }}
        getCursor={({ isDragging }) => (isDragging ? 'grabbing' : 'grab')}
      />

      <ViewControls
        zoom={viewState.zoom}
        onZoom={(delta) =>
          setViewState((v) => ({
            ...v,
            zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom + delta)),
            transitionDuration: 0,
          }))
        }
        onReset={reset}
      />

      {imageError && (
        <p role="alert" style={{
          position: 'absolute', left: 'var(--space-3)', bottom: 'var(--space-3)', margin: 0,
          padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-2)',
          border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)',
          color: 'var(--ev-kill)', fontSize: 'var(--text-sm)',
        }}>
          {imageError} Run <code style={{ fontFamily: 'var(--font-mono)' }}>npm run build:maps</code> to regenerate it.
        </p>
      )}
    </div>
  )
}

function ViewControls({
  zoom, onZoom, onReset,
}: { zoom: number; onZoom: (delta: number) => void; onReset: () => void }) {
  return (
    <div
      role="group"
      aria-label="Map view"
      style={{
        position: 'absolute', top: 'var(--space-3)', right: 'var(--space-3)',
        display: 'grid', gap: 'var(--space-1)', justifyItems: 'stretch',
      }}
    >
      <ControlButton label="Zoom in" onClick={() => onZoom(0.5)} disabled={zoom >= MAX_ZOOM}>+</ControlButton>
      <ControlButton label="Zoom out" onClick={() => onZoom(-0.5)} disabled={zoom <= MIN_ZOOM}>−</ControlButton>
      <ControlButton label="Reset view" onClick={onReset} wide>Reset</ControlButton>
    </div>
  )
}

function ControlButton({
  label, onClick, disabled, wide, children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="map-control"
      style={{ minWidth: wide ? 'auto' : 28, padding: wide ? '0 var(--space-2)' : 0 }}
    >
      {children}
    </button>
  )
}

/**
 * Scaffolding for Phase 3 only.
 *
 * Registration cannot be verified by reading code or by the absence of an error: a wrongly
 * projected map still renders as a picture of a map. Plotting real position samples is the
 * only way to see whether points land on roads and inside buildings.
 *
 * Phase 4 replaces this with the real traffic, dwell, event and path layers.
 */
export function debugPointsLayer(points: [number, number][], id = 'debug-points') {
  return new ScatterplotLayer<[number, number]>({
    id,
    data: points,
    getPosition: (d) => [d[0] * S, d[1] * S],
    getRadius: 1.4,
    radiusUnits: 'pixels',
    radiusMinPixels: 1,
    getFillColor: [86, 180, 233, 190], // --actor-human
    pickable: false,
  })
}
