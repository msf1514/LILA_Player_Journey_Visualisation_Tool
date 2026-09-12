import { useEffect, useRef, useState } from 'react'
import type { Store } from '../data/store'

/**
 * DataNotes — the disclosure surface.
 *
 * The single most important thing this tool says is what its data cannot show. Left in code
 * comments, that warning reaches nobody; a reviewer sees a confident heatmap of "combat" and
 * takes it for player-versus-player behaviour, which across five days and 796 matches happened
 * three times. So the caveats get a permanent button in the header and a panel that states them
 * in words before it shows a single number.
 *
 * Every figure is read from store.meta.stats and store.meta.matchMeta at render time. None is
 * typed in. If the bundle is rebuilt with new telemetry the panel updates itself, and it can
 * never drift from the data the way a hardcoded "3" would.
 *
 * The framing is deliberate. These are facts ABOUT THE DATA, not findings about the game, and
 * the panel must not read as a scoreboard. Numbers are muted, the lead is a plain-language
 * warning, and the section that could look like an achievement (loot volume) sits under a
 * heading that names it as the dataset's shape, not a result.
 */
export default function DataNotes({ store }: { store: Store }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="map-control data-notes-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        title="What this data can and cannot show"
      >
        <span aria-hidden="true" className="data-notes-mark">i</span>
        Data notes
      </button>
      {open && <DataNotesPanel store={store} onClose={() => { setOpen(false); triggerRef.current?.focus() }} />}
    </>
  )
}

interface Row { label: string; value: string; muted?: boolean }
interface Section { heading: string; note?: string; rows: Row[] }

function DataNotesPanel({ store, onClose }: { store: Store; onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)

  // Close on Escape; move focus into the panel on open. Return focus is handled by the caller.
  useEffect(() => {
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose() }
      if (e.key === 'Tab') trapFocus(e, panelRef.current)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const s = store.meta.stats
  const ec = s.eventCounts
  const mm = store.meta.matchMeta
  const n = (v: number) => v.toLocaleString()

  const totalMatches = mm.length
  const humanMatches = mm.filter((m) => m.humans >= 1).length
  const soloHuman = mm.filter((m) => m.humans === 1).length
  const multiJourney = mm.filter((m) => m.journeys > 1).length
  const pvpKills = ec.Kill ?? 0
  const botKills = ec.BotKill ?? 0

  const sections: Section[] = [
    {
      heading: 'Combat is against bots',
      note: 'Every combat layer in this tool is player-versus-bot. Read it that way.',
      rows: [
        { label: 'Kills against bots', value: n(botKills) },
        { label: 'Deaths to bots', value: n(ec.BotKilled ?? 0) },
        { label: 'Storm deaths', value: n(ec.KilledByStorm ?? 0) },
        { label: 'Kills against other players', value: n(pvpKills) },
      ],
    },
    {
      heading: 'The sample is effectively solo',
      note: 'These matches are one human among bots, not multiplayer sessions.',
      rows: [
        { label: 'Matches', value: n(totalMatches) },
        { label: 'Matches with exactly one human', value: `${n(soloHuman)} of ${n(humanMatches)}` },
        { label: 'Matches with more than one journey', value: `${n(multiJourney)} of ${n(totalMatches)}` },
      ],
    },
    {
      heading: 'What the loop actually is',
      note: 'Looting, not fighting, is the activity this data captures.',
      rows: [{ label: 'Loot pickups', value: n(ec.Loot ?? 0) }],
    },
    {
      heading: 'Cleaning and integrity',
      note: 'What was removed or flagged while building the bundle.',
      rows: [
        { label: 'Duplicate file removed', value: `${n(s.duplicateFilesSkipped.length)} of ${n(s.filesOnDisk)} (${n(s.rowsSkippedFromDuplicates)} rows)`, muted: true },
        { label: 'Accounts whose events contradict their id', value: s.ambiguousActors.length ? `${n(s.ambiguousActors.length)} (${s.ambiguousActors.join(', ')})` : '0', muted: true },
        { label: 'Coordinates outside the minimap', value: n(s.outOfBounds), muted: true },
      ],
    },
  ]

  return (
    <div className="dn-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div
        ref={panelRef}
        className="dn-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dn-title"
        tabIndex={-1}
      >
        <div className="dn-head">
          <h2 id="dn-title" className="dn-title">What this data can and cannot show</h2>
          <button type="button" className="map-control dn-close" onClick={onClose} aria-label="Close data notes">
            Close
          </button>
        </div>

        {/* The mandatory caveat, in words, before any figure. */}
        <p className="dn-lead">
          Combat across these five days is almost entirely against bots. Of the kills recorded,{' '}
          <b className="num">{n(botKills)}</b> are against bots and <b className="num">{n(pvpKills)}</b>{' '}
          are against other players. This dataset cannot answer questions about
          player-versus-player behaviour, and nothing here should be read as evidence about it.
        </p>

        <div className="dn-sections">
          {sections.map((sec) => (
            <section key={sec.heading} className="dn-section">
              <h3 className="dn-heading">{sec.heading}</h3>
              {sec.note && <p className="dn-secnote">{sec.note}</p>}
              <dl className="dn-rows">
                {sec.rows.map((r) => (
                  <div className="dn-row" key={r.label}>
                    <dt>{r.label}</dt>
                    <dd className={r.muted ? 'num dn-muted' : 'num'}>{r.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>

        <p className="dn-foot">
          Figures are read from the built bundle, not typed in, so they track the data as it is
          rebuilt.
        </p>
      </div>
    </div>
  )
}

/** Keep Tab focus inside the dialog. */
function trapFocus(e: KeyboardEvent, root: HTMLElement | null) {
  if (!root) return
  const focusable = root.querySelectorAll<HTMLElement>('button, [href], input, [tabindex]:not([tabindex="-1"])')
  if (!focusable.length) return
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const active = document.activeElement
  if (e.shiftKey && (active === first || active === root)) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
}

/**
 * First-run orientation hint.
 *
 * One line, shown once. It tells a designer what they are looking at, what to touch first, and
 * points at the data notes so the bot-combat caveat is seen before any conclusion is drawn.
 * Dismissal is remembered in localStorage, which can throw or be blocked, so every access is
 * guarded and the hint simply does not show if the flag cannot be read.
 */
const HINT_KEY = 'lila.orientation.dismissed.v1'

export function OrientationHint() {
  const [show, setShow] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(HINT_KEY) !== '1') setShow(true)
    } catch { /* storage blocked: leave the hint hidden rather than nagging every load */ }
  }, [])

  if (!show) return null

  const dismiss = () => {
    setShow(false)
    try { localStorage.setItem(HINT_KEY, '1') } catch { /* dismissal is best-effort */ }
  }

  return (
    <div className="orient-hint" role="note">
      <span>
        Aggregated telemetry across three maps. Pick a day on the left, toggle layers on the
        right. Combat is against bots — open data notes before drawing conclusions.
      </span>
      <button type="button" className="map-control orient-dismiss" onClick={dismiss}>
        Got it
      </button>
    </div>
  )
}
