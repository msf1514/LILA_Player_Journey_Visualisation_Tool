import type { Store } from '../data/store'
import type { Filter } from '../data/types'
import { eventStyle } from '../map/layers'

/**
 * Active-filter chips.
 *
 * A filter rail can be scrolled past, collapsed, or simply forgotten after a few minutes of
 * looking at a map. The chips keep every narrowing visible in one line at the top, so nobody
 * draws a conclusion from a view they forgot was filtered. That is a real failure mode:
 * "nobody goes to the north end" is a very different claim if a single day is selected.
 *
 * Renders nothing when no filter is active, so the unfiltered state stays quiet.
 */
export interface FilterChipsProps {
  store: Store
  filter: Filter
  onChange: (next: Filter) => void
}

export default function FilterChips({ store, filter, onChange }: FilterChipsProps) {
  const chips: { key: string; label: string; clear: Partial<Filter> }[] = []

  if (filter.dateFrom) {
    const label =
      filter.dateTo && filter.dateTo !== filter.dateFrom
        ? `${fmt(filter.dateFrom)} to ${fmt(filter.dateTo)}`
        : fmt(filter.dateFrom)
    chips.push({ key: 'date', label, clear: { dateFrom: undefined, dateTo: undefined } })
  }

  if (filter.matchIds?.length) {
    chips.push({
      key: 'match',
      label: `Match ${filter.matchIds[0].slice(0, 8)}`,
      clear: { matchIds: undefined },
    })
  }

  if (filter.actor) {
    chips.push({
      key: 'actor',
      label: filter.actor === 'human' ? 'Humans only' : 'Bots only',
      clear: { actor: undefined },
    })
  }

  if (filter.events) {
    const n = filter.events.length
    const label =
      n === 1 ? eventStyle(filter.events[0]).label : `${n} of ${store.meta.dict.events.length} event types`
    chips.push({ key: 'events', label, clear: { events: undefined } })
  }

  if (chips.length === 0) return null

  return (
    <div className="chips" role="status" aria-label="Active filters">
      {chips.map((c) => (
        <button
          key={c.key}
          type="button"
          className="chip"
          onClick={() => onChange({ ...filter, ...c.clear })}
          aria-label={`Clear filter: ${c.label}`}
          title={`Clear filter: ${c.label}`}
        >
          <span>{c.label}</span>
          <span aria-hidden="true" className="chip-x">×</span>
        </button>
      ))}
      {chips.length > 1 && (
        <button
          type="button"
          className="chip chip-reset"
          onClick={() => onChange({ map: filter.map })}
        >
          Clear all
        </button>
      )}
    </div>
  )
}

const fmt = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  })
