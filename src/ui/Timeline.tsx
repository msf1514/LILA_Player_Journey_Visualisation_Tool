import { useCallback, useEffect, useMemo, useRef } from 'react'

/**
 * Playback timeline on MATCH-ELAPSED time.
 *
 * Matches are independent sessions spread over five days, so wall-clock time aligns nothing.
 * Relative time does: scrub to minute 3 and the map shows where everyone was three minutes
 * into their match, aggregated across every match in the current filter.
 *
 * THE SURVIVORSHIP PROBLEM, and the reason half this component exists.
 *
 * Match durations are wildly uneven: p10 136s, median 382s, p90 720s. Scrub past the median
 * and the map thins out, but not because players stopped moving. Most matches had simply
 * ended. At 655s only about 140 of 796 matches are still running.
 *
 * A designer watching the map empty at minute 10 would reasonably conclude "late-game
 * traffic collapses" and argue for changing late pacing, and they would be wrong. Nothing in
 * the map itself reveals the error. So the live-match count and the density band along the
 * track are not decoration: they are what makes this feature honest rather than misleading.
 */

/** The storm's hard activation floor. No storm death in the dataset occurs before this. */
export const STORM_FLOOR_S = 655

/** Sliding-window width. About six position samples at the 5s median sampling interval. */
export const WINDOW_S = 30

export type TimeMode = 'cumulative' | 'window'

export interface TimelineProps {
  /** Current position in seconds. */
  t: number
  /** Maximum elapsed second on the axis. Clamps to one match's duration when one is picked. */
  max: number
  mode: TimeMode
  playing: boolean
  speed: number
  /** Sorted ascending match durations for the current filter, used for the survivor curve. */
  durations: number[]
  /** Total matches in the current filter. */
  totalMatches: number
  onSeek: (t: number) => void
  onMode: (m: TimeMode) => void
  onPlay: (playing: boolean) => void
  onSpeed: (s: number) => void
  onReset: () => void
  /** True when a single match is selected and the axis is that match's own duration. */
  singleMatch: boolean
  /** False when the scrubber sits at the end in cumulative mode, i.e. nothing is narrowed. */
  timeActive: boolean
}

const SPEEDS = [1, 2, 4, 8]
const TRACK_SAMPLES = 120

export default function Timeline({
  t, max, mode, playing, speed, durations, totalMatches,
  onSeek, onMode, onPlay, onSpeed, onReset, singleMatch, timeActive,
}: TimelineProps) {
  const rootRef = useRef<HTMLDivElement>(null)

  /** Matches still running at time `x`: those whose duration reaches it. */
  const survivors = useCallback(
    (x: number) => {
      // durations is sorted ascending, so everything from the first index >= x survives.
      let lo = 0, hi = durations.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if (durations[mid] < x) lo = mid + 1
        else hi = mid
      }
      return durations.length - lo
    },
    [durations],
  )

  const live = survivors(t)

  /** Density band: survivors sampled across the axis, normalised to the starting count. */
  const band = useMemo(() => {
    const base = durations.length || 1
    return Array.from({ length: TRACK_SAMPLES }, (_, i) =>
      survivors((i / (TRACK_SAMPLES - 1)) * max) / base)
  }, [survivors, durations.length, max])

  /** Space toggles play, as long as focus is not inside a text field. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const el = document.activeElement
      if (el instanceof HTMLInputElement && el.type !== 'range') return
      if (el instanceof HTMLTextAreaElement) return
      e.preventDefault()
      onPlay(!playing)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [playing, onPlay])

  const stormPct = max > 0 ? (STORM_FLOOR_S / max) * 100 : -1
  const showStorm = stormPct >= 0 && stormPct <= 100

  return (
    <div className="timeline" ref={rootRef}>
      <div className="tl-controls">
        <button
          type="button"
          className="map-control tl-play"
          onClick={() => onPlay(!playing)}
          aria-label={playing ? 'Pause' : 'Play'}
          title={playing ? 'Pause (space)' : 'Play (space)'}
        >
          {playing ? '❚❚' : '▶'}
        </button>

        <span className="num tl-clock">{mmss(t)}</span>

        <div role="radiogroup" aria-label="Playback speed" className="tl-speeds">
          {SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={s === speed}
              tabIndex={s === speed ? 0 : -1}
              className="tl-speed"
              onClick={() => onSpeed(s)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowRight') { e.preventDefault(); onSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length]) }
                if (e.key === 'ArrowLeft') { e.preventDefault(); onSpeed(SPEEDS[(SPEEDS.indexOf(speed) + SPEEDS.length - 1) % SPEEDS.length]) }
              }}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="tl-track-wrap">
        {/*
          Survivor density behind the scrubber. The track visibly thins toward the right,
          so the shrinking sample is apparent before anyone scrubs into it.
        */}
        <div className="tl-band" aria-hidden="true">
          {band.map((v, i) => (
            <span key={i} style={{ opacity: 0.12 + v * 0.88 }} />
          ))}
        </div>

        {showStorm && (
          <div
            className="tl-storm"
            style={{ left: `${stormPct}%` }}
            title="Storm activation floor. No storm death in this data occurs before 10:55."
          >
            <span className="tl-storm-label">storm</span>
          </div>
        )}

        {/*
          A native range input carries the keyboard behaviour for free: arrows step, Home and
          End jump to the ends, and it is announced correctly. The decoration sits behind it.
        */}
        <input
          type="range"
          className="tl-range"
          min={0}
          max={max}
          step={2}
          value={Math.min(t, max)}
          onChange={(e) => onSeek(Number(e.target.value))}
          aria-label="Match elapsed time"
          aria-valuetext={`${mmss(t)}, ${live} of ${totalMatches} matches running`}
        />
      </div>

      <div className="tl-meta">
        <div role="radiogroup" aria-label="Time mode" className="tl-modes">
          <button
            type="button" role="radio" aria-checked={mode === 'cumulative'}
            tabIndex={mode === 'cumulative' ? 0 : -1}
            className="tl-mode" onClick={() => onMode('cumulative')}
            title="Everything from match start up to this point"
          >
            Cumulative
          </button>
          <button
            type="button" role="radio" aria-checked={mode === 'window'}
            tabIndex={mode === 'window' ? 0 : -1}
            className="tl-mode" onClick={() => onMode('window')}
            title={`Only the ${WINDOW_S} seconds up to this point`}
          >
            Last {WINDOW_S}s
          </button>
        </div>

        {/*
          The count that stops the map being misread. Without it, a thinning map at minute 10
          looks like players going quiet rather than matches having ended.
        */}
        <span className="tl-live">
          {timeActive ? (
            <>
              <b className="num">{live.toLocaleString()}</b> of{' '}
              <b className="num">{totalMatches.toLocaleString()}</b> matches still running
              {!singleMatch && live < totalMatches && (
                <span className="tl-live-note"> · the rest have ended, so the map thins</span>
              )}
            </>
          ) : (
            <>
              Showing all <b className="num">{totalMatches.toLocaleString()}</b>{' '}
              {totalMatches === 1 ? 'match' : 'matches'}, full duration
            </>
          )}
        </span>

        <button type="button" className="map-control tl-reset" onClick={onReset}>
          Full match
        </button>
      </div>
    </div>
  )
}

export const mmss = (s: number) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.round(s) % 60).padStart(2, '0')}`
