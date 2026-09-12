import { eventStyle, legendColor } from '../map/layers'
import { shapeSvg } from '../map/theme'
import type { ShapeName } from '../map/theme'

export type LayerId = 'traffic' | 'dwell' | 'loot' | 'kills' | 'deaths' | 'dead' | 'paths' | 'actors'

export interface LayerDef {
  id: LayerId
  label: string
  hint: string
}

/**
 * The layer catalogue.
 *
 * Traffic and dwell are deliberately two entries rather than one "density" control. Position
 * samples are taken on a timer, so a player standing still for a minute produces about twelve
 * of them where a sprinter passing through produces two. A single blended map conflates
 * "everyone comes through here" with "one person parked here", which are opposite design
 * problems: the first is a corridor, the second is a camping spot or somewhere players get
 * stuck. Splitting them is the whole reason the aggregation has two modes.
 */
export const LAYERS: LayerDef[] = [
  { id: 'traffic', label: 'Traffic',    hint: 'How many players pass through each area' },
  { id: 'dwell',   label: 'Dwell',      hint: 'How long players stay, weighted by time' },
  { id: 'loot',    label: 'Loot',       hint: '80% of all recorded activity' },
  { id: 'kills',   label: 'Kills',      hint: 'Almost entirely against bots' },
  { id: 'deaths',  label: 'Deaths',     hint: 'Split by cause: bot, storm or player' },
  { id: 'dead',    label: 'Dead space', hint: 'Playable ground nobody visited' },
  { id: 'paths',   label: 'Paths',      hint: 'Individual routes, broken where sampling stopped' },
  { id: 'actors',  label: 'Positions',  hint: 'Raw position samples' },
]

interface Props {
  active: Set<LayerId>
  onToggle: (id: LayerId) => void
  counts: Partial<Record<LayerId, number>>
}

export default function LayerPanel({ active, onToggle, counts }: Props) {
  return (
    <aside
      aria-label="Layers"
      style={{
        width: '100%', background: 'var(--bg-1)', border: '1px solid var(--line)',
        borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-2)', overflow: 'hidden',
      }}
    >
      <PanelHeading>Layers</PanelHeading>
      <div style={{ padding: 'var(--space-2)', display: 'grid', gap: 1 }}>
        {LAYERS.map((l) => (
          <label key={l.id} className="layer-row" title={l.hint}>
            <input
              type="checkbox"
              checked={active.has(l.id)}
              onChange={() => onToggle(l.id)}
            />
            <span style={{ flex: 1 }}>{l.label}</span>
            {counts[l.id] !== undefined && (
              <span className="num" style={{ color: 'var(--text-3)', fontSize: 'var(--text-xs)' }}>
                {counts[l.id]!.toLocaleString()}
              </span>
            )}
          </label>
        ))}
      </div>

      <PanelHeading>Legend</PanelHeading>
      <div style={{ padding: 'var(--space-2) var(--space-3) var(--space-3)', display: 'grid', gap: 6 }}>
        <LegendMarker event="Loot" />
        <LegendMarker event="BotKill" />
        <LegendMarker event="BotKilled" />
        <LegendMarker event="KilledByStorm" />
        <LegendMarker event="Kill" />

        <LegendRule />

        <LegendLine token="--actor-human" label="Human" />
        <LegendLine token="--actor-bot" label="Bot" dashed />

        <LegendRule />

        <LegendRamp label="Traffic" prefix="--heat-traffic" />
        <LegendRamp label="Dwell" prefix="--heat-dwell" />
        <LegendSwatch token="--ev-unknown" label="Dead space" alpha={0.35} />
      </div>
    </aside>
  )
}

function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 style={{
      margin: 0, padding: '7px var(--space-3) 6px',
      fontSize: 'var(--text-xs)', fontWeight: 500,
      letterSpacing: 'var(--tracking-wide)', textTransform: 'uppercase',
      color: 'var(--text-3)', background: 'var(--bg-2)',
      borderBottom: '1px solid var(--line)', borderTop: '1px solid var(--line)',
    }}>
      {children}
    </h2>
  )
}

const LegendRule = () => <div style={{ height: 1, background: 'var(--line)', margin: '2px 0' }} />

function LegendMarker({ event }: { event: string }) {
  const s = eventStyle(event)
  return (
    <LegendRow label={s.label}>
      <Shape shape={s.shape} color={legendColor(s.color)} />
    </LegendRow>
  )
}

function Shape({ shape, color }: { shape: ShapeName; color: string }) {
  return (
    <span
      aria-hidden="true"
      style={{ display: 'inline-flex', width: 13, height: 13 }}
      dangerouslySetInnerHTML={{
        __html: `<svg width="13" height="13" viewBox="0 0 13 13">${shapeSvg(shape, color, 13)}</svg>`,
      }}
    />
  )
}

function LegendLine({ token, label, dashed }: { token: string; label: string; dashed?: boolean }) {
  return (
    <LegendRow label={label}>
      <span aria-hidden="true" style={{ display: 'inline-flex', width: 13, height: 13, alignItems: 'center' }}>
        <span style={{
          width: 13, height: 0,
          borderTop: `2px ${dashed ? 'dashed' : 'solid'} ${legendColor(token)}`,
        }} />
      </span>
    </LegendRow>
  )
}

function LegendSwatch({ token, label, alpha = 1 }: { token: string; label: string; alpha?: number }) {
  return (
    <LegendRow label={label}>
      <span aria-hidden="true" style={{
        width: 13, height: 11, borderRadius: 2,
        background: legendColor(token), opacity: alpha,
      }} />
    </LegendRow>
  )
}

function LegendRamp({ label, prefix }: { label: string; prefix: string }) {
  const stops = [1, 2, 3, 4].map((i) => legendColor(`${prefix}-${i}`))
  return (
    <LegendRow label={label}>
      <span aria-hidden="true" style={{
        width: 13, height: 11, borderRadius: 2,
        background: `linear-gradient(90deg, ${stops.join(',')})`,
      }} />
    </LegendRow>
  )
}

function LegendRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
      fontSize: 'var(--text-xs)', color: 'var(--text-2)',
    }}>
      {children}
      <span>{label}</span>
    </div>
  )
}
