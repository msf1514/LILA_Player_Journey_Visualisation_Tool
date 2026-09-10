/**
 * ingest.ts — parse .nakama-0 files dropped into the browser.
 *
 * This is why parsing lives client-side at all. The same `transform.mjs` that builds the
 * shipped bundle runs here, so a file a designer drops in is interpreted by exactly the
 * same rules -- the timestamp scaling, the bot rule, the coordinate projection. Two
 * implementations would drift, and dropped-in data would disagree with baked-in data
 * without anything erroring. That failure is invisible, which makes it the worst kind.
 *
 * hyparquet reads these files with its BUILT-IN Snappy. Do not add `hysnappy`: it fails on
 * this data with "parquet decompressed page length 2 does not match header 40".
 */

import { parquetReadObjects } from 'hyparquet'
// @ts-expect-error - shared JS module, intentionally untyped so pipeline and runtime stay identical
import { normalizeRow } from '../../pipeline/transform.mjs'
import type { MapConfig } from './types'

export interface IngestedRow {
  userId: string
  matchId: string
  mapId: string
  x: number
  y: number
  z: number
  u: number
  v: number
  t: number
  event: string
  bot: boolean
  ambiguous: boolean
  inBounds: boolean
  file: string
}

export interface IngestResult {
  rows: IngestedRow[]
  filesRead: number
  filesFailed: { name: string; reason: string }[]
  duplicateFiles: string[]
  unknownMaps: string[]
  unknownEvents: string[]
}

const KNOWN_EVENTS = new Set([
  'Position', 'BotPosition', 'Loot',
  'Kill', 'Killed', 'BotKill', 'BotKilled', 'KilledByStorm',
])

/**
 * Parse dropped files. Never throws on a single bad file: a designer dropping a folder of
 * 300 files should not lose all of them because one is truncated, so failures are collected
 * and reported rather than raised.
 *
 * @param existingFileNames names already loaded, so re-dropping a file cannot double-count.
 */
export async function ingestFiles(
  files: File[],
  mapConfig: Record<string, MapConfig>,
  existingFileNames: ReadonlySet<string> = new Set(),
): Promise<IngestResult> {
  const rows: IngestedRow[] = []
  const filesFailed: { name: string; reason: string }[] = []
  const duplicateFiles: string[] = []
  const unknownMaps = new Set<string>()
  const unknownEvents = new Set<string>()
  const seen = new Set(existingFileNames)
  let filesRead = 0

  for (const file of files) {
    if (seen.has(file.name)) { duplicateFiles.push(file.name); continue }

    try {
      const buffer = await file.arrayBuffer()
      const raw = await parquetReadObjects({ file: buffer })
      seen.add(file.name)
      filesRead++

      for (const r of raw as Record<string, unknown>[]) {
        const mapId = String(r.map_id)
        // A map we have no config for cannot be projected. Report it so the user can add
        // the map through the config UI, rather than silently dropping their data.
        if (!mapConfig[mapId]) { unknownMaps.add(mapId); continue }
        const row = normalizeRow(r, mapConfig) as Omit<IngestedRow, 'file'>
        if (!KNOWN_EVENTS.has(row.event)) unknownEvents.add(row.event)
        rows.push({ ...row, file: file.name })
      }
    } catch (err) {
      filesFailed.push({ name: file.name, reason: err instanceof Error ? err.message : String(err) })
    }
  }

  return {
    rows,
    filesRead,
    filesFailed,
    duplicateFiles,
    unknownMaps: [...unknownMaps],
    unknownEvents: [...unknownEvents],
  }
}

/** Pull `.nakama-0` files out of a drop, including whole folders. */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const out: File[] = []
  const entries = [...dt.items]
    .map((item) => (item.webkitGetAsEntry ? item.webkitGetAsEntry() : null))
    .filter(Boolean) as FileSystemEntry[]

  if (entries.length === 0) return [...dt.files].filter(isJourneyFile)

  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) =>
        (entry as FileSystemFileEntry).file(res, rej))
      if (isJourneyFile(file)) out.push(file)
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      // readEntries returns at most 100 per call, so it must be drained in a loop.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej))
        if (batch.length === 0) break
        for (const child of batch) await walk(child)
      }
    }
  }

  for (const entry of entries) await walk(entry)
  return out
}

function isJourneyFile(file: File): boolean {
  return file.name.endsWith('.nakama-0') || file.name.endsWith('.parquet')
}
