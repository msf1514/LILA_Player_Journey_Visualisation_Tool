/**
 * project.ts — world coordinates to render space.
 *
 * Pure functions only: no React, no deck.gl. Everything that decides *where a thing goes*
 * lives here so it can be tested in isolation, and so the answer cannot differ between the
 * heatmap, the markers and the paths.
 *
 * THE PROJECTION
 *   u = (x - originX) / scale
 *   v = (z - originZ) / scale
 *
 * Verified against the full dataset: 0 of 89,016 rows fall outside u,v in [0,1] on any of
 * the three maps. That invariant is what `isInBounds` guards.
 *
 * Two rules that are easy to get wrong and expensive to discover later:
 *
 *   1. `y` is ELEVATION. It never influences 2D placement. The world is x/z; y only tells
 *      you how high above it a player was.
 *
 *   2. Nothing here may assume an image size. The source minimaps are 4320x4320,
 *      2160x2158 (not square) and 9000x9000, and the shipped WebPs are normalised to 2048
 *      square. Work in UV, scale to whatever the caller is rendering into. `uvToPixel`
 *      takes width and height as arguments for exactly this reason.
 */

import type { MapConfig } from '../data/types'

/**
 * Edge length of the render coordinate space, in world units.
 *
 * The map is drawn into a square of S x S and every projected point is placed inside it.
 * The value is arbitrary but fixed: it exists so pan/zoom, layer bounds and hit-testing
 * all share one coordinate system. The shipped art is 2048px scaled into these 1024
 * units, which is deliberate: it stays crisp when a designer zooms in.
 */
export const S = 1024

export interface UV { u: number; v: number }

/** World (x, z) to normalised UV in [0, 1]. */
export function worldToUV(x: number, z: number, cfg: MapConfig): UV {
  return { u: (x - cfg.originX) / cfg.scale, v: (z - cfg.originZ) / cfg.scale }
}

/** Inverse of `worldToUV`. Used for reading a world position back out of a picked point. */
export function uvToWorld(u: number, v: number, cfg: MapConfig): { x: number; z: number } {
  return { x: u * cfg.scale + cfg.originX, z: v * cfg.scale + cfg.originZ }
}

/**
 * UV to deck.gl render space.
 *
 * V is NOT flipped here. The view is configured with `flipY: false`, so render-space Y
 * grows upward exactly as world Z does, and the BitmapLayer's `bounds` places the image
 * the same way. Flipping in both places would cancel out and look correct on a symmetric
 * map while being wrong everywhere else, which is the worst way for this to fail.
 */
export function uvToWorldSpace(u: number, v: number): [number, number] {
  return [u * S, v * S]
}

/** World (x, z) straight to render space. */
export function worldToWorldSpace(x: number, z: number, cfg: MapConfig): [number, number] {
  const { u, v } = worldToUV(x, z, cfg)
  return uvToWorldSpace(u, v)
}

/** Inverse of `uvToWorldSpace`, for translating a cursor position back to data. */
export function worldSpaceToUV(sx: number, sy: number): UV {
  return { u: sx / S, v: sy / S }
}

/**
 * UV to a pixel in an image of the given size.
 *
 * Y IS flipped here, because image origin is top-left while world Z grows upward. This is
 * the form the dataset README documents, and is used for anything addressing image pixels
 * directly (masks, offline renders, tests) rather than deck.gl render space.
 */
export function uvToPixel(u: number, v: number, width: number, height: number) {
  return { px: u * width, py: (1 - v) * height }
}

export function isInBounds(u: number, v: number): boolean {
  return u >= 0 && u <= 1 && v >= 0 && v <= 1
}

/** The square the map occupies in render space: [left, bottom, right, top]. */
export const MAP_BOUNDS: [number, number, number, number] = [0, 0, S, S]

/** URL of the shipped minimap for a map id. */
export function minimapUrl(mapId: string, base = import.meta.env.BASE_URL ?? '/'): string {
  const root = base.endsWith('/') ? base : `${base}/`
  return `${root}minimaps/${mapId}.webp`
}

/**
 * Zoom limits.
 *
 * Clamped so a designer cannot lose the map off screen. `MIN_ZOOM` keeps the whole map
 * larger than a fraction of the viewport; `MAX_ZOOM` stops at roughly 8x, past which the
 * 2048px source starts to soften and the view stops being useful.
 */
export const MIN_ZOOM = -1.5
export const MAX_ZOOM = 3

/** The view state that frames the whole map. Also what the reset control returns to. */
export function initialViewState() {
  return { target: [S / 2, S / 2, 0] as [number, number, number], zoom: 0, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM }
}
