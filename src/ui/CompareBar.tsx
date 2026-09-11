import type { Store } from '../data/store'
import type { Filter } from '../data/types'

export type CompareMode = 'single' | 'diff' | 'side'
export type CompareDim = 'day' | 'map' | 'actor' | 'match'

/**
 * Comparison controls.
 *
 * A designer's recurring question is "did my change work", which needs a before and an after.
 * The difference view is primary because two heatmaps placed side by side are genuinely hard
 * to diff by eye: the change is the thing being looked for, so the change should be the
 * picture. Side-by-side stays available for context.
 *
 * The B side is defined as "A, but with one dimension swapped". Letting both sides be edited
 * freely sounds more powerful and mostly produces comparisons that differ in three ways at
 * once, which answers nothing.
 */

export interface CompareBarProps {
  store: Store
  mode: CompareMode
  dim: CompareDim
  /** The B-side value for the current dimension. */
  value: string | null
  filter: Filter
  /** Match counts for each side, shown because sample size decides whether a diff is readable. */
  countA: number
  countB: number
  onMode: (m: CompareMode) => void
  onDim: (d: CompareDim) => void
  onValue: (v: string | null) => void
}

export default function CompareBar({
  store, mode, dim, value, filter, countA, countB, onMode, onDim, onValue,
}: CompareBarProps) {
  const options = bOptions(store, dim, filter)

  return (
    <div className="compare-bar">
      <div role="radiogroup" aria-label="View mode" className="tl-modes">
        <ModeButton current={mode} value="single" onMode={onMode} title="One map">Single</ModeButton>
        <ModeButton current={mode} value="diff" onMode={onMode} title="Colour shows what changed">Difference</ModeButton>
        <ModeButton current={mode} value="side" onMode={onMode} title="Two maps, linked panning">Side by side</ModeButton>
      </div>

      {mode !== 'single' && (
        <>
          <label className="compare-label">
            Compare by
            <select
              className="rail-input compare-select"
              value={dim}
              onChange={(e) => { onDim(e.target.value as CompareDim); onValue(null) }}
            >
              <option value="day">Day</option>
              <option value="map">Map</option>
              <option value="actor">Actor</option>
              <option value="match">Match</option>
            </select>
          </label>

          <label className="compare-label">
            against
            <select
              className="rail-input compare-select"
              value={value ?? ''}
              onChange={(e) => onValue(e.target.value || null)}
            >
              <option value="">Choose</option>
              {options.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </label>

          {value && (
            <span className="compare-counts">
              <b className="num">{countA.toLocaleString()}</b> vs{' '}
              <b className="num">{countB.toLocaleString()}</b> matches
              {/*
                Sample size is shown because normalisation makes two differently-sized samples
                comparable without making a small one reliable. Below about 30 matches a single
                player's route is a large share of the total, and the delta reads as behaviour
                when it is noise.
              */}
              {Math.min(countA, countB) < 30 && (
                <span className="compare-warn">
                  {' '}· one side has under 30 matches, so treat small differences as noise
                </span>
              )}
            </span>
          )}
        </>
      )}

      {mode === 'diff' && (
        <span className="diff-legend" aria-label="Difference legend">
          <span className="diff-swatch diff-neg" aria-hidden="true" /> less
          <span className="diff-swatch diff-pos" aria-hidden="true" /> more
          <span className="compare-warn"> · share of activity, not raw counts</span>
        </span>
      )}
    </div>
  )
}

function ModeButton({
  current, value, onMode, title, children,
}: {
  current: CompareMode
  value: CompareMode
  onMode: (m: CompareMode) => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={current === value}
      tabIndex={current === value ? 0 : -1}
      className="tl-mode"
      title={title}
      onClick={() => onMode(value)}
    >
      {children}
    </button>
  )
}

/** Candidate B-side values for the chosen dimension, excluding whatever A already is. */
export function bOptions(
  store: Store,
  dim: CompareDim,
  filter: Filter,
): { value: string; label: string }[] {
  const mapId = filter.map ?? store.meta.dict.maps[0]

  if (dim === 'day') {
    const current = filter.dateFrom
    return store.dates
      .filter((d) => d !== current)
      .map((d) => ({ value: d, label: fmtDay(d) }))
  }

  if (dim === 'map') {
    return store.meta.dict.maps
      .filter((m) => m !== mapId)
      .map((m) => ({ value: m, label: store.meta.mapConfig[m].label }))
  }

  if (dim === 'actor') {
    const current = filter.actor ?? 'all'
    return (['all', 'human', 'bot'] as const)
      .filter((a) => a !== current)
      .map((a) => ({
        value: a,
        label: a === 'all' ? 'Humans and bots' : a === 'human' ? 'Humans only' : 'Bots only',
      }))
  }

  // Matches with more than one journey first: a single-journey match makes a thin comparison.
  const current = filter.matchIds?.[0]
  const out: { value: string; label: string; journeys: number }[] = []
  store.meta.matchMeta.forEach((m, i) => {
    const id = store.matchId(i)
    if (m.map !== mapId || id === current) return
    out.push({ value: id, label: `${id.slice(0, 8)} · ${m.journeys}j`, journeys: m.journeys })
  })
  out.sort((a, b) => b.journeys - a.journeys)
  return out.slice(0, 60).map(({ value, label }) => ({ value, label }))
}

/** Build the B filter from A by swapping exactly one dimension. */
export function makeFilterB(
  filter: Filter,
  dim: CompareDim,
  value: string,
): Filter {
  switch (dim) {
    case 'day':
      return { ...filter, dateFrom: value, dateTo: value }
    case 'map':
      // Swapping map also drops the match: a match id belongs to exactly one map.
      return { ...filter, map: value, matchIds: undefined }
    case 'actor':
      return { ...filter, actor: value === 'all' ? undefined : (value as 'human' | 'bot') }
    case 'match':
      return { ...filter, matchIds: [value] }
  }
}

const fmtDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  })
