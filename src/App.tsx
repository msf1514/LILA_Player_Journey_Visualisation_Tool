import { useEffect, useState } from 'react'
import { loadBundle } from './data/loader'
import { Store } from './data/store'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; store: Store; ms: number }

/**
 * Phase 2 checkpoint. This screen exists to prove the data runtime works end to end in a
 * real browser: the bundle loads, decodes, indexes, and the counts match the pipeline.
 * The map canvas and controls arrive in Phase 3 and will replace this entirely.
 */
export default function App() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    const t0 = performance.now()
    loadBundle()
      .then((bundle) => {
        if (cancelled) return
        setState({
          status: 'ready',
          store: new Store(bundle),
          ms: Math.round(performance.now() - t0),
        })
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setState({ status: 'error', message: err instanceof Error ? err.message : String(err) })
      })
    return () => { cancelled = true }
  }, [])

  if (state.status === 'loading') return <Centered>Loading telemetry</Centered>

  if (state.status === 'error') {
    return (
      <Centered>
        <p style={{ color: 'var(--ev-kill)', margin: 0 }}>Telemetry failed to load.</p>
        <p className="num" style={{ color: 'var(--text-3)', fontSize: 'var(--text-xs)' }}>
          {state.message}
        </p>
        <p style={{ color: 'var(--text-2)', fontSize: 'var(--text-sm)' }}>
          Run <code style={{ fontFamily: 'var(--font-mono)' }}>npm run build:data</code> to
          regenerate the bundle.
        </p>
      </Centered>
    )
  }

  const { store, ms } = state
  const s = store.meta.stats

  return (
    <main style={{ padding: 'var(--space-6)', maxWidth: 760, margin: '0 auto' }}>
      <header style={{ marginBottom: 'var(--space-6)' }}>
        <h1 style={{
          margin: 0, fontSize: 'var(--text-lg)', fontWeight: 600,
          letterSpacing: 'var(--tracking-tight)',
        }}>
          LILA BLACK telemetry
        </h1>
        <p style={{ margin: '4px 0 0', color: 'var(--text-2)', fontSize: 'var(--text-sm)' }}>
          Data runtime online. Map canvas lands in the next phase.
        </p>
      </header>

      <dl style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
        gap: 'var(--space-3)', margin: 0,
      }}>
        <Stat label="Rows" value={store.n.toLocaleString()} />
        <Stat label="Matches" value={s.matches.toLocaleString()} />
        <Stat label="Humans" value={s.humans.toLocaleString()} />
        <Stat label="Bots" value={s.bots.toLocaleString()} />
        <Stat label="Journeys" value={store.journeys.length.toLocaleString()} />
        <Stat label="Decoded in" value={`${ms} ms`} />
      </dl>

      <section style={{ marginTop: 'var(--space-6)' }}>
        <h2 style={{ fontSize: 'var(--text-md)', fontWeight: 500, margin: '0 0 var(--space-3)' }}>
          Events
        </h2>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 2 }}>
          {Object.entries(s.eventCounts)
            .sort((a, b) => b[1] - a[1])
            .map(([name, count]) => (
              <li key={name} style={{
                display: 'flex', justifyContent: 'space-between',
                padding: '5px var(--space-3)', background: 'var(--bg-1)',
                borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-sm)',
              }}>
                <span>{name}</span>
                <span className="num" style={{ color: 'var(--text-2)' }}>
                  {count.toLocaleString()}
                </span>
              </li>
            ))}
        </ul>
      </section>

      {/*
        The uncomfortable numbers stay visible rather than buried. A designer who discovers
        later that "kill zones" meant bots would stop trusting everything else on screen.
      */}
      <section style={{
        marginTop: 'var(--space-6)', padding: 'var(--space-4)',
        background: 'var(--bg-1)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', color: 'var(--text-2)',
      }}>
        <strong style={{ color: 'var(--text-1)', fontWeight: 500 }}>What this data can and cannot show</strong>
        <ul style={{ margin: '8px 0 0', paddingLeft: '1.1em', display: 'grid', gap: 4 }}>
          <li>
            <span className="num">{s.eventCounts.Kill ?? 0}</span> player-versus-player kills across
            all five days. Combat here is almost entirely against bots.
          </li>
          <li>
            <span className="num">{s.eventCounts.KilledByStorm ?? 0}</span> storm deaths. The storm
            reaches almost nobody.
          </li>
          <li>
            <span className="num">{s.duplicateFilesSkipped.length}</span> duplicate file removed
            (<span className="num">{s.rowsSkippedFromDuplicates}</span> rows).
          </li>
          <li>
            <span className="num">{s.ambiguousActors.length}</span> accounts have numeric ids but
            emit human events: <span className="num">{s.ambiguousActors.join(', ')}</span>.
          </li>
          <li>
            <span className="num">{s.outOfBounds}</span> coordinates fall outside the minimap.
          </li>
        </ul>
      </section>
    </main>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{
      background: 'var(--bg-1)', border: '1px solid var(--line)',
      borderRadius: 'var(--radius)', padding: 'var(--space-3)',
    }}>
      <dt style={{
        fontSize: 'var(--text-xs)', letterSpacing: 'var(--tracking-wide)',
        textTransform: 'uppercase', color: 'var(--text-3)',
      }}>
        {label}
      </dt>
      <dd className="num" style={{
        margin: '2px 0 0', fontSize: 'var(--text-xl)',
        letterSpacing: 'var(--tracking-tight)', color: 'var(--text-1)',
      }}>
        {value}
      </dd>
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      display: 'grid', placeItems: 'center', minHeight: '100dvh',
      textAlign: 'center', padding: 'var(--space-5)',
    }}>
      <div style={{ display: 'grid', gap: 'var(--space-2)', color: 'var(--text-2)' }}>{children}</div>
    </div>
  )
}
