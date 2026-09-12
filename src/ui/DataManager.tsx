import { useCallback, useEffect, useRef, useState } from 'react'
import type { Store } from '../data/store'
import type { MapConfig } from '../data/types'
import type { IngestResult } from '../data/ingest'
import type { AddedMap } from '../data/persist'

// hyparquet (via ingest) is large and only needed once a designer actually drops a file, so it
// is dynamically imported here rather than statically. That keeps it out of the initial chunk
// and preserves the fast first paint.
const loadIngest = () => import('../data/ingest')

/**
 * DataManager — the extensibility surface.
 *
 * Proves the pipeline is real, not a fixture baked at build time. A designer can drop a folder
 * of .nakama-0 files and see them merge into the same maps, parsed by the very transform the
 * build uses. They can register a new map from a minimap image and its projection, and its data
 * renders with no redeploy. Everything added persists across reloads and can be removed.
 *
 * Failures are never swallowed: the report names every file that could not be read, every map
 * with no config, and every event type not seen before, so a designer knows exactly what landed
 * and what did not.
 */

interface DataManagerProps {
  store: Store
  addedRows: number
  addedMaps: AddedMap[]
  existingFileNames: ReadonlySet<string>
  onIngest: (result: IngestResult) => void
  onAddMap: (map: AddedMap) => void
  onClear: () => void
}

export default function DataManager(props: DataManagerProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const added = props.addedRows > 0 || props.addedMaps.length > 0

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="map-control data-mgr-btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        title="Add telemetry files or a new map"
      >
        Manage data{added && <span className="data-mgr-badge">{props.addedMaps.length + (props.addedRows ? 1 : 0)}</span>}
      </button>
      {open && <DataManagerPanel {...props} onClose={() => { setOpen(false); triggerRef.current?.focus() }} />}
    </>
  )
}

function DataManagerPanel({
  store, addedRows, addedMaps, existingFileNames, onIngest, onAddMap, onClear, onClose,
}: DataManagerProps & { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState(false)
  const [report, setReport] = useState<IngestResult | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => {
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleFiles = useCallback(async (files: File[]) => {
    if (!files.length) return
    setBusy(true)
    setLoadError(null)
    try {
      const { ingestFiles } = await loadIngest()
      const result = await ingestFiles(files, store.meta.mapConfig, existingFileNames)
      setReport(result)
      if (result.rows.length) onIngest(result)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }, [store, existingFileNames, onIngest])

  const onDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    setBusy(true)
    try {
      const { filesFromDataTransfer } = await loadIngest()
      const files = await filesFromDataTransfer(e.dataTransfer)
      await handleFiles(files)
    } finally {
      setBusy(false)
    }
  }, [handleFiles])

  return (
    <div className="dn-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={panelRef} className="dn-panel dm-panel" role="dialog" aria-modal="true" aria-labelledby="dm-title" tabIndex={-1}>
        <div className="dn-head">
          <h2 id="dm-title" className="dn-title">Add data</h2>
          <button type="button" className="map-control dn-close" onClick={onClose} aria-label="Close">Close</button>
        </div>

        <p className="dn-lead" style={{ borderLeftColor: 'var(--accent)' }}>
          Drop .nakama-0 journey files or a folder of them. They are parsed in the browser by the
          same transform the shipped bundle uses, then merged into these maps. New matches are
          added; files whose match is already loaded are skipped.
        </p>

        {/* ── Drop zone ─────────────────────────────────────────────────────── */}
        <div
          className={dragging ? 'dm-drop is-drag' : 'dm-drop'}
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <p>{busy ? 'Reading files…' : 'Drop journey files or a folder here'}</p>
          <label className="dm-choose">
            or choose files
            <input
              type="file"
              multiple
              accept=".nakama-0,.parquet"
              style={{ display: 'none' }}
              onChange={(e) => handleFiles([...(e.target.files ?? [])])}
            />
          </label>
        </div>

        {loadError && <p className="dm-error" role="alert">Could not read the drop: {loadError}</p>}
        {report && <IngestReport report={report} />}

        {/* ── Add a map ─────────────────────────────────────────────────────── */}
        <AddMapForm existingIds={new Set([...store.meta.dict.maps])} onAdd={onAddMap} />

        {/* ── Added so far ──────────────────────────────────────────────────── */}
        {(addedRows > 0 || addedMaps.length > 0) && (
          <div className="dm-added">
            <h3 className="dn-heading">Added data</h3>
            <p className="dn-secnote">
              {addedRows.toLocaleString()} rows{addedMaps.length ? `, ${addedMaps.length} map${addedMaps.length === 1 ? '' : 's'}` : ''} added.
              Persisted in this browser.
            </p>
            {addedMaps.map((m) => (
              <p key={m.id} className="dm-added-map num">{m.config.label} · scale {m.config.scale} · {m.version}</p>
            ))}
            <button type="button" className="map-control dm-clear" onClick={onClear}>
              Remove all added data
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function IngestReport({ report }: { report: IngestResult }) {
  const rows: { label: string; value: string; warn?: boolean }[] = [
    { label: 'Files read', value: report.filesRead.toLocaleString() },
    { label: 'Rows parsed', value: report.rows.length.toLocaleString() },
    { label: 'Duplicate files skipped', value: report.duplicateFiles.length.toLocaleString(), warn: report.duplicateFiles.length > 0 },
    { label: 'Files failed', value: report.filesFailed.length.toLocaleString(), warn: report.filesFailed.length > 0 },
    { label: 'Unknown maps', value: report.unknownMaps.length ? report.unknownMaps.join(', ') : '0', warn: report.unknownMaps.length > 0 },
    { label: 'Unknown event types', value: report.unknownEvents.length ? report.unknownEvents.join(', ') : '0', warn: report.unknownEvents.length > 0 },
  ]
  return (
    <div className="dm-report" role="status">
      <h3 className="dn-heading">Last import</h3>
      <dl className="hs-detail">
        {rows.map((r) => (
          <div key={r.label}>
            <dt>{r.label}</dt>
            <dd className={r.warn ? 'num dn-muted' : 'num'} style={r.warn ? { color: 'var(--ev-storm)' } : undefined}>{r.value}</dd>
          </div>
        ))}
      </dl>
      {report.unknownMaps.length > 0 && (
        <p className="dn-secnote">Add these maps below to project their data instead of dropping it.</p>
      )}
      {report.filesFailed.length > 0 && (
        <ul className="dm-failed">
          {report.filesFailed.slice(0, 6).map((f) => (
            <li key={f.name}><span className="num">{f.name}</span>: {f.reason}</li>
          ))}
          {report.filesFailed.length > 6 && <li>and {report.filesFailed.length - 6} more</li>}
        </ul>
      )}
    </div>
  )
}

function AddMapForm({ existingIds, onAdd }: { existingIds: Set<string>; onAdd: (m: AddedMap) => void }) {
  const [id, setId] = useState('')
  const [label, setLabel] = useState('')
  const [scale, setScale] = useState('')
  const [originX, setOriginX] = useState('')
  const [originZ, setOriginZ] = useState('')
  const [version, setVersion] = useState('v1')
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    const s = Number(scale), ox = Number(originX), oz = Number(originZ)
    if (!id.trim()) return setError('Map id is required (it must match map_id in the files).')
    if (existingIds.has(id.trim())) return setError('A map with that id already exists.')
    if (!file) return setError('A minimap image is required.')
    if (!(s > 0)) return setError('Scale must be a positive number.')
    if (!Number.isFinite(ox) || !Number.isFinite(oz)) return setError('Origin X and Z must be numbers.')

    try {
      const { dataUrl, width, height } = await readImage(file)
      const config: MapConfig = {
        label: label.trim() || id.trim(),
        scale: s, originX: ox, originZ: oz,
        version,
        source: { file: file.name, width, height },
      }
      onAdd({ id: id.trim(), config, minimap: dataUrl, version })
      setId(''); setLabel(''); setScale(''); setOriginX(''); setOriginZ(''); setVersion('v1'); setFile(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the image.')
    }
  }

  return (
    <form className="dm-form" onSubmit={submit}>
      <h3 className="dn-heading">Add a map</h3>
      <p className="dn-secnote">
        Register a new map from its minimap and projection. No redeploy: its data renders as soon
        as you drop files whose map_id matches.
      </p>
      <div className="dm-grid">
        <label>Map id<input className="rail-input" value={id} onChange={(e) => setId(e.target.value)} placeholder="e.g. NewMap" /></label>
        <label>Display name<input className="rail-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="optional" /></label>
        <label>Scale<input className="rail-input num" value={scale} onChange={(e) => setScale(e.target.value)} placeholder="e.g. 900" inputMode="decimal" /></label>
        <label>Version<input className="rail-input" value={version} onChange={(e) => setVersion(e.target.value)} /></label>
        <label>Origin X<input className="rail-input num" value={originX} onChange={(e) => setOriginX(e.target.value)} placeholder="e.g. -370" inputMode="decimal" /></label>
        <label>Origin Z<input className="rail-input num" value={originZ} onChange={(e) => setOriginZ(e.target.value)} placeholder="e.g. -473" inputMode="decimal" /></label>
      </div>
      <div className="dm-file">
        <span>Minimap image</span>
        <div className="dm-file-row">
          <label className="dm-choose">
            Choose image
            <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <span className="dm-file-name">{file ? file.name : 'No image chosen'}</span>
        </div>
      </div>
      {error && <p className="dm-error" role="alert">{error}</p>}
      <button type="submit" className="map-control dm-submit">Add map</button>
    </form>
  )
}

/** Read an image file to a data URL and its natural dimensions. */
function readImage(file: File): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read the file.'))
    reader.onload = () => {
      const dataUrl = reader.result as string
      const img = new Image()
      img.onerror = () => reject(new Error('That file is not a readable image.'))
      img.onload = () => resolve({ dataUrl, width: img.naturalWidth, height: img.naturalHeight })
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}
