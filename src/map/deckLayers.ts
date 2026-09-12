/**
 * deckLayers.ts — the deck.gl boundary.
 *
 * Every function here constructs a deck.gl Layer, so this is the ONLY map module that imports
 * deck.gl. Keeping it isolated is what lets the renderer be code-split out of the initial
 * bundle: nothing in the load path touches deck.gl until the map itself is about to draw.
 *
 * The pure companions — heatPoints, trafficImage, collectEvents, buildPaths, diffImage — live
 * in layers.ts and carry no deck.gl dependency, so filtering, aggregation and image baking can
 * all run (and be imported by App) before the renderer chunk has arrived.
 *
 * Cache the images and data these factories consume, never the Layer they return. deck.gl
 * layers are single-use descriptors: reusing an instance across renders breaks their lifecycle
 * and the layer silently stops drawing, with no error. Layers are cheap to construct, so build
 * them fresh every render and memoise their inputs.
 */

import { BitmapLayer, ScatterplotLayer, PathLayer, PolygonLayer, IconLayer, TextLayer } from 'deck.gl'
import type { Layer } from 'deck.gl'
import { MAP_BOUNDS, S } from './project'
import { iconAtlas, tokenA } from './theme'
import { eventStyle, GRID_SIZE } from './layers'
import type { EventPoint, PathSegment } from './layers'

export function heatLayer(id: string, image: HTMLCanvasElement): Layer {
  return new BitmapLayer({
    id,
    image,
    bounds: MAP_BOUNDS,
    opacity: 0.82,
    textureParameters: { minFilter: 'linear', magFilter: 'linear' },
    pickable: false,
  })
}

/**
 * Playable cells nobody ever entered.
 *
 * Drawn as explicit squares rather than a heatmap because absence is not a gradient: a cell
 * either saw a player or it did not, and shading it would imply a confidence the measurement
 * does not have.
 */
export function deadSpaceLayer(cells: number[], size: number): Layer {
  const step = S / size
  const polys = cells.map((cell) => {
    const col = cell % size
    const row = (cell / size) | 0
    const x = col * step
    const y = (size - row - 1) * step
    return { polygon: [[x, y], [x + step, y], [x + step, y + step], [x, y + step]] as [number, number][] }
  })
  return new PolygonLayer<{ polygon: [number, number][] }>({
    id: 'dead-space',
    data: polys,
    getPolygon: (d) => d.polygon,
    filled: true,
    stroked: false,
    getFillColor: tokenA('--ev-unknown', 0.3),
    pickable: false,
  })
}

/**
 * Marker layer. Shape carries the event type, colour reinforces it.
 *
 * IconLayer rather than ScatterplotLayer because scatterplot can only draw circles, and
 * colour alone is not enough to separate six event meanings for a colour-blind viewer or in
 * a printed screenshot.
 */
export function eventLayer(id: string, points: EventPoint[], sizePx = 11): Layer {
  const { url, mapping } = iconAtlas()
  return new IconLayer<EventPoint>({
    id,
    data: points,
    iconAtlas: url,
    iconMapping: mapping,
    getIcon: (d) => d.shape,
    getPosition: (d) => d.position,
    getSize: sizePx,
    sizeUnits: 'pixels',
    getColor: (d) => tokenA(eventStyle(d.event).color, 0.92),
    pickable: true,
  })
}

export function pathLayer(segments: PathSegment[]): Layer {
  return new PathLayer<PathSegment>({
    id: 'paths',
    data: segments,
    getPath: (d) => d.path,
    getColor: (d) => (d.bot ? tokenA('--actor-bot', 0.5) : tokenA('--actor-human', 0.55)),
    getWidth: (d) => (d.bot ? 1.1 : 1.4),
    widthUnits: 'pixels',
    widthMinPixels: 1,
    capRounded: true,
    jointRounded: true,
    pickable: false,
  })
}

/**
 * Live actor positions. Bots are hollow, humans solid, so the two read apart even where a
 * cluster overlaps and even in greyscale.
 */
export function actorLayer(points: { position: [number, number]; bot: boolean }[]): Layer {
  return new ScatterplotLayer<{ position: [number, number]; bot: boolean }>({
    id: 'actors',
    data: points,
    getPosition: (d) => d.position,
    getRadius: 3,
    radiusUnits: 'pixels',
    radiusMinPixels: 2,
    filled: true,
    stroked: true,
    lineWidthUnits: 'pixels',
    getLineWidth: 1,
    getFillColor: (d) => (d.bot ? tokenA('--actor-bot', 0.18) : tokenA('--actor-human', 0.85)),
    getLineColor: (d) => (d.bot ? tokenA('--actor-bot', 0.95) : tokenA('--actor-human', 0.95)),
    pickable: false,
  })
}

/** Diff layer. Same bake-to-texture approach as the heat layers, for the same reason. */
export function diffLayer(image: HTMLCanvasElement): Layer {
  return new BitmapLayer({
    id: 'diff',
    image,
    bounds: MAP_BOUNDS,
    opacity: 0.85,
    textureParameters: { minFilter: 'linear', magFilter: 'linear' },
    pickable: false,
  })
}

// ─── Hotspots and drill-down ──────────────────────────────────────────────────

export interface HotCell {
  cell: number
  clusterId: number
  rank: number
  count: number
  selected: boolean
}

/**
 * The hot cells of every listed cluster, drawn as their real grid squares.
 *
 * One polygon per cell rather than a single merged outline, so hovering reports THAT cell's
 * own traffic count and the footprint on the map is exactly the set of cells the ranking used.
 * The selected cluster is filled solidly; the rest sit faint, present for context but clearly
 * secondary.
 */
export function hotspotCellsLayer(cells: HotCell[], onSelect: (clusterId: number) => void): Layer {
  const step = S / GRID_SIZE
  const data = cells.map((hc) => {
    const col = hc.cell % GRID_SIZE
    const row = (hc.cell / GRID_SIZE) | 0
    const x = col * step
    const y = (GRID_SIZE - row - 1) * step
    return { ...hc, polygon: [[x, y], [x + step, y], [x + step, y + step], [x, y + step]] as [number, number][] }
  })
  return new PolygonLayer<(typeof data)[number]>({
    id: 'hotspot-cells',
    data,
    getPolygon: (d) => d.polygon,
    filled: true,
    stroked: true,
    lineWidthUnits: 'pixels',
    getLineWidth: (d) => (d.selected ? 1.5 : 0.75),
    getFillColor: (d) => (d.selected ? tokenA('--accent', 0.42) : tokenA('--accent', 0.1)),
    getLineColor: (d) => (d.selected ? tokenA('--accent', 0.95) : tokenA('--accent', 0.4)),
    pickable: true,
    onClick: (info) => { const o = info.object as { clusterId?: number } | undefined; if (o?.clusterId !== undefined) onSelect(o.clusterId) },
  })
}

export interface HotLabel { position: [number, number]; text: string; selected: boolean }

/** Rank numbers at each cluster centroid, so the list and the map name the same places. */
export function hotspotLabelLayer(labels: HotLabel[]): Layer {
  return new TextLayer<HotLabel>({
    id: 'hotspot-labels',
    data: labels,
    getPosition: (d) => d.position,
    getText: (d) => d.text,
    getSize: 13,
    sizeUnits: 'pixels',
    getColor: () => tokenA('--text-1', 1),
    fontFamily: 'IBM Plex Mono, monospace',
    fontWeight: 700,
    background: true,
    getBackgroundColor: (d) => (d.selected ? tokenA('--accent', 0.95) : tokenA('--bg-0', 0.85)),
    backgroundPadding: [5, 3],
    getPixelOffset: [0, 0],
    pickable: false,
  })
}

/**
 * One selected run's path, drawn bright over the rest.
 *
 * This is the end of the drill-down: a single journey, so the reader can see the actual route
 * that passed through the cluster rather than an aggregate. Deliberately louder than the faint
 * journey layer, in the UI selection colour so it is not mistaken for another actor.
 */
export function runPathLayer(segments: PathSegment[]): Layer {
  return new PathLayer<PathSegment>({
    id: 'run-path',
    data: segments,
    getPath: (d) => d.path,
    getColor: tokenA('--accent', 0.98),
    getWidth: 3,
    widthUnits: 'pixels',
    widthMinPixels: 2.5,
    capRounded: true,
    jointRounded: true,
    pickable: false,
  })
}
