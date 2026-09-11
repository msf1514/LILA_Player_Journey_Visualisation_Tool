/**
 * url.ts — the shareable view state.
 *
 * Pure functions, no React. Encoding and decoding live here so both can be tested by
 * round-tripping: encode a state, decode it back, and require the two to be identical. A
 * link that restores *almost* the right view is worse than one that fails loudly, because
 * the person who opens it has no way to tell.
 *
 * ── WHY MATCH IDS ARE WRITTEN OUT IN FULL ────────────────────────────────────
 * A match id is 45 characters. Encoding it as its dictionary index would cost two, and that
 * is exactly the trade not to take. Dictionary order comes from the build: it depends on
 * which files were read and in what order. Rebuild the bundle with a day of fresh telemetry
 * and index 214 is a different match. Every link already pasted into a document would then
 * point somewhere else, with no error and no warning, and would still look perfectly valid.
 *
 * A link is meant to survive being read three weeks later. Stable identifiers cost length;
 * indices cost correctness. Where the URL needs to be shorter, the KEYS get shortened, never
 * the identifiers.
 */

import type { Filter } from '../data/types'
import type { Store } from '../data/store'
import type { LayerId } from '../ui/LayerPanel'
import type { TimeMode } from '../ui/Timeline'
import type { CompareDim, CompareMode } from '../ui/CompareBar'

export interface ViewState {
  filter: Filter
  layers: LayerId[]
  timeMode: TimeMode
  /** Match-elapsed seconds, or null when the timeline covers the whole match. */
  t: number | null
  compareMode: CompareMode
  compareDim: CompareDim
  compareValue: string | null
}

const ALL_LAYERS: LayerId[] = ['traffic', 'dwell', 'loot', 'kills', 'deaths', 'dead', 'paths', 'actors']
const DEFAULT_LAYERS: LayerId[] = ['traffic', 'loot']
const TIME_MODES: TimeMode[] = ['cumulative', 'window']
const COMPARE_MODES: CompareMode[] = ['single', 'diff', 'side']
const COMPARE_DIMS: CompareDim[] = ['day', 'map', 'actor', 'match']

/** The view a visitor gets with no query string at all. */
export function defaultState(store: Store): ViewState {
  return {
    filter: { map: store.meta.dict.maps[0] },
    layers: [...DEFAULT_LAYERS],
    timeMode: 'cumulative',
    t: null,
    compareMode: 'single',
    compareDim: 'day',
    compareValue: null,
  }
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join() === [...b].sort().join()

/**
 * Encode only what differs from the default.
 *
 * The unfiltered view therefore produces a bare URL with no query string. That matters for
 * more than tidiness: a designer glancing at a pasted link can tell immediately whether it
 * carries a filter, and a view claiming to be "the whole map" looks like it.
 */
export function encodeState(state: ViewState, store: Store): URLSearchParams {
  const p = new URLSearchParams()
  const d = defaultState(store)
  const f = state.filter

  if (f.map && f.map !== d.filter.map) p.set('m', f.map)

  if (f.dateFrom) {
    p.set('d', f.dateTo && f.dateTo !== f.dateFrom ? `${f.dateFrom}..${f.dateTo}` : f.dateFrom)
  }
  if (f.matchIds?.length) p.set('x', f.matchIds.join(','))
  if (f.actor) p.set('a', f.actor)
  if (f.events) p.set('e', f.events.join(','))

  if (!sameSet(state.layers, d.layers)) p.set('l', [...state.layers].sort().join(','))
  if (state.timeMode !== d.timeMode) p.set('tm', state.timeMode)
  if (state.t !== null) p.set('t', String(Math.round(state.t)))

  if (state.compareMode !== d.compareMode) {
    p.set('c', state.compareMode)
    p.set('cd', state.compareDim)
    if (state.compareValue) p.set('cv', state.compareValue)
  }
  return p
}

export interface DecodeResult {
  state: ViewState
  /** Human-readable notes about anything this data could not honour. */
  dropped: string[]
}

/**
 * Decode a URL against the CURRENT data.
 *
 * Never throws. The bundle is rebuilt whenever new telemetry lands, so a link written last
 * month can legitimately name a match, map or event that no longer exists. The rule is to
 * restore everything still valid and say plainly what was dropped. Silently falling back to
 * an unfiltered view would be the worst outcome: the URL would claim one thing and the
 * screen would show another, and nobody would notice.
 */
export function decodeState(params: URLSearchParams, store: Store): DecodeResult {
  const state = defaultState(store)
  const dropped: string[] = []

  const map = params.get('m')
  if (map) {
    if (store.meta.dict.maps.includes(map)) state.filter.map = map
    else dropped.push(`map "${map}" is not in this data`)
  }

  const d = params.get('d')
  if (d) {
    const [from, to] = d.split('..')
    const known = (x: string) => store.dates.includes(x)
    if (known(from) && (!to || known(to))) {
      state.filter.dateFrom = from
      state.filter.dateTo = to ?? from
    } else {
      dropped.push(`date "${d}" is outside this data`)
    }
  }

  const x = params.get('x')
  if (x) {
    const ids = x.split(',').filter(Boolean)
    const ok = ids.filter((id) => store.meta.dict.matches.includes(id))
    const bad = ids.filter((id) => !store.meta.dict.matches.includes(id))
    if (ok.length) state.filter.matchIds = ok
    if (bad.length) dropped.push(`${bad.length} match ${bad.length === 1 ? 'id is' : 'ids are'} not in this data`)
  }

  const a = params.get('a')
  if (a === 'human' || a === 'bot') state.filter.actor = a
  else if (a) dropped.push(`actor "${a}" is not a valid value`)

  const e = params.get('e')
  if (e) {
    const names = e.split(',').filter(Boolean)
    const ok = names.filter((n) => store.meta.dict.events.includes(n))
    const bad = names.filter((n) => !store.meta.dict.events.includes(n))
    // An event filter that survives only partially would silently widen the view, so drop it
    // whole and say so rather than show more than the link asked for.
    if (bad.length) dropped.push(`event ${bad.length === 1 ? 'type' : 'types'} ${bad.join(', ')} ${bad.length === 1 ? 'no longer exists' : 'no longer exist'}`)
    if (ok.length && !bad.length) state.filter.events = ok
    else if (ok.length && bad.length) state.filter.events = ok
  }

  const l = params.get('l')
  if (l !== null) {
    const names = l.split(',').filter(Boolean)
    const ok = names.filter((n): n is LayerId => (ALL_LAYERS as string[]).includes(n))
    const bad = names.filter((n) => !(ALL_LAYERS as string[]).includes(n))
    state.layers = ok
    if (bad.length) dropped.push(`unknown ${bad.length === 1 ? 'layer' : 'layers'} ${bad.join(', ')}`)
  }

  const tm = params.get('tm')
  if (tm) {
    if (TIME_MODES.includes(tm as TimeMode)) state.timeMode = tm as TimeMode
    else dropped.push(`time mode "${tm}" is not valid`)
  }

  const t = params.get('t')
  if (t !== null) {
    const n = Number(t)
    if (Number.isFinite(n) && n >= 0) state.t = n
    else dropped.push(`time "${t}" is not a number`)
  }

  const c = params.get('c')
  if (c) {
    if (COMPARE_MODES.includes(c as CompareMode)) state.compareMode = c as CompareMode
    else dropped.push(`compare mode "${c}" is not valid`)
  }
  const cd = params.get('cd')
  if (cd) {
    if (COMPARE_DIMS.includes(cd as CompareDim)) state.compareDim = cd as CompareDim
    else dropped.push(`compare dimension "${cd}" is not valid`)
  }
  const cv = params.get('cv')
  if (cv) state.compareValue = cv

  return { state, dropped }
}

/** Serialise for comparison. Two states with the same string produce the same URL. */
export const stateKey = (state: ViewState, store: Store) => encodeState(state, store).toString()

/**
 * True when the only difference between two states is the timeline position.
 *
 * This is what separates a history entry from a silent replacement. The timeline changes on
 * every frame of a drag and of playback; pushing an entry per change would leave hundreds
 * and make the back button useless. Deriving the answer by comparing the encoded keys means
 * no component has to remember to flag itself as continuous.
 */
export function onlyTimeChanged(a: URLSearchParams, b: URLSearchParams): boolean {
  const keys = new Set([...a.keys(), ...b.keys()])
  let sawTimeDiff = false
  for (const k of keys) {
    if (a.get(k) === b.get(k)) continue
    if (k === 't') { sawTimeDiff = true; continue }
    return false
  }
  return sawTimeDiff
}
