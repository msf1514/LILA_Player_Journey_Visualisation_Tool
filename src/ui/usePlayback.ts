import { useEffect, useRef, useState } from 'react'

/**
 * Playback clock.
 *
 * Driven by requestAnimationFrame with real elapsed-time deltas rather than a setInterval
 * tick. An interval drifts, and worse, it ties playback speed to how fast frames happen to
 * be rendering: the same run would play at different speeds on different machines, and
 * slower when the map is busy. Integrating against wall-clock time keeps 1x meaning one
 * second of match time per second of real time whatever the frame rate.
 *
 * Pauses when the tab is hidden. rAF stops firing in a background tab anyway, so without
 * this the clock would silently jump forward on return.
 */
export function usePlayback(
  playing: boolean,
  speed: number,
  max: number,
  onTick: (next: number) => void,
  onEnd: () => void,
) {
  /**
   * The clock's own position, integrated in real time.
   *
   * It is deliberately NOT synced from React state on every render. An earlier version did
   * exactly that, and playback ran at half speed: each frame advanced the ref, called
   * setState, and then a render-phase effect wrote the (older, not-yet-committed) state
   * value back over the ref, cancelling roughly half of every step. The clock owns this
   * value; callers push into it only when they seek.
   */
  const tRef = useRef(0)
  const onTickRef = useRef(onTick)
  const onEndRef = useRef(onEnd)
  onTickRef.current = onTick
  onEndRef.current = onEnd

  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()

    const step = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const next = tRef.current + dt * speed
      if (next >= max) {
        // Stop at the end rather than looping. A silent loop makes a designer think the
        // late-game map is busier than it is, because they see the start again.
        tRef.current = max
        onTickRef.current(max)
        onEndRef.current()
        return
      }
      tRef.current = next
      onTickRef.current(next)
      raf = requestAnimationFrame(step)
    }

    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed, max])

  useEffect(() => {
    const onVisibility = () => { if (document.hidden) onEndRef.current() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  /**
   * Push an externally chosen position into the clock. Use when the user seeks or resets.
   *
   * The returned object is stable across renders. Returning a fresh literal made it unusable
   * as an effect dependency: the identity changed every render, so any effect depending on it
   * re-ran forever.
   */
  const api = useRef({ tRef, seek: (next: number) => { tRef.current = next } })
  return api.current
}

/**
 * Follow a fast-changing value at a limited rate, always settling on the final value.
 *
 * Scrubbing changes the time many times a second, and each change costs a filter pass plus,
 * for the heat layers, a raster. Recomputing per frame would drop the scrubber's own
 * responsiveness, which is the one thing that must stay immediate.
 *
 * So the scrubber thumb and the clock read the raw value, while the expensive work follows
 * this throttled one. The trailing update matters as much as the throttle: without it the
 * map would come to rest showing a slightly different time than the readout claims.
 */
export function useThrottled<T>(value: T, ms: number): T {
  const [out, setOut] = useState(value)
  const last = useRef(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const now = performance.now()
    const since = now - last.current

    if (since >= ms) {
      last.current = now
      setOut(value)
      return
    }

    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      last.current = performance.now()
      setOut(value)
    }, ms - since)

    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [value, ms])

  return out
}
