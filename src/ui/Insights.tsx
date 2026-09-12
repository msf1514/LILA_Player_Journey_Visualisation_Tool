import { useMemo } from 'react'
import type { Store } from '../data/store'
import { computeInsights, type Insight } from './insightsData'
import type { ViewState } from '../state/url'

/**
 * Insights panel — deterministic findings, each a sentence you can open.
 *
 * The list is computed from the data every render, so it never drifts from what the bundle holds.
 * Clicking a row applies the view that demonstrates the claim, which also updates the URL, so a
 * finding is one click to see and one copy to share.
 */
export default function Insights({
  store, onApply,
}: {
  store: Store
  onApply: (view: ViewState, tab: Insight['tab']) => void
}) {
  const insights = useMemo(() => computeInsights(store), [store])

  return (
    <aside className="panel insights" aria-label="Insights">
      <h2 className="hs-title">What the data says</h2>
      <p className="hs-sub">
        Findings computed from this bundle. Open one to see the view that shows it.
      </p>
      <ul className="in-list" role="list">
        {insights.map((it) => (
          <li key={it.id}>
            <button type="button" className="in-row" onClick={() => onApply(it.view, it.tab)}>
              <span className="in-text">{it.text}</span>
              <span className="in-open" aria-hidden="true">Open view</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  )
}
