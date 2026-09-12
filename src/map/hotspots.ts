/**
 * hotspots.ts — cluster ranking, no deck.gl.
 *
 * The finding that shapes this whole feature: traffic on these maps is remarkably
 * UNCONCENTRATED. On a 64x64 grid the single busiest cell holds about 0.3% of traffic, the
 * top ten cells 2.8%, the top fifty 12 to 14%. Cells one through ten differ by hundredths of a
 * percent, so a "top 5 busiest cells" list would be ranking noise dressed up as insight.
 *
 * So we do not rank cells. We threshold, merge ADJACENT hot cells into clusters (4-connected
 * connected components), require a cluster to be more than one cell, and rank the CLUSTERS by
 * their summed share of traffic. Each row carries its share so a reader can see that ranks
 * three and four are all but identical.
 *
 * The threshold matters, and getting it wrong is silent. At the 80th percentile the hottest
 * cells all touch and collapse into one blob spanning the map's centre: on Ambrose that single
 * "cluster" is 13% of traffic across 85 cells. A confident-looking top result like that is the
 * FAILURE signal, not a success — it means the clustering merged everything. Thresholding
 * higher, at the 90th percentile of non-empty cells, breaks that blob into the distinct dense
 * areas a designer would actually name, where even the busiest is only a few percent.
 */

import type { Grid } from '../data/types'

export const HOT_PERCENTILE = 0.9
export const HOT_MIN_CELLS = 2
export const HOT_CAP = 8

export interface Cluster {
  /** Stable id = the cluster's peak cell index, so selection survives a re-rank. */
  id: number
  /** 1-based rank by summed share. */
  rank: number
  cells: number[]
  cellCount: number
  /** Summed traffic in this cluster as a fraction of all traffic on the map. */
  share: number
  /** The single busiest cell and its raw count, for the hover-to-verify path. */
  peakCell: number
  peakCount: number
  /** Cluster centre in UV [0,1], for a map label. */
  centroid: [number, number]
}

export interface Hotspots {
  clusters: Cluster[]
  /** Every multi-cell cluster found, before the cap. Quoted so the reader sees the long tail. */
  totalClusters: number
  /** The value a cell must exceed to be "hot". */
  threshold: number
  /** Share of the single largest cluster. If this is large, the clustering is wrong. */
  topShare: number
}

/** The value at percentile `p` across the non-empty cells only. */
function percentileNonEmpty(values: Float32Array, p: number): number {
  const arr: number[] = []
  for (let i = 0; i < values.length; i++) if (values[i] > 0) arr.push(values[i])
  if (!arr.length) return Infinity
  arr.sort((a, b) => a - b)
  return arr[Math.floor((arr.length - 1) * p)]
}

/** 4-connected components of the cells strictly above `threshold`. */
function components(values: Float32Array, size: number, threshold: number): number[][] {
  const hot = new Uint8Array(size * size)
  for (let c = 0; c < values.length; c++) hot[c] = values[c] > threshold ? 1 : 0
  const seen = new Uint8Array(size * size)
  const out: number[][] = []
  const stack: number[] = []
  for (let start = 0; start < size * size; start++) {
    if (!hot[start] || seen[start]) continue
    stack.length = 0
    stack.push(start)
    seen[start] = 1
    const cells: number[] = []
    while (stack.length) {
      const c = stack.pop()!
      cells.push(c)
      const row = (c / size) | 0
      const col = c % size
      // Orthogonal neighbours only. Diagonal adjacency over-merges distinct rooms.
      if (col > 0 && hot[c - 1] && !seen[c - 1]) { seen[c - 1] = 1; stack.push(c - 1) }
      if (col < size - 1 && hot[c + 1] && !seen[c + 1]) { seen[c + 1] = 1; stack.push(c + 1) }
      if (row > 0 && hot[c - size] && !seen[c - size]) { seen[c - size] = 1; stack.push(c - size) }
      if (row < size - 1 && hot[c + size] && !seen[c + size]) { seen[c + size] = 1; stack.push(c + size) }
    }
    out.push(cells)
  }
  return out
}

export function computeHotspots(
  grid: Grid,
  { percentile = HOT_PERCENTILE, minCells = HOT_MIN_CELLS, cap = HOT_CAP } = {},
): Hotspots {
  const { size, values, total } = grid
  const t = total || 1
  const threshold = percentileNonEmpty(values, percentile)

  const comps = components(values, size, threshold).filter((c) => c.length >= minCells)

  const clusters: Cluster[] = comps.map((cells) => {
    let sum = 0
    let peakCell = cells[0]
    let peakCount = 0
    let colSum = 0
    let rowSum = 0
    for (const c of cells) {
      const v = values[c]
      sum += v
      if (v > peakCount) { peakCount = v; peakCell = c }
      colSum += c % size
      rowSum += (c / size) | 0
    }
    const col = colSum / cells.length
    const row = rowSum / cells.length
    return {
      id: peakCell,
      rank: 0,
      cells,
      cellCount: cells.length,
      share: sum / t,
      peakCell,
      peakCount,
      centroid: [(col + 0.5) / size, 1 - (row + 0.5) / size] as [number, number],
    }
  })

  clusters.sort((a, b) => b.share - a.share)
  const capped = clusters.slice(0, cap)
  capped.forEach((c, i) => { c.rank = i + 1 })

  return {
    clusters: capped,
    totalClusters: comps.length,
    threshold,
    topShare: capped[0]?.share ?? 0,
  }
}
