import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Walkthrough — a first-run guided tour.
 *
 * Each step spotlights a real element and says what it does. It replaces the old one-line hint:
 * a first-time visitor is walked through the map, the panels, the filters, the timeline and the
 * comparison and disclosure controls in order, rather than left to hunt.
 *
 * Anchors are resolved by selector at display time, so a step whose element is not on screen (a
 * panel closed, a different mode) is skipped rather than crashing or pointing at nothing. The
 * spotlight is a single element with a large box-shadow that dims everything else; a transparent
 * catcher swallows clicks so only the tour controls drive it.
 */

export interface TourStep {
  sel: string
  title: string
  text: string
  /** Panel tab this step needs visible; the host opens the panel and selects it first. */
  tab?: 'layers' | 'hotspots' | 'insights'
  /** True when the step's anchor lives inside the collapsible panel. */
  needsPanel?: boolean
}

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 6

export default function Walkthrough({ steps, open, onClose, onStep }: {
  steps: TourStep[]
  open: boolean
  onClose: () => void
  /** Prepare the UI for a step (e.g. open the panel and select its tab) before it is placed. */
  onStep?: (step: TourStep) => void
}) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const onStepRef = useRef(onStep)
  onStepRef.current = onStep

  // Resolve the element for a step, skipping in `dir` over any that are not on screen. Returns
  // the resolved index and rect, or null when nothing from here on is resolvable.
  const resolveFrom = useCallback((start: number, dir: 1 | -1): { idx: number; r: Rect } | null => {
    for (let k = start; k >= 0 && k < steps.length; k += dir) {
      const el = document.querySelector(steps[k].sel)
      if (el) {
        const b = el.getBoundingClientRect()
        if (b.width > 0 && b.height > 0) return { idx: k, r: { top: b.top, left: b.left, width: b.width, height: b.height } }
      }
    }
    return null
  }, [steps])

  // On open, and whenever the step changes, prepare the UI for the step (open the panel, select
  // its tab), then place the spotlight on the next frame once that render has landed. Skip
  // anchors that are still absent forward.
  useLayoutEffect(() => {
    if (!open) return
    onStepRef.current?.(steps[i])
    const raf = requestAnimationFrame(() => {
      const found = resolveFrom(i, 1)
      if (!found) { onClose(); return }
      if (found.idx !== i) { setI(found.idx); return }
      setRect(found.r)
    })
    return () => cancelAnimationFrame(raf)
  }, [open, i, resolveFrom, onClose, steps])

  // Keep the spotlight aligned through resizes.
  useEffect(() => {
    if (!open) return
    const reflow = () => { const f = resolveFrom(i, 1); if (f) setRect(f.r) }
    window.addEventListener('resize', reflow)
    return () => window.removeEventListener('resize', reflow)
  }, [open, i, resolveFrom])

  // Reset to the first step each time the tour opens.
  useEffect(() => { if (open) setI(0) }, [open])

  useEffect(() => { if (open) cardRef.current?.focus() }, [open, i])

  // Advance by one and let the placement effect prepare the UI (open the panel, select the tab)
  // and only then skip anything still missing. Skipping here, before prep, would drop panel steps
  // whenever the panel is collapsed.
  const go = useCallback((dir: 1 | -1) => {
    const target = i + dir
    if (target < 0) return
    if (target >= steps.length) { onClose(); return }
    setI(target)
  }, [i, steps.length, onClose])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      else if (e.key === 'ArrowRight') { e.preventDefault(); go(1) }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1) }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, go, onClose])

  if (!open || !rect) return null

  const step = steps[i]
  const isLast = resolveFrom(i + 1, 1) === null

  // Place the card below the target if there is room, otherwise above; clamp to the viewport.
  const cardW = 300
  const below = rect.top + rect.height + 12
  const wantAbove = below + 150 > window.innerHeight
  const top = wantAbove ? Math.max(12, rect.top - 12 - 150) : below
  const left = Math.min(Math.max(12, rect.left + rect.width / 2 - cardW / 2), window.innerWidth - cardW - 12)

  return (
    <>
      <div className="wt-catch" onMouseDown={(e) => e.preventDefault()} />
      <div
        className="wt-spot"
        style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
      />
      <div
        ref={cardRef}
        className="wt-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wt-title"
        tabIndex={-1}
        style={{ top, left, width: cardW }}
      >
        <h3 id="wt-title" className="wt-title">{step.title}</h3>
        <p className="wt-text">{step.text}</p>
        <div className="wt-foot">
          <span className="wt-count num">{i + 1} of {steps.length}</span>
          <div className="wt-actions">
            <button type="button" className="map-control wt-btn" onClick={onClose}>Skip</button>
            {i > 0 && <button type="button" className="map-control wt-btn" onClick={() => go(-1)}>Back</button>}
            <button type="button" className="map-control wt-btn wt-next" onClick={() => go(1)}>
              {isLast ? 'Done' : 'Next'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
