import { useMemo, useRef, useState } from 'react'
import type { Store } from '../data/store'
import type { Filter } from '../data/types'
import { eventStyle } from '../map/layers'

/**
 * Position events carry no marker, so they have no entry in the marker style table and fall
 * back to their raw name. Given a friendly label here so the list reads consistently rather
 * than mixing "Loot pickup" with "BotPosition".
 */
const EVENT_LABEL: Record<string, string> = {
  Position: 'Player position',
  BotPosition: 'Bot position',
}
const label = (name: string) => EVENT_LABEL[name] ?? eventStyle(name).label

export interface FilterRailProps {
  store: Store
  filter: Filter
  onChange: (next: Filter) => void
  /** Event counts under every filter EXCEPT the event filter, so a zero is meaningful. */
  eventCounts: Record<string, number>
}

/**
 * The filter rail.
 *
 * Sits in the horizontal space a square map cannot use on a wide screen, so it costs no
 * room the map wanted. Order runs widest to narrowest: map, then day, then match, then who,
 * then what. That matches how a designer actually narrows a question rather than how the
 * data happens to be shaped.
 */
export default function FilterRail({ store, filter, onChange, eventCounts }: FilterRailProps) {
  const set = (patch: Partial<Filter>) => onChange({ ...filter, ...patch })

  return (
    <aside className="rail" aria-label="Filters">
      <MapSection store={store} filter={filter} set={set} />
      <DaySection store={store} filter={filter} set={set} />
      <MatchSection store={store} filter={filter} set={set} />
      <ActorSection filter={filter} set={set} />
      <EventSection store={store} filter={filter} set={set} counts={eventCounts} />
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rail-section">
      <h2 className="rail-heading">{title}</h2>
      <div className="rail-body">{children}</div>
    </section>
  )
}

// ─── Map ────────────────────────────────────────────────────────────────────

/**
 * Match counts are shown because volume is wildly uneven: Ambrose Valley 566, Lockdown 171,
 * Grand Rift 59. Without the number, Grand Rift looks like a peer of the other two rather
 * than a map that has barely been played, and a designer would read its sparse heatmap as
 * player behaviour instead of as a small sample.
 */
function MapSection({ store, filter, set }: { store: Store; filter: Filter; set: (p: Partial<Filter>) => void }) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const m of store.meta.matchMeta) c[m.map] = (c[m.map] ?? 0) + 1
    return c
  }, [store])

  return (
    <Section title="Map">
      <RadioList
        label="Map"
        options={store.meta.dict.maps.map((id) => ({
          value: id,
          label: store.meta.mapConfig[id].label,
          count: counts[id] ?? 0,
        }))}
        value={filter.map ?? store.meta.dict.maps[0]}
        onChange={(v) => set({ map: v, matchIds: undefined })}
      />
    </Section>
  )
}

// ─── Day ────────────────────────────────────────────────────────────────────

const ALL_DAYS = '__all__'

/**
 * Single-day selection, defaulting to all days.
 *
 * The Filter type carries dateFrom/dateTo and the query layer honours an arbitrary range,
 * but the UI offers one day at a time on purpose. There are six days: a designer picks one
 * or looks at everything, and two range dropdowns would be fiddlier for a case that barely
 * arises. The range support stays in the data layer for the Phase 7 comparison view, which
 * genuinely needs it.
 */
function DaySection({ store, filter, set }: { store: Store; filter: Filter; set: (p: Partial<Filter>) => void }) {
  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const [date, matches] of store.matchesByDate) c[date] = matches.length
    return c
  }, [store])

  const selected = filter.dateFrom && filter.dateFrom === filter.dateTo ? filter.dateFrom : ALL_DAYS

  return (
    <Section title="Day">
      <RadioList
        label="Day"
        options={[
          { value: ALL_DAYS, label: 'All days', count: store.meta.matchMeta.length },
          ...store.dates.map((d) => ({ value: d, label: shortDate(d), count: counts[d] ?? 0 })),
        ]}
        value={selected}
        onChange={(v) =>
          set(v === ALL_DAYS ? { dateFrom: undefined, dateTo: undefined } : { dateFrom: v, dateTo: v })
        }
      />
    </Section>
  )
}

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  })

// ─── Match ──────────────────────────────────────────────────────────────────

/**
 * Match picker.
 *
 * 743 of 796 matches hold a single journey, so an alphabetical list would keep dropping a
 * designer into a match containing one lonely dot. The ~53 matches with more than one
 * participant are listed first under their own heading, and every row shows its journey
 * count so the difference is visible before clicking rather than after.
 */
function MatchSection({ store, filter, set }: { store: Store; filter: Filter; set: (p: Partial<Filter>) => void }) {
  const [query, setQuery] = useState('')
  const mapId = filter.map ?? store.meta.dict.maps[0]
  const selected = filter.matchIds?.[0]

  const { multi, single } = useMemo(() => {
    const q = query.trim().toLowerCase()
    const multi: number[] = []
    const single: number[] = []
    store.meta.matchMeta.forEach((m, i) => {
      if (m.map !== mapId) return
      if (filter.dateFrom && (m.date < filter.dateFrom || m.date > (filter.dateTo ?? filter.dateFrom))) return
      if (q && !store.matchId(i).toLowerCase().includes(q)) return
      ;(m.journeys > 1 ? multi : single).push(i)
    })
    multi.sort((a, b) => store.matchMeta(b).journeys - store.matchMeta(a).journeys)
    return { multi, single }
  }, [store, mapId, filter.dateFrom, filter.dateTo, query])

  const pick = (idx: number) => {
    const id = store.matchId(idx)
    set({ matchIds: selected === id ? undefined : [id] })
  }

  return (
    <Section title="Match">
      <input
        type="search"
        className="rail-input"
        placeholder="Search match id"
        aria-label="Search match id"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />

      {selected && (
        <button type="button" className="rail-clear" onClick={() => set({ matchIds: undefined })}>
          Showing one match. Show all
        </button>
      )}

      <div className="match-list" role="listbox" aria-label="Matches">
        {multi.length > 0 && <p className="match-group">Multiple participants ({multi.length})</p>}
        {multi.map((i) => (
          <MatchRow key={i} store={store} idx={i} selected={store.matchId(i) === selected} onPick={pick} />
        ))}

        {single.length > 0 && <p className="match-group">Single journey ({single.length})</p>}
        {single.slice(0, 60).map((i) => (
          <MatchRow key={i} store={store} idx={i} selected={store.matchId(i) === selected} onPick={pick} />
        ))}
        {single.length > 60 && (
          <p className="match-more">
            {(single.length - 60).toLocaleString()} more. Search to narrow.
          </p>
        )}

        {multi.length + single.length === 0 && (
          <p className="match-more">No matches on this map for the selected day.</p>
        )}
      </div>
    </Section>
  )
}

function MatchRow({
  store, idx, selected, onPick,
}: { store: Store; idx: number; selected: boolean; onPick: (i: number) => void }) {
  const m = store.matchMeta(idx)
  const id = store.matchId(idx).slice(0, 8)
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className="match-row"
      onClick={() => onPick(idx)}
    >
      <span className="num match-id">{id}</span>
      <span className="match-meta">
        <span className="num">{m.journeys}</span> {m.journeys === 1 ? 'journey' : 'journeys'}
        {' · '}
        <span className="num">{Math.round(m.duration / 60)}</span>m
      </span>
    </button>
  )
}

// ─── Actor ──────────────────────────────────────────────────────────────────

function ActorSection({ filter, set }: { filter: Filter; set: (p: Partial<Filter>) => void }) {
  return (
    <Section title="Actor">
      <RadioList
        label="Actor"
        options={[
          { value: 'all', label: 'Humans and bots' },
          { value: 'human', label: 'Humans only' },
          { value: 'bot', label: 'Bots only' },
        ]}
        value={filter.actor ?? 'all'}
        onChange={(v) => set({ actor: v === 'all' ? undefined : (v as 'human' | 'bot') })}
      />
    </Section>
  )
}

// ─── Events ─────────────────────────────────────────────────────────────────

/**
 * Event toggles with live counts.
 *
 * Counts come from the rows matching every filter EXCEPT this one, so a zero means "nothing
 * of this kind is here", not "you have it switched off". That distinction matters given how
 * lopsided this data is: 12,866 loot pickups against 3 player-versus-player kills, and a
 * designer needs to see that skew rather than infer it.
 */
function EventSection({
  store, filter, set, counts,
}: { store: Store; filter: Filter; set: (p: Partial<Filter>) => void; counts: Record<string, number> }) {
  const all = store.meta.dict.events
  const active = filter.events ? new Set(filter.events) : null

  const toggle = (name: string) => {
    const next = new Set(active ?? all)
    next.has(name) ? next.delete(name) : next.add(name)
    set({ events: next.size === all.length ? undefined : [...next] })
  }

  return (
    <Section title="Events">
      {active && (
        <button type="button" className="rail-clear" onClick={() => set({ events: undefined })}>
          Show all event types
        </button>
      )}
      <div className="event-list">
        {all.map((name) => (
          <label key={name} className="layer-row" title={label(name)}>
            <input
              type="checkbox"
              checked={active ? active.has(name) : true}
              onChange={() => toggle(name)}
            />
            <span style={{ flex: 1 }}>{label(name)}</span>
            <span className="num" style={{ color: 'var(--text-3)', fontSize: 'var(--text-xs)' }}>
              {(counts[name] ?? 0).toLocaleString()}
            </span>
          </label>
        ))}
      </div>
    </Section>
  )
}

// ─── Shared radio list ──────────────────────────────────────────────────────

/**
 * Single-select as a real radiogroup: arrow keys move, one tab stop, roving focus. A stack
 * of plain buttons would work and feel wrong to anyone navigating by keyboard.
 */
function RadioList({
  label, options, value, onChange,
}: {
  label: string
  options: { value: string; label: string; count?: number }[]
  value: string
  onChange: (v: string) => void
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  const move = (delta: number) => {
    const i = options.findIndex((o) => o.value === value)
    const next = (i + delta + options.length) % options.length
    onChange(options[next].value)
    refs.current[next]?.focus()
  }

  return (
    <div role="radiogroup" aria-label={label} className="radio-list">
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[i] = el }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          className="radio-row"
          onClick={() => onChange(o.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); move(1) }
            if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); move(-1) }
          }}
        >
          <span style={{ flex: 1 }}>{o.label}</span>
          {o.count !== undefined && (
            <span className="num radio-count">{o.count.toLocaleString()}</span>
          )}
        </button>
      ))}
    </div>
  )
}
