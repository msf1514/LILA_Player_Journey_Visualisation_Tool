/**
 * transform.mjs — the single source of truth for interpreting LILA BLACK telemetry.
 *
 * This module is imported by BOTH:
 *   - `pipeline/build.mjs`  (build time, Node)   — bakes the shipped bundle
 *   - `src/data/ingest.ts`  (runtime, browser)   — parses files a user drops in
 *
 * That sharing is deliberate. If the two paths had separate implementations they would
 * drift, and dropped-in data would silently disagree with baked-in data — the worst kind
 * of bug, because nothing errors and the numbers are just quietly wrong.
 *
 * Keep this file dependency-free and platform-neutral (no `node:` imports).
 *
 * ---------------------------------------------------------------------------
 * THE FOUR DATA TRAPS  (the assignment brief names exactly these four:
 * "coordinate mapping, bytes encoding, bot detection, timestamps")
 *
 *  A. TIMESTAMPS   `ts` holds epoch SECONDS inside a `timestamp[ms]` column.
 *                  Read naively it reports January 1970. Multiply by 1000.
 *                  Verified: doing so aligns dates to the day-folder names at 99.5%
 *                  across all five folders. The dataset README's claim that ts is
 *                  "time elapsed within the match, not wall-clock" is incorrect.
 *                  Consequence: true resolution is 1 SECOND. Sub-second decimals
 *                  produced by a naive read are an artifact, not precision.
 *
 *  B. BYTES        `event` is a parquet BYTE_ARRAY. Python needs .decode('utf-8').
 *                  hyparquet auto-decodes to string, so JS gets this free — but we
 *                  still normalise defensively, since a dropped-in file could differ.
 *
 *  C. BOT DETECTION  Only the shape of `user_id` is reliable: UUID = human,
 *                  short numeric = bot. The dataset README's rule ("bots generate
 *                  BotPosition/BotKill/BotKilled") is WRONG — measured in the data,
 *                  bots emit 636 `Position` and 115 `Loot` rows, and humans emit
 *                  403 `BotKilled`. Three accounts are genuinely ambiguous; see
 *                  AMBIGUOUS_USER_IDS below.
 *
 *  D. COORDINATES  u = (x - originX) / scale ; v = (z - originZ) / scale
 *                  px = u * W ; py = (1 - v) * H   (image origin is top-left)
 *                  Use x and z ONLY — `y` is elevation, not a 2D map coordinate.
 *                  Verified: 0.00% of 89,104 rows fall outside [0,1] on any map.
 * ---------------------------------------------------------------------------
 */

// ─── A. Timestamps ──────────────────────────────────────────────────────────

/** `ts` is epoch seconds stored in a millisecond-typed column. */
export const TS_SCALE = 1000

/**
 * Convert a raw `ts` value to real epoch milliseconds.
 * Accepts whatever the parquet reader hands back: Date (hyparquet), number, or bigint.
 * @returns {number} epoch milliseconds
 */
export function normalizeTs(raw) {
  let n
  if (raw instanceof Date) n = raw.getTime()
  else if (typeof raw === 'bigint') n = Number(raw)
  else n = Number(raw)
  if (!Number.isFinite(n)) throw new TypeError(`unreadable ts: ${String(raw)}`)
  return n * TS_SCALE
}

// ─── C. Bot detection ───────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Accounts whose events contradict their id shape. Measured across the full dataset:
 *   1429 — emits BOTH `Position` and `BotPosition`, plus `Loot`/`BotKill`/`BotKilled`.
 *          890 rows over 17 matches. The only account in the data that does this.
 *   1379 — numeric id, but emits only human-type events (`Position`, `Loot`). 27 rows.
 *   1402 — numeric id, but emits only `Position`. 26 rows.
 * Together 751 rows = 0.84% of the dataset.
 *
 * We keep the id-shape rule authoritative (so behaviour is predictable and explainable)
 * and FLAG these rather than silently reclassifying them. The UI can surface the caveat.
 */
export const AMBIGUOUS_USER_IDS = new Set(['1429', '1379', '1402'])

/** True when `user_id` is a bot id (short numeric) rather than a human UUID. */
export function isBot(userId) {
  return !UUID_RE.test(String(userId))
}

/** True for the three accounts whose events contradict their id shape. */
export function isAmbiguousActor(userId) {
  return AMBIGUOUS_USER_IDS.has(String(userId))
}

// ─── B. Event taxonomy ──────────────────────────────────────────────────────

/**
 * Event semantics, per the dataset README, stated from the perspective of the file's owner:
 *   Position      — a human's position sample
 *   BotPosition   — a bot's position sample
 *   Kill          — this player killed another HUMAN
 *   Killed        — this player was killed by another HUMAN
 *   BotKill       — this player killed a BOT
 *   BotKilled     — this player was killed by a BOT
 *   KilledByStorm — this player died to the storm
 *   Loot          — this player picked up an item
 *
 * `category` drives layer routing; `marker` and `tone` drive rendering. Shapes differ as
 * well as colours so the map stays readable for colour-blind users.
 */
export const EVENTS = {
  Position:      { category: 'position', label: 'Position',        marker: null,      tone: 'human' },
  BotPosition:   { category: 'position', label: 'Bot position',    marker: null,      tone: 'bot' },
  Loot:          { category: 'loot',     label: 'Loot pickup',     marker: 'square',  tone: 'loot' },
  Kill:          { category: 'kill',     label: 'Kill (player)',   marker: 'diamond', tone: 'danger', pvp: true },
  BotKill:       { category: 'kill',     label: 'Kill (bot)',      marker: 'triangle',tone: 'danger' },
  Killed:        { category: 'death',    label: 'Death (player)',  marker: 'cross',   tone: 'danger', pvp: true, cause: 'pvp' },
  BotKilled:     { category: 'death',    label: 'Death (bot)',     marker: 'cross',   tone: 'danger', cause: 'bot' },
  KilledByStorm: { category: 'death',    label: 'Death (storm)',   marker: 'hexagon', tone: 'storm',  cause: 'storm' },
}

/** Fallback for event names not seen during development — render, never throw (D10). */
export const UNKNOWN_EVENT = { category: 'unknown', label: 'Unknown event', marker: 'circle', tone: 'muted' }

/**
 * Describe an event name. Unknown names degrade gracefully.
 * The telemetry currently has no `Extracted` event despite the game being an extraction
 * shooter; when LILA adds one, this must render it rather than break.
 */
export function describeEvent(name) {
  return EVENTS[name] ?? { ...UNKNOWN_EVENT, label: String(name) }
}

/** Normalise `event` to a string regardless of how the reader surfaced it. */
export function normalizeEvent(raw) {
  if (typeof raw === 'string') return raw
  if (raw instanceof Uint8Array) return new TextDecoder().decode(raw)
  if (raw && typeof raw === 'object' && 'buffer' in raw) {
    return new TextDecoder().decode(new Uint8Array(raw.buffer, raw.byteOffset ?? 0, raw.byteLength))
  }
  return String(raw)
}

export const isPositionEvent = (n) => describeEvent(n).category === 'position'
export const isDeathEvent    = (n) => describeEvent(n).category === 'death'
export const isKillEvent     = (n) => describeEvent(n).category === 'kill'

// ─── D. Coordinates ─────────────────────────────────────────────────────────

/**
 * World (x, z) → normalised UV in [0, 1].
 * `y` is elevation and is deliberately not used for 2D placement.
 * @param {{scale:number, originX:number, originZ:number}} cfg
 */
export function worldToUV(x, z, cfg) {
  return { u: (x - cfg.originX) / cfg.scale, v: (z - cfg.originZ) / cfg.scale }
}

/**
 * UV → image pixel. V is flipped because image origin is top-left while world Z grows "up".
 *
 * Width/height are parameters, never assumed: the supplied minimaps are 4320x4320,
 * 2160x2158 (not square) and 9000x9000 — the dataset README's "1024x1024" is wrong.
 */
export function uvToPixel(u, v, width, height) {
  return { px: u * width, py: (1 - v) * height }
}

/** Convenience: world → pixel in one step. */
export function worldToPixel(x, z, cfg, width, height) {
  const { u, v } = worldToUV(x, z, cfg)
  return uvToPixel(u, v, width, height)
}

export const isInBounds = (u, v) => u >= 0 && u <= 1 && v >= 0 && v <= 1

// ─── Row normalisation ──────────────────────────────────────────────────────

/**
 * Turn one raw parquet row into the canonical shape used everywhere downstream.
 * @param {object} row  raw row from the parquet reader
 * @param {object} mapConfig  full map config keyed by map_id
 */
export function normalizeRow(row, mapConfig) {
  const mapId = String(row.map_id)
  const cfg = mapConfig[mapId]
  if (!cfg) throw new Error(`no map config for "${mapId}" — add it to pipeline/mapConfig.json`)

  const userId = String(row.user_id)
  const event = normalizeEvent(row.event)
  const { u, v } = worldToUV(row.x, row.z, cfg)

  return {
    userId,
    matchId: String(row.match_id),
    mapId,
    x: row.x,
    y: row.y,          // elevation — kept for filtering/QA, never used for 2D placement
    z: row.z,
    u,
    v,
    t: normalizeTs(row.ts),
    event,
    bot: isBot(userId),
    ambiguous: isAmbiguousActor(userId),
    inBounds: isInBounds(u, v),
  }
}

// ─── Journey / path construction ────────────────────────────────────────────

/**
 * Position sampling is roughly every 5s (median), but the largest observed gap is 518s.
 * Interpolating across a gap that size draws a straight line through geometry the player
 * never crossed. A level designer who spots one such line stops trusting the tool — and
 * usually never says so. Paths are therefore split into segments at gaps beyond this.
 */
export const PATH_GAP_MS = 30_000

/**
 * Split time-ordered points into continuous segments, breaking on sampling gaps.
 * @param {Array<{t:number}>} points  must be sorted ascending by `t`
 */
export function splitOnGaps(points, gapMs = PATH_GAP_MS) {
  if (points.length === 0) return []
  const segments = []
  let current = [points[0]]
  for (let i = 1; i < points.length; i++) {
    if (points[i].t - points[i - 1].t > gapMs) {
      segments.push(current)
      current = []
    }
    current.push(points[i])
  }
  segments.push(current)
  return segments
}

// ─── Combat counting ────────────────────────────────────────────────────────

/**
 * Count combat by distinct (file, timestamp) INSTANT rather than by row.
 *
 * Two independent reasons:
 *  1. `Kill` and `Killed` are written as a PAIR into the same file at the same instant for
 *     one incident. Counting rows double-counts: the dataset's 3 `Kill` + 3 `Killed` rows
 *     are 3 events, not 6.
 *  2. `ts` resolution is 1 second, so a genuine multi-kill within one second collapses.
 *     Measured: 42 instants carry 2 `BotKill` rows and 6 carry 3.
 *
 * Note the counterpart rule in build.mjs: identical rows must NOT be de-duplicated, because
 * 2,364 byte-identical `Loot` rows across 449 files are legitimate same-second stack pickups.
 */
export function countCombatInstants(rows, keyFn = (r) => `${r.file}|${r.t}`) {
  const seen = new Set()
  for (const r of rows) if (isKillEvent(r.event) || isDeathEvent(r.event)) seen.add(keyFn(r))
  return seen.size
}
