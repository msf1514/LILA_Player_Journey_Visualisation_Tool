import { useEffect, useRef, useState } from 'react'

/**
 * Copy the current view as a link.
 *
 * Small, and the single highest-leverage thing in the tool for whether anyone other than its
 * author uses it. A designer finds something, copies, pastes into Slack, and a colleague sees
 * the same filtered map rather than a description of it.
 *
 * The clipboard API can be refused: an insecure origin, a browser setting, or a permission
 * prompt the user dismisses. Failing silently would be the worst outcome, since the person
 * then pastes whatever was in their clipboard before. On rejection the URL is shown in a
 * selected field so it can be copied by hand.
 */
export default function CopyLink() {
  const [status, setStatus] = useState<'idle' | 'copied' | 'manual'>('idle')
  const [url, setUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const flash = (next: 'copied' | 'manual') => {
    setStatus(next)
    if (timer.current) clearTimeout(timer.current)
    if (next === 'copied') timer.current = setTimeout(() => setStatus('idle'), 2000)
  }

  const copy = async () => {
    const href = window.location.href
    setUrl(href)
    try {
      await navigator.clipboard.writeText(href)
      flash('copied')
    } catch {
      flash('manual')
      // Focus and select so the keyboard path is one Ctrl+C away.
      requestAnimationFrame(() => inputRef.current?.select())
    }
  }

  return (
    <span className="copy-link">
      <button
        type="button"
        className="map-control copy-btn"
        onClick={copy}
        aria-label="Copy a link to this view"
        title="Copy a link to this view"
      >
        {status === 'copied' ? 'Link copied' : 'Copy link'}
      </button>

      {/* Polite, so it is announced without interrupting whatever is being read. */}
      <span aria-live="polite" className="sr-only">
        {status === 'copied' ? 'Link copied to clipboard' : ''}
      </span>

      {status === 'manual' && (
        <span className="copy-manual">
          <label htmlFor="copy-manual-url">Copy failed. Select and copy:</label>
          <input
            id="copy-manual-url"
            ref={inputRef}
            className="rail-input"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="map-control" onClick={() => setStatus('idle')}>
            Close
          </button>
        </span>
      )}
    </span>
  )
}
