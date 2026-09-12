import type { Store } from '../data/store'
import type { Cluster, Hotspots as HotspotsData } from '../map/hotspots'
import { mmss } from './Timeline'

/**
 * Hotspots panel — the drill-down that turns the map from a picture into an instrument.
 *
 * Three depths, one at a time: the ranked cluster list, the journeys through a chosen cluster,
 * and one run's detail. Two clicks take a reader from "where is it busy" to a single actor's
 * route drawn on the map.
 *
 * The list leads with the uncomfortable truth rather than hiding it: traffic here is not
 * concentrated, so the busiest cluster is only a few percent of it and the ranks below it are
 * all but tied. Every row shows its share so nobody reads rank three as meaningfully busier
 * than rank four. A confident "one dominant hotspot" result would mean the clustering was
 * wrong, not that the map has one.
 */

export interface RunKey { userIdx: number; matchIdx: number }

export interface JourneyRow extends RunKey {
  bot: boolean
  samplesInCluster: number
}

export interface RunDetail {
  bot: boolean
  matchIdShort: string
  date: string
  durationS: number
  loot: number
  kills: number
  deaths: number
  positions: number
}

interface HotspotsPanelProps {
  store: Store
  hotspots: HotspotsData
  selectedCluster: Cluster | null
  journeys: JourneyRow[] | null
  selectedRun: RunKey | null
  runDetail: RunDetail | null
  onSelectCluster: (id: number | null) => void
  onSelectRun: (run: RunKey | null) => void
}

const pct = (v: number) => `${(v * 100).toFixed(1)}%`

export default function Hotspots(props: HotspotsPanelProps) {
  const { store, hotspots, selectedCluster, journeys, selectedRun, runDetail } = props

  // Deepest view first: one run's detail card.
  if (selectedCluster && selectedRun && runDetail) {
    return (
      <aside className="panel hotspots" aria-label="Run detail">
        <button type="button" className="hs-back" onClick={() => props.onSelectRun(null)}>
          ← Cluster {selectedCluster.rank}
        </button>
        <h2 className="hs-title">One run</h2>
        <p className="hs-sub">
          {runDetail.bot ? 'Bot' : 'Human'} · match {runDetail.matchIdShort} · {runDetail.date}
        </p>
        <dl className="hs-detail">
          <div><dt>Match length</dt><dd className="num">{mmss(runDetail.durationS)}</dd></div>
          <div><dt>Position samples</dt><dd className="num">{runDetail.positions.toLocaleString()}</dd></div>
          <div><dt>Loot pickups</dt><dd className="num">{runDetail.loot}</dd></div>
          <div><dt>Kills (vs bots)</dt><dd className="num">{runDetail.kills}</dd></div>
          <div><dt>Deaths</dt><dd className="num">{runDetail.deaths}</dd></div>
        </dl>
        <p className="hs-hint">This run's route is drawn on the map in the selection colour.</p>
      </aside>
    )
  }

  // Middle view: journeys through the selected cluster.
  if (selectedCluster) {
    const list = journeys ?? []
    return (
      <aside className="panel hotspots" aria-label="Cluster journeys">
        <button type="button" className="hs-back" onClick={() => props.onSelectCluster(null)}>
          ← Hotspots
        </button>
        <h2 className="hs-title">Cluster {selectedCluster.rank}</h2>
        <p className="hs-sub">
          {pct(selectedCluster.share)} of traffic · {selectedCluster.cellCount} cells · busiest cell{' '}
          {selectedCluster.peakCount.toLocaleString()} players
        </p>
        <p className="hs-count">{list.length.toLocaleString()} journeys passed through</p>
        <ul className="hs-journeys" role="list">
          {list.map((j) => {
            const m = store.matchMeta(j.matchIdx)
            const active = selectedRun?.userIdx === j.userIdx && selectedRun?.matchIdx === j.matchIdx
            return (
              <li key={`${j.matchIdx}:${j.userIdx}`}>
                <button
                  type="button"
                  className={active ? 'hs-journey is-active' : 'hs-journey'}
                  onClick={() => props.onSelectRun({ userIdx: j.userIdx, matchIdx: j.matchIdx })}
                >
                  <span className={j.bot ? 'hs-dot hs-bot' : 'hs-dot hs-human'} aria-hidden="true" />
                  <span className="hs-jmatch num">{store.matchId(j.matchIdx).slice(0, 8)}</span>
                  <span className="hs-jmeta">{j.bot ? 'bot' : 'human'} · {m.date.slice(5)}</span>
                  <span className="hs-jsamples num">{j.samplesInCluster}</span>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>
    )
  }

  // Top view: the ranked cluster list.
  return (
    <aside className="panel hotspots" aria-label="Hotspots">
      <h2 className="hs-title">Hotspots</h2>
      <p className="hs-sub">
        Traffic is not concentrated. The busiest cluster is only {pct(hotspots.topShare)} of it, and
        the ranks below are nearly tied. These are the densest areas, not dominant ones.
      </p>
      {hotspots.clusters.length === 0 ? (
        <p className="hs-empty">No clusters in the current view. Widen the filters or the time window.</p>
      ) : (
        <>
          <ol className="hs-list" role="list">
            {hotspots.clusters.map((c) => (
              <li key={c.id}>
                <button type="button" className="hs-row" onClick={() => props.onSelectCluster(c.id)}>
                  <span className="hs-rank num">{c.rank}</span>
                  <span className="hs-bar" aria-hidden="true">
                    <span style={{ width: `${(c.share / hotspots.topShare) * 100}%` }} />
                  </span>
                  <span className="hs-share num">{pct(c.share)}</span>
                  <span className="hs-cells">{c.cellCount} cells</span>
                </button>
              </li>
            ))}
          </ol>
          <p className="hs-foot">
            {hotspots.totalClusters.toLocaleString()} clusters in all; the {hotspots.clusters.length}{' '}
            densest are listed. Click one to see the journeys through it.
          </p>
        </>
      )}
    </aside>
  )
}
