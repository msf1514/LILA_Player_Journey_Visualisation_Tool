/**
 * minimaps.mjs — prepares minimap art for the web and derives a playable-land mask.
 *
 * Run: `npm run build:maps`
 * Outputs: public/minimaps/<Map>.webp  and  pipeline/masks.json (consumed by build.mjs)
 *
 * TWO JOBS
 *
 * 1. DOWNSCALE. The supplied art totals 24 MB and is nowhere near the 1024x1024 the dataset
 *    README claims: AmbroseValley is 4320x4320, Lockdown is a 9000x9000 JPEG, and GrandRift
 *    is 2160x2158 — not even square. Shipping those as-is would dominate load time.
 *
 *    Note on the square fit: the world region is square (scale x scale), so each image is
 *    resized to a square canvas. For GrandRift that means a 0.09% vertical stretch, which is
 *    far below one pixel at any realistic zoom and keeps the projection math uniform.
 *
 * 2. PLAYABLE-LAND MASK. Every minimap is drawn on a black void — ocean or out-of-bounds.
 *    Measuring "unused space" against the whole square image counts that void as unused map,
 *    which badly overstates the problem: naive coverage reads 43/37/33%, but against actual
 *    playable land it is 87/84/65%. Only Lockdown has meaningful dead space.
 *
 *    The mask is a 256x256 bit grid (8 KB per map, ~11 KB base64) embedded in meta.json, so
 *    the dead-space layer needs no extra fetch and no image decoding at runtime.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const SRC_DIR = join(ROOT, 'player_data', 'minimaps')
const OUT_DIR = join(ROOT, 'public', 'minimaps')

/** Render size for the shipped art. Balances zoomed-in detail against payload. */
const RENDER_SIZE = 2048
/** Mask resolution — 256x256 gives ~4 world-metres per cell on the largest map. */
const MASK_SIZE = 256
/** Luminance above which a pixel counts as playable land rather than void. */
const VOID_THRESHOLD = 28

const maps = JSON.parse(readFileSync(join(HERE, 'mapConfig.json'), 'utf8')).maps

/** Pack a boolean grid into bits, row-major, MSB first. */
function packBits(flags) {
  const out = new Uint8Array(Math.ceil(flags.length / 8))
  for (let i = 0; i < flags.length; i++) if (flags[i]) out[i >> 3] |= 0x80 >> (i & 7)
  return out
}

async function main() {
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true })
  const masks = {}

  for (const [id, cfg] of Object.entries(maps)) {
    const src = join(SRC_DIR, cfg.source.file)
    const meta = await sharp(src).metadata()

    // Flatten onto black first: the PNGs carry alpha, and without an explicit background
    // the transparent void would composite to white and defeat the luminance threshold.
    const base = sharp(src).flatten({ background: '#000000' }).resize(RENDER_SIZE, RENDER_SIZE, { fit: 'fill' })

    const outFile = join(OUT_DIR, `${id}.webp`)
    const info = await base.clone().webp({ quality: 82, effort: 5 }).toFile(outFile)

    // Mask: greyscale at mask resolution, threshold on luminance.
    const { data } = await sharp(src)
      .flatten({ background: '#000000' })
      .resize(MASK_SIZE, MASK_SIZE, { fit: 'fill' })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    const flags = new Array(MASK_SIZE * MASK_SIZE)
    let playable = 0
    for (let i = 0; i < flags.length; i++) {
      const on = data[i] > VOID_THRESHOLD
      flags[i] = on
      if (on) playable++
    }
    masks[id] = {
      size: MASK_SIZE,
      threshold: VOID_THRESHOLD,
      playableCells: playable,
      playableFraction: +(playable / flags.length).toFixed(4),
      bits: Buffer.from(packBits(flags)).toString('base64'),
    }

    const srcKB = readFileSync(src).length / 1e6
    console.log(
      `${id.padEnd(15)} ${meta.width}x${meta.height} ${srcKB.toFixed(1)} MB` +
      `  →  ${RENDER_SIZE}x${RENDER_SIZE} webp ${(info.size / 1e3).toFixed(0)} KB` +
      `  ·  playable ${(playable / flags.length * 100).toFixed(0)}%`
    )
  }

  writeFileSync(join(HERE, 'masks.json'), JSON.stringify(masks))
  const total = Object.keys(masks).length
  console.log(`\nWrote ${total} minimaps + masks.json`)
}

main().catch((err) => { console.error(err); process.exit(1) })
