import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DeckGL, OrthographicView, BitmapLayer } from 'deck.gl'
import type { Layer } from 'deck.gl'
import { MAP_BOUNDS, FULL_BOUNDS, initialViewState, minimapUrl } from '../map/project'
import type { UVBounds } from '../map/project'

/**
 * SplitCanvas — side-by-side comparison in ONE WebGL context.
 *
 * Two separate <DeckGL> canvases meant two WebGL contexts fighting the compositor and each
 * running its own hover-picking readback; on real hardware that showed up as flicker and a grey
 * rectangle whenever a filter or the timeline changed and the pointer was over a map. A single
 * Deck with two orthographic viewports removes the second context entirely: one render loop, one
 * pick pass, and a single shared view so panning or zooming either half moves both.
 *
 * Layers are tagged to a side by id (side B's ids all end in `-b`); a layerFilter draws each
 * side's layers only in its own viewport.
 */

interface ViewState {
  target: [number, number, number]
  zoom: number
  minZoom?: number
  maxZoom?: number
  transitionDuration?: number
}

export interface SplitCanvasProps {
  leftMapId: string
  leftLabel: string
  leftLayers: Layer[]
  rightMapId: string
  rightLabel: string
  rightLayers: Layer[]
  focus?: UVBounds
  getTooltip?: (info: { object?: unknown }) => { text: string; style?: Record<string, string> } | null
  onZoom?: (zoomBucket: number) => void
}

export default function SplitCanvas({
  leftMapId, leftLabel, leftLayers, rightMapId, rightLabel, rightLayers,
  focus = FULL_BOUNDS, getTooltip, onZoom,
}: SplitCanvasProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [viewState, setViewState] = useState<ViewState>(() => initialViewState())
  const [imageError, setImageError] = useState<string | null>(null)
  const touched = useRef(false)
  const focusKey = focus.join(',')

  // Each viewport is half the width, so the fit is computed from half the host width.
  useLayoutEffect(() => {
    const el = hostRef.current
    if (!el) return
    const apply = (width: number, height: number) => {
      setSize({ width, height })
      const framed = initialViewState(width / 2, height, focus)
      setViewState((v) =>
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

  // Two viewports, left and right halves, recreated only when necessary.
  const views = useMemo(() => [
    new OrthographicView({ id: 'left', x: 0, width: '50%', flipY: false }),
    new OrthographicView({ id: 'right', x: '50%', width: '50%', flipY: false }),
  ], [])

  // One shared view drives both viewports, so they stay locked together.
  const controlledViewState = useMemo(() => ({ left: viewState, right: viewState }), [viewState])

  const onViewStateChange = useCallback(({ viewState: next }: { viewState: ViewState }) => {
    touched.current = true
    setViewState({ ...next, transitionDuration: 0 })
  }, [])

  // Report the zoom bucket for the level-of-detail switch, as MapCanvas does.
  const bucketRef = useRef<number | null>(null)
  useEffect(() => {
    const bucket = Math.round((viewState.zoom ?? 0) * 2) / 2
    if (bucket !== bucketRef.current) { bucketRef.current = bucket; onZoom?.(bucket) }
  }, [viewState.zoom, onZoom])

  const reset = useCallback(() => {
    touched.current = false
    setViewState({ ...initialViewState(size.width / 2, size.height, focus), transitionDuration: 220 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.width, size.height, focusKey])

  // R re-frames both maps, matching the reset button. Ignored while typing, and when a modifier
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

  const zoomBy = (delta: number) => {
    touched.current = true
    const { minZoom, maxZoom } = initialViewState(size.width / 2, size.height, focus)
    setViewState((v) => ({
      ...v,
      zoom: Math.min(maxZoom, Math.max(minZoom, v.zoom + delta)),
      transitionDuration: 0,
    }))
  }

  const leftMinimap = useMemo(() => new BitmapLayer({
    id: `minimap-${leftMapId}`, image: minimapUrl(leftMapId), bounds: MAP_BOUNDS,
    textureParameters: { minFilter: 'linear', magFilter: 'linear' },
    onError: () => setImageError(`Minimap for ${leftLabel} did not load.`),
  }), [leftMapId, leftLabel])

  const rightMinimap = useMemo(() => new BitmapLayer({
    id: `minimap-b-${rightMapId}`, image: minimapUrl(rightMapId), bounds: MAP_BOUNDS,
    textureParameters: { minFilter: 'linear', magFilter: 'linear' },
    onError: () => setImageError(`Minimap for ${rightLabel} did not load.`),
  }), [rightMapId, rightLabel])

  // Which layers belong to the right viewport. Side B ids all end in `-b`; the right minimap is
  // tagged explicitly. Everything else is left. Built fresh so no Layer instance is memoised.
  const rightIds = new Set<string>([rightMinimap.id, ...rightLayers.map((l) => l.id as string)])
  const layers = [leftMinimap, rightMinimap, ...leftLayers, ...rightLayers]
  const layerFilter = useCallback(
    ({ layer, viewport }: { layer: { id: string }; viewport: { id: string } }) =>
      viewport.id === 'right' ? rightIds.has(layer.id) : !rightIds.has(layer.id),
    // rightIds is rebuilt each render from the current layers; identity churn is fine for a filter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rightLayers, rightMinimap.id],
  )

  return (
    <div ref={hostRef} style={{ position: 'relative', width: '100%', height: '100%', background: 'var(--bg-0)' }}>
      <DeckGL
        views={views}
        viewState={controlledViewState as never}
        onViewStateChange={onViewStateChange as never}
        controller={{ dragRotate: false, doubleClickZoom: true, scrollZoom: { speed: 0.012, smooth: false } } as never}
        layers={layers}
        layerFilter={layerFilter as never}
        style={{ position: 'absolute', inset: 0 } as never}
        getCursor={({ isDragging }) => (isDragging ? 'grabbing' : 'grab')}
        getTooltip={getTooltip as never}
      />

      {/* Divider between the two halves. */}
      <div aria-hidden="true" style={{
        position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1,
        transform: 'translateX(-0.5px)', background: 'var(--line)', pointerEvents: 'none',
      }} />

      <div
        role="group"
        aria-label="Map view"
        style={{ position: 'absolute', top: 'var(--space-3)', right: 'var(--space-3)', display: 'grid', gap: 'var(--space-1)' }}
      >
        <button type="button" aria-label="Zoom in" title="Zoom in" className="map-control"
          style={{ minWidth: 28, padding: 0 }} onClick={() => zoomBy(0.5)}
          disabled={viewState.zoom >= (viewState.maxZoom ?? Infinity)}>+</button>
        <button type="button" aria-label="Zoom out" title="Zoom out" className="map-control"
          style={{ minWidth: 28, padding: 0 }} onClick={() => zoomBy(-0.5)}
          disabled={viewState.zoom <= (viewState.minZoom ?? -Infinity)}>−</button>
        <button type="button" aria-label="Reset view" title="Reset view"
          data-tip="Re-frame both maps to fit (or press R)." className="map-control"
          style={{ padding: '0 var(--space-2)' }} onClick={reset}>Reset</button>
      </div>

      {imageError && (
        <p role="alert" style={{
          position: 'absolute', left: 'var(--space-3)', bottom: 'var(--space-3)', margin: 0,
          padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-2)',
          border: '1px solid var(--line-strong)', borderRadius: 'var(--radius)',
          color: 'var(--ev-kill)', fontSize: 'var(--text-sm)',
        }}>{imageError}</p>
      )}
    </div>
  )
}
