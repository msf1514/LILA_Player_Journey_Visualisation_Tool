/**
 * cluster.test.ts — the zoomed-out level-of-detail binning must aggregate honestly.
 *
 * A cluster's count is the number of markers it stands in for, and its position is the mean of
 * those markers, so it lands where the events actually are rather than on a grid line. Nearby
 * markers merge; distant ones stay apart; a non-positive cell size is a no-op.
 */

import { describe, it, expect } from 'vitest'
import { clusterEvents, type EventPoint } from './layers'

const pt = (x: number, y: number, event = 'Loot'): EventPoint => ({
  position: [x, y], event, shape: 'square', bot: false, matchIdx: 0, userIdx: 0, elapsed: 0,
})

describe('clusterEvents', () => {
  it('merges markers that fall in the same cell and counts them', () => {
    const cl = clusterEvents([pt(1, 1), pt(2, 2), pt(3, 3)], 10) // all in cell (0,0)
    expect(cl).toHaveLength(1)
    expect(cl[0].count).toBe(3)
    expect(cl[0].position[0]).toBeCloseTo(2)
    expect(cl[0].position[1]).toBeCloseTo(2)
  })

  it('keeps markers in different cells apart', () => {
    const cl = clusterEvents([pt(1, 1), pt(55, 55)], 10) // cells (0,0) and (5,5)
    expect(cl).toHaveLength(2)
    expect(cl.every((c) => c.count === 1)).toBe(true)
  })

  it('places the cluster at the mean of its members, not the cell centre', () => {
    const cl = clusterEvents([pt(1, 1), pt(9, 9)], 10)
    expect(cl).toHaveLength(1)
    expect(cl[0].position).toEqual([5, 5])
  })

  it('is a no-op for a non-positive cell size or empty input', () => {
    expect(clusterEvents([pt(1, 1)], 0)).toEqual([])
    expect(clusterEvents([], 10)).toEqual([])
  })
})
