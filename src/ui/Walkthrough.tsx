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
}

interface Rect { top: number; left: number; width: number; height: number }

const PAD = 6

export default function Walkthrough({ steps, open, onClose }: { steps: TourStep[]; open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

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

  // On open, and whenever the step changes, place the spotlight. Skip missing anchors forward.
  useLayoutEffect(() => {
    if (!open) return
    const found = resolveFrom(i, 1)
    if (!found) { onClose(); return }
    if (found.idx !== i) { setI(found.idx); return }
    setRect(found.r)
  }, [open, i, resolveFrom, onClose])

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

  const go = useCallback((dir: 1 | -1) => {
    const next = resolveFrom(i + dir, dir)
    if (next) setI(next.idx)
    else if (dir === 1) onClose()
  }, [i, resolveFrom, onClose])

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
