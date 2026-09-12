/**
 * MapStage.tsx — the deck.gl half of the workspace, loaded on demand.
 *
 * Everything that pulls deck.gl in — MapCanvas and the layer factories — is reached only
 * through this module, so it is code-split out of the initial bundle. App renders it behind a
 * Suspense boundary and warms the import at startup, in parallel with the data fetch, so the
 * renderer chunk is usually already resident by the time the data arrives.
 *
 * The layer ARRAYS are memoised on their inputs; the Layer instances inside are built fresh on
 * every render. deck.gl layers are single-use descriptors: caching an instance makes it stop
 * drawing silently. The expensive inputs (baked textures, positioned geometry) are what the
 * memo protects, never the layers themselves.
 */

import { useMemo } from 'react'
import type { Layer } from 'deck.gl'
import MapCanvas from './MapCanvas'
import type { LayerId } from './LayerPanel'
import type { Store } from '../data/store'
import { filterRows } from '../data/query'
import type { Filter, MapConfig } from '../data/types'
import { uvToWorldSpace, type UVBounds } from '../map/project'
import {
  heatPoints, trafficImage, collectEvents, type EventPoint, type PathSegment,
} from '../map/layers'
import type { Cluster } from '../map/hotspots'
import {
  heatLayer, deadSpaceLayer, eventLayer, pathLayer, actorLayer, diffLayer,
  hotspotCellsLayer, hotspotLabelLayer, runPathLayer, type HotCell, type HotLabel,
} from '../map/deckLayers'

const LOOT_EVENTS = new Set(['Loot'])
const KILL_EVENTS = new Set(['BotKill', 'Kill'])
const DEATH_EVENTS = new Set(['BotKilled', 'Killed', 'KilledByStorm'])

/** deck.gl view state, mirrored here so two canvases can share one in side-by-side mode. */
export interface SharedView {
  target: [number, number, number]
  zoom: number
  minZoom?: number
  maxZoom?: number
  transitionDuration?: number
}

export interface MapStageProps {
  // ── Side A ────────────────────────────────────────────────────────────────
  mapId: string
  config: MapConfig
  focus: UVBounds
  active: Set<LayerId>
  trafficImg: HTMLCanvasElement | null
  dwellImg: HTMLCanvasElement | null
  coverage: { dead: number[]; size: number } | null
  paths: PathSegment[]
  actors: { position: [number, number]; bot: boolean }[]
  loot: EventPoint[]
  kills: EventPoint[]
  deaths: EventPoint[]
  diffCanvas: HTMLCanvasElement | null
  getTooltip: (info: { object?: unknown }) => { text: string; style?: Record<string, string> } | null
  // ── Comparison ──────────────────────────────────────────────────────────────
  compareMode: 'single' | 'diff' | 'side'
  store: Store
  rowsB: Uint32Array | null
  filterB: Filter | null
  eventsFilter: string[] | undefined
  sharedView: SharedView | undefined
  setSharedView: (v: SharedView) => void
  // ── Hotspots ──────────────────────────────────────────────────────────────
  hotspotMode: boolean
  clusters: Cluster[]
  gridValues: Float32Array | null
  selectedClusterId: number | null
  runPath: PathSegment[] | null
  onSelectCluster: (clusterId: number) => void
}

/** Intersect the user's event filter with the events a particular layer needs. */
function intersectEvents(selected: string[] | undefined, needed: string[]): string[] {
  if (!selected) return needed
  return needed.filter((e) => selected.includes(e))
}

export default function MapStage(props: MapStageProps) {
  const {
    mapId, config, focus, active, trafficImg, dwellImg, coverage, paths, actors,
    loot, kills, deaths, diffCanvas, getTooltip, compareMode, store, rowsB, filterB,
    eventsFilter, sharedView, setSharedView,
    hotspotMode, clusters, gridValues, selectedClusterId, runPath, onSelectCluster,
  } = props

  // Cell squares and rank labels for the hotspot overlay. Built from the clusters and the raw
  // grid so a hovered cell reports its own count; declared above the layer memo that reads it.
  const hotOverlay = useMemo(() => {
    if (!hotspotMode || !gridValues) return { cells: [] as HotCell[], labels: [] as HotLabel[] }
    const cells: HotCell[] = []
    const labels: HotLabel[] = []
    for (const c of clusters) {
      const selected = c.id === selectedClusterId
      for (const cell of c.cells) cells.push({ cell, clusterId: c.id, rank: c.rank, count: gridValues[cell], selected })
      labels.push({ position: uvToWorldSpace(c.centroid[0], c.centroid[1]), text: String(c.rank), selected })
    }
    return { cells, labels }
  }, [hotspotMode, clusters, gridValues, selectedClusterId])

  // Side A. Diff mode draws the delta and nothing else: overlaying single-side layers on an
  // A-versus-B delta mixes two incompatible pictures in one frame.
  const layers = useMemo(() => {
    const out: Layer[] = []
    if (diffCanvas) { out.push(diffLayer(diffCanvas)); return out }
    if (trafficImg) out.push(heatLayer('traffic', trafficImg))
    if (dwellImg) out.push(heatLayer('dwell', dwellImg))
    if (active.has('dead') && coverage) out.push(deadSpaceLayer(coverage.dead, coverage.size))
    if (active.has('paths')) out.push(pathLayer(paths))
    if (active.has('actors')) out.push(actorLayer(actors))
    if (active.has('loot')) out.push(eventLayer('loot', loot, 9))
    if (active.has('kills')) out.push(eventLayer('kills', kills, 12))
    if (active.has('deaths')) out.push(eventLayer('deaths', deaths, 13))
    // Hotspot overlay on top of the heat, then the selected run's path loudest of all.
    if (hotspotMode && hotOverlay.cells.length) {
      out.push(hotspotCellsLayer(hotOverlay.cells, onSelectCluster))
      out.push(hotspotLabelLayer(hotOverlay.labels))
    }
    if (hotspotMode && runPath && runPath.length) out.push(runPathLayer(runPath))
    return out
  }, [active, trafficImg, dwellImg, coverage, paths, actors, loot, kills, deaths, diffCanvas,
      hotspotMode, hotOverlay, runPath, onSelectCluster])

  const layersB = useMemo(() => {
    if (compareMode !== 'side' || !rowsB || !filterB) return []
    const posB = filterRows(store, { ...filterB, events: intersectEvents(eventsFilter, ['Position', 'BotPosition']) })
    const bConfig = store.meta.mapConfig[filterB.map ?? mapId]
    const out: Layer[] = []
    if (active.has('traffic')) out.push(heatLayer('traffic-b', trafficImage(heatPoints(store, posB, bConfig, 'traffic'))))
    if (active.has('loot')) out.push(eventLayer('loot-b', collectEvents(store, rowsB, bConfig, LOOT_EVENTS), 9))
    if (active.has('kills')) out.push(eventLayer('kills-b', collectEvents(store, rowsB, bConfig, KILL_EVENTS), 12))
    if (active.has('deaths')) out.push(eventLayer('deaths-b', collectEvents(store, rowsB, bConfig, DEATH_EVENTS), 13))
    return out
  }, [compareMode, store, rowsB, filterB, active, eventsFilter, mapId])

  const side = compareMode === 'side'

  return (
    <>
      <MapCanvas
        mapId={mapId}
        config={config}
        layers={layers}
        focus={focus}
        getTooltip={getTooltip}
        viewState={side ? sharedView : undefined}
        onViewState={side ? setSharedView : undefined}
      />
      {side && filterB && (
        <MapCanvas
          mapId={filterB.map ?? mapId}
          config={store.meta.mapConfig[filterB.map ?? mapId]}
          layers={layersB}
          focus={focus}
          viewState={sharedView}
          onViewState={setSharedView}
        />
      )}
    </>
  )
}
