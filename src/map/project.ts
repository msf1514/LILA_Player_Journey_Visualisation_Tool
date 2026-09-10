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
 * Fraction of the viewport the framed map occupies, leaving a small breathing margin.
 */
const FIT_PADDING = 0.94

/**
 * Zoom that fits the whole map into a viewport of the given size.
 *
 * OrthographicView zoom is log2: at zoom 0 one world unit is one CSS pixel, so the S-unit
 * map would always draw at exactly S pixels regardless of window size. That is wrong in
 * both directions -- it clips on a short window and floats in a sea of empty space on a
 * wide one -- so the framing zoom has to be derived from the viewport, not hardcoded.
 *
 * The map is square, so the limiting dimension is the smaller one. On a wide screen this
 * necessarily leaves margins left and right; those are where the filter rail and context
 * panel live once later phases fill them in.
 */
export function fitZoom(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 0
  return Math.log2((Math.min(width, height) * FIT_PADDING) / S)
}

/**
 * Zoom limits, expressed relative to the fitted zoom rather than as absolutes.
 *
 * A fixed `minZoom` would either prevent a small window from framing the whole map, or let
 * a large one zoom out until the map is a speck. Anchoring to fit means "you may zoom out
 * a little past the framed view, and in to roughly 16x" on every screen size.
 */
export const MIN_ZOOM_BELOW_FIT = 0.6
export const MAX_ZOOM_ABOVE_FIT = 4

export function zoomLimits(width: number, height: number) {
  const fit = fitZoom(width, height)
  return { minZoom: fit - MIN_ZOOM_BELOW_FIT, maxZoom: fit + MAX_ZOOM_ABOVE_FIT }
}

/** A rectangle in UV space: [uMin, vMin, uMax, vMax]. */
export type UVBounds = [number, number, number, number]

/** The whole map square. */
export const FULL_BOUNDS: UVBounds = [0, 0, 1, 1]

/**
 * Frame an arbitrary UV rectangle rather than the whole map square.
 *
 * This matters because the minimap art is mostly empty. Each image is a square canvas with
 * the island painted inside it, so the playable area is only about three quarters of the
 * frame on Ambrose and less elsewhere. Fitting the square wastes that margin twice over --
 * once vertically, and again horizontally on a wide monitor -- and leaves the map looking
 * like a postage stamp in a field of black.
 *
 * Framing the region the data actually occupies uses the screen for the part a designer
 * came to look at.
 */
export function fitViewState(width: number, height: number, bounds: UVBounds = FULL_BOUNDS) {
  const [uMin, vMin, uMax, vMax] = bounds
  const bw = Math.max(uMax - uMin, 1e-6) * S
  const bh = Math.max(vMax - vMin, 1e-6) * S
  const zoom =
    width > 0 && height > 0
      ? Math.log2(Math.min((width * FIT_PADDING) / bw, (height * FIT_PADDING) / bh))
      : 0
  return {
    target: [((uMin + uMax) / 2) * S, ((vMin + vMax) / 2) * S, 0] as [number, number, number],
    zoom,
    minZoom: zoom - MIN_ZOOM_BELOW_FIT,
    maxZoom: zoom + MAX_ZOOM_ABOVE_FIT,
  }
}

/** Grow a bounds rectangle by a fraction of its size, clamped to the map square. */
export function padBounds(b: UVBounds, pad = 0.04): UVBounds {
  const [uMin, vMin, uMax, vMax] = b
  const du = (uMax - uMin) * pad
  const dv = (vMax - vMin) * pad
  return [
    Math.max(0, uMin - du), Math.max(0, vMin - dv),
    Math.min(1, uMax + du), Math.min(1, vMax + dv),
  ]
}

/** The view state that frames the map. Also what the reset control returns to. */
export function initialViewState(width = 0, height = 0, bounds: UVBounds = FULL_BOUNDS) {
  return fitViewState(width, height, bounds)
}
