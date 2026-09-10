/**
 * loader.ts — fetches the bundle and maps it onto typed-array views.
 *
 * Two requests, no backend. The binary layout is fixed by pipeline/build.mjs and mirrored
 * here; the field order matters because each view is a window onto one shared ArrayBuffer
 * at a known byte offset. Columns are ordered widest-first (f32/u32, then u16, then u8) so
 * every view lands on its natural alignment -- a misaligned Uint32Array view throws.
 *
 * No copying happens: `bundle.bin` arrives as one ArrayBuffer and the nine views are
 * windows onto it. Memory cost is the 2.1 MB payload itself.
 */

import type { Columns, Meta } from './types'

export interface Bundle {
  meta: Meta
  cols: Columns
  n: number
}

/** Byte width per row, must match pipeline/build.mjs. */
const BYTES_PER_ROW = 24

export function viewColumns(buffer: ArrayBuffer, n: number): Columns {
  if (buffer.byteLength !== BYTES_PER_ROW * n) {
    throw new Error(
      `bundle.bin is ${buffer.byteLength} bytes but meta.json declares ${n} rows ` +
      `(expected ${BYTES_PER_ROW * n}). The two files are out of sync -- re-run \`npm run build:data\`.`
    )
  }
  return {
    x:        new Float32Array(buffer, 0, n),
    z:        new Float32Array(buffer, 4 * n, n),
    y:        new Float32Array(buffer, 8 * n, n),
    tSec:     new Uint32Array(buffer, 12 * n, n),
    userIdx:  new Uint16Array(buffer, 16 * n, n),
    matchIdx: new Uint16Array(buffer, 18 * n, n),
    elapsed:  new Uint16Array(buffer, 20 * n, n),
    mapIdx:   new Uint8Array(buffer, 22 * n, n),
    evIdx:    new Uint8Array(buffer, 23 * n, n),
  }
}

export async function loadBundle(base = import.meta.env.BASE_URL ?? '/'): Promise<Bundle> {
  const root = base.endsWith('/') ? base : `${base}/`

  // Independent requests, so start both and await together rather than serialising them.
  const [metaRes, binRes] = await Promise.all([
    fetch(`${root}meta.json`),
    fetch(`${root}bundle.bin`),
  ])
  if (!metaRes.ok) throw new Error(`meta.json failed to load (${metaRes.status})`)
  if (!binRes.ok) throw new Error(`bundle.bin failed to load (${binRes.status})`)

  const [meta, buffer] = await Promise.all([
    metaRes.json() as Promise<Meta>,
    binRes.arrayBuffer(),
  ])

  return { meta, cols: viewColumns(buffer, meta.rows), n: meta.rows }
}

/** Decode a base64 playable-land mask into a bit-test function. */
export function maskReader(bits: string, size: number) {
  const bin = atob(bits)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return (col: number, row: number): boolean => {
    if (col < 0 || row < 0 || col >= size || row >= size) return false
    const idx = row * size + col
    return (bytes[idx >> 3] & (0x80 >> (idx & 7))) !== 0
  }
}
