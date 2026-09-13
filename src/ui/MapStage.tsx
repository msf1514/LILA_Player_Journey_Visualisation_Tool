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
import SplitCanvas from './SplitCanvas'
import type { LayerId } from './LayerPanel'
import type { Store } from '../data/store'
import { filterRows, aggregate, deadSpace } from '../data/query'
import { maskReader } from '../data/loader'
import type { Filter, MapConfig } from '../data/types'
import { worldToUV, uvToWorldSpace, type UVBounds } from '../map/project'
import {
  GRID_SIZE, heatPoints, trafficImage, dwellImage, killImage, deathImage, eventHeatPoints,
  collectEvents, buildPaths, clusterEvents,
  type EventPoint, type PathSegment,
} from '../map/layers'
import type { Cluster } from '../map/hotspots'
import {
  heatLayer, deadSpaceLayer, eventLayer, eventClusterLayer, pathLayer,
  actorLayer, diffLayer, hotspotCellsLayer, hotspotLabelLayer, runPathLayer,
  type HotCell, type HotLabel,
} from '../map/deckLayers'

/**
 * Below this zoom, markers cluster; at or above it, individual markers draw. Fit is near -0.5,
 * so the map opens clustered and reveals detail a step or so in.
 */
const CLUSTER_ZOOM = 1
/**
 * Target on-screen spacing of a cluster, in pixels; converted to render units per zoom bucket.
 * Large on purpose: the point of the zoomed-out view is a few readable blobs, not a numbered
 * mark in every cell. Count is encoded by size and shown exactly on hover.
 */
const CLUSTER_PX = 56

type MarkerSet = { loot: EventPoint[]; kills: EventPoint[]; deaths: EventPoint[] }

/**
 * Build the discrete-event marker layers, clustered when zoomed out and individual when zoomed
 * in. Only these layers get LOD; heat, hotspots, paths and actors are untouched.
 */
function markerLayers(prefix: string, m: MarkerSet, active: Set<LayerId>, clustered: boolean, cellWorld: number): Layer[] {
  const out: Layer[] = []
  const kinds: [LayerId, EventPoint[], number][] = [
    ['loot', m.loot, 9], ['kills', m.kills, 12], ['deaths', m.deaths, 13],
  ]
  for (const [id, pts, px] of kinds) {
    if (!active.has(id)) continue
    if (clustered) {
      out.push(eventClusterLayer(`${prefix}${id}`, clusterEvents(pts, cellWorld), px))
    } else {
      out.push(eventLayer(`${prefix}${id}`, pts, px))
    }
  }
  return out
}

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
  killHeatImg: HTMLCanvasElement | null
  deathHeatImg: HTMLCanvasElement | null
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
  // ── Hotspots ──────────────────────────────────────────────────────────────
  hotspotMode: boolean
  clusters: Cluster[]
  gridValues: Float32Array | null
  selectedClusterId: number | null
  runPath: PathSegment[] | null
  onSelectCluster: (clusterId: number) => void
  // ── Level of detail ─────────────────────────────────────────────────────────
  zoomBucket: number
  onZoom: (bucket: number) => void
}

/** Intersect the user's event filter with the events a particular layer needs. */
function intersectEvents(selected: string[] | undefined, needed: string[]): string[] {
  if (!selected) return needed
  return needed.filter((e) => selected.includes(e))
}

export default function MapStage(props: MapStageProps) {
  const {
    mapId, config, focus, active, trafficImg, dwellImg, killHeatImg, deathHeatImg,
    coverage, paths, actors,
    loot, kills, deaths, diffCanvas, getTooltip, compareMode, store, rowsB, filterB,
    eventsFilter,
    hotspotMode, clusters, gridValues, selectedClusterId, runPath, onSelectCluster,
    zoomBucket, onZoom,
  } = props

  // Cluster markers below the threshold. Cell size is derived from the zoom bucket so a cluster
  // holds a roughly constant screen area; it changes only when the bucket changes, so the marker
  // layers rebuild a handful of times across a full zoom, never per pan frame.
  const clustered = zoomBucket < CLUSTER_ZOOM
  const cellWorld = CLUSTER_PX * Math.pow(2, -zoomBucket)

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
    if (killHeatImg) out.push(heatLayer('kill-heat', killHeatImg))
    if (deathHeatImg) out.push(heatLayer('death-heat', deathHeatImg))
    if (active.has('dead') && coverage) out.push(deadSpaceLayer(coverage.dead, coverage.size))
    if (active.has('paths')) out.push(pathLayer(paths))
    if (active.has('actors')) out.push(actorLayer(actors))
    out.push(...markerLayers('', { loot, kills, deaths }, active, clustered, cellWorld))
    // Hotspot overlay on top of the heat, then the selected run's path loudest of all.
    if (hotspotMode && hotOverlay.cells.length) {
      out.push(hotspotCellsLayer(hotOverlay.cells, onSelectCluster))
      out.push(hotspotLabelLayer(hotOverlay.labels))
    }
    if (hotspotMode && runPath && runPath.length) out.push(runPathLayer(runPath))
    return out
  }, [active, trafficImg, dwellImg, killHeatImg, deathHeatImg, coverage, paths, actors,
      loot, kills, deaths, diffCanvas,
      hotspotMode, hotOverlay, runPath, onSelectCluster, clustered, cellWorld])

  // Side B carries the SAME layer set as side A (ids suffixed -b so they never collide in the
  // one split canvas), so every toggle in the Layers panel applies to both maps and a real
  // dwell, coverage or path comparison is possible, not just traffic.
  const layersB = useMemo(() => {
    if (compareMode !== 'side' || !rowsB || !filterB) return []
    const bMapId = filterB.map ?? mapId
    const bConfig = store.meta.mapConfig[bMapId]
    const posB = filterRows(store, { ...filterB, events: intersectEvents(eventsFilter, ['Position', 'BotPosition']) })
    const out: Layer[] = []
    if (active.has('traffic')) out.push(heatLayer('traffic-b', trafficImage(heatPoints(store, posB, bConfig, 'traffic'))))
    if (active.has('dwell')) out.push(heatLayer('dwell-b', dwellImage(heatPoints(store, posB, bConfig, 'dwell'))))
    if (active.has('kill-heat')) out.push(heatLayer('kill-heat-b', killImage(eventHeatPoints(collectEvents(store, rowsB, bConfig, KILL_EVENTS)))))
    if (active.has('death-heat')) out.push(heatLayer('death-heat-b', deathImage(eventHeatPoints(collectEvents(store, rowsB, bConfig, DEATH_EVENTS)))))
    if (active.has('dead')) {
      const mask = store.meta.masks?.[bMapId]
      if (mask && posB.length) {
        const cov = deadSpace(aggregate(store, posB, GRID_SIZE, 'traffic'), maskReader(mask.bits, mask.size), mask.size)
        out.push(deadSpaceLayer(cov.dead, cov.size, 'dead-space-b'))
      }
    }
    if (active.has('paths')) {
      const bMapIdx = store.meta.dict.maps.indexOf(bMapId)
      const allowed = new Set<number>()
      for (const r of posB) allowed.add(store.cols.matchIdx[r] * 65536 + store.cols.userIdx[r])
      const window = filterB.elapsedTo !== undefined ? { from: filterB.elapsedFrom ?? 0, to: filterB.elapsedTo } : undefined
      out.push(pathLayer(buildPaths(store, bConfig, bMapIdx, (u, m) => allowed.has(m * 65536 + u), window), 'paths-b'))
    }
    if (active.has('actors')) {
      const stride = Math.max(1, Math.ceil(posB.length / 14000))
      const pts: { position: [number, number]; bot: boolean }[] = []
      for (let i = 0; i < posB.length; i += stride) {
        const r = posB[i]
        const { u, v } = worldToUV(store.cols.x[r], store.cols.z[r], bConfig)
        pts.push({ position: uvToWorldSpace(u, v), bot: store.isBotUser[store.cols.userIdx[r]] })
      }
      out.push(actorLayer(pts, 'actors-b'))
    }
    // Same level of detail as side A, driven by the shared zoom, so the two maps read alike.
    out.push(...markerLayers('b-', {
      loot: collectEvents(store, rowsB, bConfig, LOOT_EVENTS),
      kills: collectEvents(store, rowsB, bConfig, KILL_EVENTS),
      deaths: collectEvents(store, rowsB, bConfig, DEATH_EVENTS),
    }, active, clustered, cellWorld))
    return out
  }, [compareMode, store, rowsB, filterB, active, eventsFilter, mapId, clustered, cellWorld])

  // Side-by-side comparison renders as ONE canvas with two viewports (SplitCanvas) so there is
  // a single WebGL context; anything else is a single map.
  if (compareMode === 'side' && filterB) {
    const rightMapId = filterB.map ?? mapId
    return (
      <SplitCanvas
        leftMapId={mapId}
        leftLabel={config.label}
        leftLayers={layers}
        rightMapId={rightMapId}
        rightLabel={store.meta.mapConfig[rightMapId].label}
        rightLayers={layersB}
        focus={focus}
        getTooltip={getTooltip}
        onZoom={onZoom}
      />
    )
  }

  return (
    <MapCanvas
      mapId={mapId}
      config={config}
      layers={layers}
      focus={focus}
      getTooltip={getTooltip}
      onZoom={onZoom}
    />
  )
}
