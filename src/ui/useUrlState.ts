import { useEffect, useRef } from 'react'
import type { Store } from '../data/store'
import { decodeState, encodeState, onlyTimeChanged } from '../state/url'
import type { ViewState } from '../state/url'

/**
 * Keeps the URL in step with the view, and the view in step with the back button.
 *
 * ── THE HISTORY RULE ─────────────────────────────────────────────────────────
 * The timeline changes on every frame of a drag and of playback. Pushing a history entry per
 * change would leave several hundred entries behind a ten-second playback, and the back
 * button would take a hundred presses to leave the page.
 *
 * So: a change that touches ONLY the timeline position replaces the current entry; anything
 * else pushes a new one. The decision is derived by comparing the encoded parameters rather
 * than by asking components to flag themselves as continuous, which means a component added
 * later cannot forget to.
 *
 * Replacements are throttled as well. replaceState is cheap but not free, and browsers rate
 * limit it; at 60fps an unthrottled scrub would hit that ceiling.
 */

const REPLACE_THROTTLE_MS = 250

export function useUrlState(
  state: ViewState,
  store: Store,
  onPopState: (state: ViewState, dropped: string[]) => void,
) {
  const lastWritten = useRef<string | null>(null)
  const pendingReplace = useRef<ReturnType<typeof setTimeout> | null>(null)
  /** Set while applying a popstate, so restoring that view does not push it back on. */
  const applyingPop = useRef(false)
  const onPopRef = useRef(onPopState)
  onPopRef.current = onPopState

  useEffect(() => {
    const params = encodeState(state, store)
    const qs = params.toString()
    const url = qs ? `${location.pathname}?${qs}` : location.pathname

    if (applyingPop.current) {
      // The state we are seeing is the one the browser just navigated to. Record it so the
      // next real change compares against the right baseline, but write nothing.
      applyingPop.current = false
      lastWritten.current = qs
      return
    }

    if (lastWritten.current === qs) return

    const prev = new URLSearchParams(lastWritten.current ?? '')
    const timeOnly = lastWritten.current !== null && onlyTimeChanged(prev, params)
    lastWritten.current = qs

    if (timeOnly) {
      if (pendingReplace.current) clearTimeout(pendingReplace.current)
      pendingReplace.current = setTimeout(() => history.replaceState(null, '', url), REPLACE_THROTTLE_MS)
    } else {
      if (pendingReplace.current) { clearTimeout(pendingReplace.current); pendingReplace.current = null }
      // First write of the session replaces, so opening a link does not leave an extra entry
      // between the page load and the view it asked for.
      if (lastWritten.current !== null && prev.toString() === '' && qs === '') history.replaceState(null, '', url)
      else history.pushState(null, '', url)
    }
  }, [state, store])

  useEffect(() => {
    const onPop = () => {
      const { state: next, dropped } = decodeState(new URLSearchParams(location.search), store)
      applyingPop.current = true
      onPopRef.current(next, dropped)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [store])

  useEffect(() => () => { if (pendingReplace.current) clearTimeout(pendingReplace.current) }, [])
}

/** Read the view out of the address bar. Used once, to seed state on first render. */
export function readInitialState(store: Store) {
  return decodeState(new URLSearchParams(location.search), store)
}
