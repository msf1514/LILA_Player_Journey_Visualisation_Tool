/**
 * project.test.ts — the projection is the foundation every layer sits on.
 *
 * A silently wrong projection is the worst failure available in this tool: nothing throws,
 * the map still looks like a map, and a designer draws conclusions from data placed in the
 * wrong buildings. These tests pin it against the dataset README's own worked example and
 * against the real coordinate ranges.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  S, worldToUV, uvToWorld, uvToWorldSpace, worldToWorldSpace, worldSpaceToUV,
  uvToPixel, isInBounds, MAP_BOUNDS, minimapUrl, initialViewState, MIN_ZOOM, MAX_ZOOM,
} from './project'
import type { MapConfig } from '../data/types'

const maps = JSON.parse(
  readFileSync(resolve(__dirname, '../../pipeline/mapConfig.json'), 'utf8'),
).maps as Record<string, MapConfig>

describe('worldToUV', () => {
  it("reproduces the dataset README's worked example for AmbroseValley", () => {
    const { u, v } = worldToUV(-301.45, -355.55, maps.AmbroseValley)
    expect(u).toBeCloseTo(0.0762, 4)
    expect(v).toBeCloseTo(0.1305, 4)
  })

  it('places the origin corner at 0,0 and the far corner at 1,1', () => {
    const cfg = maps.AmbroseValley
    expect(worldToUV(cfg.originX, cfg.originZ, cfg)).toEqual({ u: 0, v: 0 })
    const far = worldToUV(cfg.originX + cfg.scale, cfg.originZ + cfg.scale, cfg)
    expect(far.u).toBeCloseTo(1, 10)
    expect(far.v).toBeCloseTo(1, 10)
  })

  it('uses each map its own scale and origin', () => {
    // Same world coordinate, different maps, must give different UV.
    const a = worldToUV(0, 0, maps.AmbroseValley)
    const g = worldToUV(0, 0, maps.GrandRift)
    const l = worldToUV(0, 0, maps.Lockdown)
    expect(a).not.toEqual(g)
    expect(g).not.toEqual(l)
    expect(l).toEqual({ u: 0.5, v: 0.5 })   // Lockdown: origin -500, scale 1000
  })

  it('round-trips through uvToWorld', () => {
    for (const cfg of Object.values(maps)) {
      const { u, v } = worldToUV(-123.75, 88.5, cfg)
      const back = uvToWorld(u, v, cfg)
      expect(back.x).toBeCloseTo(-123.75, 6)
      expect(back.z).toBeCloseTo(88.5, 6)
    }
  })
})

describe('render space', () => {
  it('maps UV onto the S-sized square without flipping V', () => {
    // The view uses flipY:false, so render Y grows upward exactly as world Z does.
    // Flipping here as well would cancel out and look right on a symmetric map only.
    expect(uvToWorldSpace(0, 0)).toEqual([0, 0])
    expect(uvToWorldSpace(1, 1)).toEqual([S, S])
    expect(uvToWorldSpace(0.25, 0.75)).toEqual([S * 0.25, S * 0.75])
  })

  it('round-trips through worldSpaceToUV', () => {
    const { u, v } = worldSpaceToUV(...uvToWorldSpace(0.3, 0.8))
    expect(u).toBeCloseTo(0.3, 10)
    expect(v).toBeCloseTo(0.8, 10)
  })

  it('goes from world straight to render space consistently', () => {
    const cfg = maps.GrandRift
    const { u, v } = worldToUV(42, -17, cfg)
    expect(worldToWorldSpace(42, -17, cfg)).toEqual(uvToWorldSpace(u, v))
  })

  it('bounds the map at exactly the render square', () => {
    expect(MAP_BOUNDS).toEqual([0, 0, S, S])
  })
})

describe('uvToPixel', () => {
  it("matches the README's pixel example at its stated 1024 size", () => {
    const { u, v } = worldToUV(-301.45, -355.55, maps.AmbroseValley)
    const { px, py } = uvToPixel(u, v, 1024, 1024)
    expect(Math.round(px)).toBe(78)
    expect(Math.round(py)).toBe(890)
  })

  it('flips Y, because image origin is top-left', () => {
    expect(uvToPixel(0, 0, 500, 500).py).toBe(500)
    expect(uvToPixel(0, 1, 500, 500).py).toBe(0)
  })

  it('never assumes a square or a fixed size', () => {
    // GrandRift's source art is 2160x2158. Anything hardcoding 1024, or assuming
    // width === height, silently misplaces every point on that map.
    const { u, v } = worldToUV(0, 0, maps.GrandRift)
    const p = uvToPixel(u, v, 2160, 2158)
    expect(p.px).toBeCloseTo(u * 2160, 6)
    expect(p.py).toBeCloseTo((1 - v) * 2158, 6)
    expect(p.px).not.toBeCloseTo(p.py, 0)
  })
})

describe('bounds guard', () => {
  it('accepts the unit square and rejects outside it', () => {
    expect(isInBounds(0, 0)).toBe(true)
    expect(isInBounds(1, 1)).toBe(true)
    expect(isInBounds(0.5, 0.5)).toBe(true)
    expect(isInBounds(-0.001, 0.5)).toBe(false)
    expect(isInBounds(0.5, 1.001)).toBe(false)
  })

  it('holds for the real coordinate extremes of every map', () => {
    // Measured extents from the dataset. If a config drifts, this fails before anything
    // reaches the screen.
    const extremes: Record<string, [number, number, number, number]> = {
      //            xMin,  xMax,  zMin,  zMax
      AmbroseValley: [-325, 302, -380, 361],
      GrandRift:     [-226, 257, -194, 170],
      Lockdown:      [-407, 348, -285, 329],
    }
    for (const [id, [xMin, xMax, zMin, zMax]] of Object.entries(extremes)) {
      const cfg = maps[id]
      for (const [x, z] of [[xMin, zMin], [xMax, zMax], [xMin, zMax], [xMax, zMin]]) {
        const { u, v } = worldToUV(x, z, cfg)
        expect(isInBounds(u, v)).toBe(true)
      }
    }
  })
})

describe('view configuration', () => {
  it('frames the whole map and clamps zoom so it cannot be lost off screen', () => {
    const vs = initialViewState()
    expect(vs.target).toEqual([S / 2, S / 2, 0])
    expect(vs.zoom).toBe(0)
    expect(vs.minZoom).toBe(MIN_ZOOM)
    expect(vs.maxZoom).toBe(MAX_ZOOM)
    expect(MIN_ZOOM).toBeLessThan(0)
    expect(MAX_ZOOM).toBeGreaterThan(0)
  })

  it('builds minimap urls from the map id', () => {
    expect(minimapUrl('GrandRift', '/')).toBe('/minimaps/GrandRift.webp')
    expect(minimapUrl('Lockdown', '/tool')).toBe('/tool/minimaps/Lockdown.webp')
  })
})
