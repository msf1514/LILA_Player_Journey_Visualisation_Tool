import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DeckGL, OrthographicView, BitmapLayer } from 'deck.gl'
import type { Layer } from 'deck.gl'
import { MAP_BOUNDS, FULL_BOUNDS, initialViewState, minimapUrl } from '../map/project'
import type { UVBounds } from '../map/project'
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
  /**
   * UV rectangle to frame on load and on reset. Defaults to the whole map square, but the
   * art is mostly empty margin, so callers should pass the region the data occupies.
   */
  focus?: UVBounds
  /** deck.gl tooltip callback for pickable layers. */
  getTooltip?: (info: { object?: unknown }) => { text: string; style?: Record<string, string> } | null
  /**
   * Externally owned view state. Supplying both of these makes the canvas controlled, which
   * is what links two canvases in side-by-side mode: panning one must pan the other, or the
   * two maps cannot be compared at all.
   */
  viewState?: ViewState
  onViewState?: (v: ViewState) => void
  /**
   * Reports the current zoom, bucketed to reduce churn, so callers can switch marker layers
   * between clustered and individual detail. Fires only when the bucket changes, never per frame.
   */
  onZoom?: (zoomBucket: number) => void
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
export default function MapCanvas({
  mapId, config, layers = [], focus = FULL_BOUNDS, getTooltip,
  viewState: externalView, onViewState, onZoom,
}: MapCanvasProps) {
  // Side-by-side supplies a shared-view setter. Until the first interaction the shared view is
  // empty and each canvas frames itself; once ANY interaction (drag, scroll, zoom button, reset)
  // writes the shared view, both canvases render it and stay linked. Every control writes the
  // shared view when it exists, so the two maps can never drift apart the way they did when only
  // dragging synced them.
  const shared = onViewState !== undefined
  const linked = externalView !== undefined && shared
  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [viewState, setViewState] = useState<ViewState>(() => initialViewState())
  const [imageError, setImageError] = useState<string | null>(null)
  // The view currently on screen: the shared one once it exists, otherwise this canvas's own.
  const activeView = linked ? externalView : viewState
  // A view change goes to the shared view in side-by-side, or to local state otherwise.
  const commit = (v: ViewState) => { if (shared && onViewState) onViewState(v); else setViewState(v) }
  // Whether the user has moved the view. Until they do, a resize should re-fit; after they
  // have panned or zoomed deliberately, a resize must not yank their view back.
  const touched = useRef(false)

  // Measure the host element and keep the framing in step with it. useLayoutEffect so the
  // first paint already has the right zoom rather than flashing an unfitted map.
  const focusKey = focus.join(',')

  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const apply = (width: number, height: number) => {
      setSize({ width, height })
      const framed = initialViewState(width, height, focus)
      setViewState((v) =>
        // Keep a deliberate pan/zoom through a resize, but always refresh the limits so
        // they stay anchored to the new fit. Re-frame only if the user has not moved.
        touched.current
          ? { ...v, minZoom: framed.minZoom, maxZoom: framed.maxZoom }
          : { ...framed, transitionDuration: 0 },
      )
    }
    const r = el.getBoundingClientRect()
    apply(r.width, r.height)
    const ro = new ResizeObserver(([entry]) => apply(entry.contentRect.width, entry.contentRect.height))
    ro.observe(el)
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusKey])

  // Switching map re-frames, because each map's data occupies a different region.
  useLayoutEffect(() => { touched.current = false }, [mapId])

  // Recreated only when the map changes, not on every pan frame.
  const view = useMemo(() => new OrthographicView({ id: 'ortho', flipY: false }), [])

  // Report the zoom, bucketed to half steps, so marker layers can switch between clustered and
  // individual detail. Bucketing means this fires a handful of times across a full zoom, never
  // on every pan frame.
  const renderZoom = activeView?.zoom ?? 0
  const bucketRef = useRef<number | null>(null)
  useEffect(() => {
    const bucket = Math.round(renderZoom * 2) / 2
    if (bucket !== bucketRef.current) { bucketRef.current = bucket; onZoom?.(bucket) }
  }, [renderZoom, onZoom])

  const onViewStateChange = useCallback((
    { viewState: next, interactionState }: {
      viewState: ViewState
      interactionState?: { isDragging?: boolean; isPanning?: boolean; isZooming?: boolean; isRotating?: boolean }
    },
  ) => {
    // Panning is continuous input. It is never eased: adding a transition here puts lag
    // between the designer's hand and the map.
    touched.current = true
    const v = { ...next, transitionDuration: 0 }
    if (shared) {
      // Only the canvas the user is actively manipulating drives the shared view. deck.gl also
      // fires this callback for programmatic echoes and for its own zoom-limit clamps, which
      // carry no active interaction; feeding those back makes two linked maps oscillate against
      // each other's limits. So propagate user-driven changes only.
      const s = interactionState
      if (s && (s.isDragging || s.isPanning || s.isZooming || s.isRotating)) onViewState!(v)
    } else {
      setViewState(v)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shared, onViewState])

  const reset = useCallback(() => {
    // Reset is an occasional action, so it is the one place a transition earns its keep.
    touched.current = false
    commit({ ...initialViewState(size.width, size.height, focus), transitionDuration: 220 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, focusKey, shared, onViewState])

  // R re-frames the map, matching the reset button. Ignored while typing, and when a modifier
  // is held so Ctrl or Cmd R still reloads the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'r' && e.key !== 'R') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (el instanceof HTMLInputElement && el.type !== 'range') return
      if (el instanceof HTMLTextAreaElement) return
      e.preventDefault()
      reset()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [reset])

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
    <div ref={hostRef} style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--bg-0)' }}>
      <DeckGL
        views={view}
        viewState={activeView}
        onViewStateChange={onViewStateChange as never}
        controller={{ dragRotate: false, doubleClickZoom: true, scrollZoom: { speed: 0.012, smooth: false } }}
        layers={[minimap, ...layers]}
        style={{ position: 'absolute', inset: 0 }}
        getCursor={({ isDragging }) => (isDragging ? 'grabbing' : 'grab')}
        getTooltip={getTooltip as never}
      />

      <ViewControls
        zoom={activeView.zoom}
        limits={{ minZoom: activeView.minZoom ?? -Infinity, maxZoom: activeView.maxZoom ?? Infinity }}
        onZoom={(delta) => {
          touched.current = true
          const { minZoom, maxZoom } = initialViewState(size.width, size.height, focus)
          // Zoom buttons drive the shared view in side-by-side, so BOTH maps zoom together.
          commit({
            ...activeView,
            zoom: Math.min(maxZoom, Math.max(minZoom, activeView.zoom + delta)),
            transitionDuration: 0,
          })
        }}
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
  zoom, limits, onZoom, onReset,
}: {
  zoom: number
  limits: { minZoom: number; maxZoom: number }
  onZoom: (delta: number) => void
  onReset: () => void
}) {
  return (
    <div
      role="group"
      aria-label="Map view"
      style={{
        position: 'absolute', top: 'var(--space-3)', right: 'var(--space-3)',
        display: 'grid', gap: 'var(--space-1)', justifyItems: 'stretch',
      }}
    >
      <ControlButton label="Zoom in" onClick={() => onZoom(0.5)} disabled={zoom >= limits.maxZoom}>+</ControlButton>
      <ControlButton label="Zoom out" onClick={() => onZoom(-0.5)} disabled={zoom <= limits.minZoom}>−</ControlButton>
      <ControlButton label="Reset view" tip="Re-frame the map to fit (or press R)." onClick={onReset} wide>Reset</ControlButton>
    </div>
  )
}

function ControlButton({
  label, tip, onClick, disabled, wide, children,
}: {
  label: string
  tip?: string
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
      data-tip={tip}
      onClick={onClick}
      disabled={disabled}
      className="map-control"
      style={{ minWidth: wide ? 'auto' : 28, padding: wide ? '0 var(--space-2)' : 0 }}
    >
      {children}
    </button>
  )
}
