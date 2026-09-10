/**
 * theme.ts — bridges CSS design tokens into the WebGL layers.
 *
 * deck.gl needs numeric RGBA, but every colour in this app is defined once in
 * `src/design/tokens.css`. Hardcoding hex values here would fork the palette: the legend
 * would drift from the map, and a token change would silently apply to half the interface.
 * So the tokens stay authoritative and this reads them at runtime.
 *
 * Read once and cached. `getComputedStyle` forces style resolution, and calling it inside a
 * deck.gl accessor would do that for every point on every frame.
 */

export type RGB = [number, number, number]
export type RGBA = [number, number, number, number]

const cache = new Map<string, RGB>()

/** Resolve a CSS custom property to RGB. Falls back to mid-grey if the token is missing. */
export function token(name: string): RGB {
  const hit = cache.get(name)
  if (hit) return hit
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  const rgb = parseColor(raw) ?? [148, 163, 184]
  cache.set(name, rgb)
  return rgb
}

export function tokenA(name: string, alpha: number): RGBA {
  const [r, g, b] = token(name)
  return [r, g, b, Math.round(alpha * 255)]
}

function parseColor(raw: string): RGB | null {
  if (!raw) return null
  if (raw.startsWith('#')) {
    const hex = raw.slice(1)
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex
    if (full.length < 6) return null
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
    ]
  }
  const m = raw.match(/rgba?\(([^)]+)\)/)
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number)
    if (parts.length >= 3) return [parts[0], parts[1], parts[2]]
  }
  return null
}

/**
 * Heat ramps, read from the token file so the legend swatches and the canvas cannot drift.
 *
 * Traffic is cool and dwell is warm on purpose. They answer different questions, and a
 * designer toggling between them needs to know at a glance which one is on screen without
 * looking at the panel.
 */
export const rampTraffic = (): RGB[] =>
  [0, 1, 2, 3, 4].map((i) => token(`--heat-traffic-${i}`))

export const rampDwell = (): RGB[] =>
  [0, 1, 2, 3, 4].map((i) => token(`--heat-dwell-${i}`))

// ─── Marker shapes ──────────────────────────────────────────────────────────

/**
 * Marker shapes, drawn once into an icon atlas.
 *
 * Colour is never the only channel that distinguishes a mark. Roughly one man in twelve has
 * some form of colour vision deficiency, and the data palette already carries six meanings;
 * shape keeps them separable regardless. It also survives the case a colour ramp does not:
 * a screenshot pasted into a document, printed, or seen on a bad monitor.
 *
 * Icons are drawn white so `getColor` can tint them per layer.
 */
export type ShapeName = 'square' | 'triangle' | 'cross' | 'hexagon' | 'diamond' | 'circle'

const SHAPES: ShapeName[] = ['square', 'triangle', 'cross', 'hexagon', 'diamond', 'circle']
const CELL = 64
const PAD = 10

let atlasCache: { url: string; mapping: Record<string, IconDef> } | null = null

interface IconDef {
  x: number
  y: number
  width: number
  height: number
  anchorX: number
  anchorY: number
  mask: boolean
}

/** Build (once) a horizontal atlas of white marker shapes plus its deck.gl icon mapping. */
export function iconAtlas() {
  if (atlasCache) return atlasCache

  const canvas = document.createElement('canvas')
  canvas.width = CELL * SHAPES.length
  canvas.height = CELL
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#fff'
  ctx.strokeStyle = '#fff'
  ctx.lineCap = 'round'

  const mapping: Record<string, IconDef> = {}

  SHAPES.forEach((shape, i) => {
    const ox = i * CELL
    const c = ox + CELL / 2
    const m = CELL / 2 - PAD
    ctx.save()
    ctx.beginPath()
    switch (shape) {
      case 'square':
        ctx.rect(c - m * 0.82, CELL / 2 - m * 0.82, m * 1.64, m * 1.64)
        ctx.fill()
        break
      case 'triangle':
        ctx.moveTo(c, CELL / 2 - m)
        ctx.lineTo(c + m, CELL / 2 + m * 0.8)
        ctx.lineTo(c - m, CELL / 2 + m * 0.8)
        ctx.closePath()
        ctx.fill()
        break
      case 'diamond':
        ctx.moveTo(c, CELL / 2 - m)
        ctx.lineTo(c + m, CELL / 2)
        ctx.lineTo(c, CELL / 2 + m)
        ctx.lineTo(c - m, CELL / 2)
        ctx.closePath()
        ctx.fill()
        break
      case 'hexagon':
        for (let k = 0; k < 6; k++) {
          const a = (Math.PI / 3) * k - Math.PI / 2
          const px = c + m * Math.cos(a)
          const py = CELL / 2 + m * Math.sin(a)
          k === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.fill()
        break
      case 'cross':
        ctx.lineWidth = m * 0.62
        ctx.moveTo(c - m * 0.78, CELL / 2 - m * 0.78)
        ctx.lineTo(c + m * 0.78, CELL / 2 + m * 0.78)
        ctx.moveTo(c + m * 0.78, CELL / 2 - m * 0.78)
        ctx.lineTo(c - m * 0.78, CELL / 2 + m * 0.78)
        ctx.stroke()
        break
      case 'circle':
        ctx.arc(c, CELL / 2, m * 0.86, 0, Math.PI * 2)
        ctx.fill()
        break
    }
    ctx.restore()
    mapping[shape] = { x: ox, y: 0, width: CELL, height: CELL, anchorX: CELL / 2, anchorY: CELL / 2, mask: true }
  })

  atlasCache = { url: canvas.toDataURL('image/png'), mapping }
  return atlasCache
}

/** The same shapes as inline SVG, so the legend draws exactly what the map draws. */
export function shapeSvg(shape: ShapeName, color: string, size = 11): string {
  const c = size / 2
  const m = c * 0.86
  const common = `fill="${color}" stroke="none"`
  switch (shape) {
    case 'square':
      return `<rect x="${c - m * 0.82}" y="${c - m * 0.82}" width="${m * 1.64}" height="${m * 1.64}" ${common}/>`
    case 'triangle':
      return `<polygon points="${c},${c - m} ${c + m},${c + m * 0.8} ${c - m},${c + m * 0.8}" ${common}/>`
    case 'diamond':
      return `<polygon points="${c},${c - m} ${c + m},${c} ${c},${c + m} ${c - m},${c}" ${common}/>`
    case 'hexagon': {
      const pts = Array.from({ length: 6 }, (_, k) => {
        const a = (Math.PI / 3) * k - Math.PI / 2
        return `${(c + m * Math.cos(a)).toFixed(2)},${(c + m * Math.sin(a)).toFixed(2)}`
      }).join(' ')
      return `<polygon points="${pts}" ${common}/>`
    }
    case 'cross':
      return `<path d="M${c - m * 0.78} ${c - m * 0.78} L${c + m * 0.78} ${c + m * 0.78} M${c + m * 0.78} ${c - m * 0.78} L${c - m * 0.78} ${c + m * 0.78}" stroke="${color}" stroke-width="${m * 0.62}" stroke-linecap="round" fill="none"/>`
    case 'circle':
      return `<circle cx="${c}" cy="${c}" r="${m * 0.86}" ${common}/>`
  }
}
