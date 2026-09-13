import { useEffect, useState } from 'react'

/**
 * Tooltips — one global helper that explains any control marked with `data-tip`.
 *
 * A native `title` only appears on mouse hover, after a delay, and never on keyboard focus. This
 * shows a styled tooltip immediately on BOTH hover and focus, so a designer can learn what a
 * control does however they reach it. It reads the nearest `data-tip` ancestor of the event
 * target, so a whole control group can carry one explanation.
 */
interface Tip { text: string; x: number; y: number; above: boolean }

export default function Tooltips() {
  const [tip, setTip] = useState<Tip | null>(null)

  useEffect(() => {
    const show = (target: EventTarget | null) => {
      const el = target instanceof Element ? target.closest('[data-tip]') as HTMLElement | null : null
      const text = el?.getAttribute('data-tip')
      if (!el || !text) return
      const r = el.getBoundingClientRect()
      // Flip above when there is not enough room below (e.g. controls near the bottom edge).
      const above = r.bottom + 64 > window.innerHeight
      setTip({ text, x: Math.round(r.left + r.width / 2), y: Math.round(above ? r.top : r.bottom), above })
    }
    const hide = () => setTip(null)
    const onOver = (e: MouseEvent) => show(e.target)
    const onFocus = (e: FocusEvent) => show(e.target)
    const onOut = (e: MouseEvent) => {
      const to = e.relatedTarget
      if (!(to instanceof Element) || !to.closest('[data-tip]')) hide()
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }

    document.addEventListener('mouseover', onOver)
    document.addEventListener('mouseout', onOut)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', hide)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('mouseover', onOver)
      document.removeEventListener('mouseout', onOut)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', hide)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
    }
  }, [])

  if (!tip) return null
  return (
    <div
      className={tip.above ? 'tip tip-above' : 'tip'}
      role="tooltip"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.text}
    </div>
  )
}
