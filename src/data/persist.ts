/**
 * persist.ts — remember dropped data across reloads, in IndexedDB.
 *
 * localStorage is too small for telemetry (a few MB, and it is synchronous), so added rows and
 * added map definitions live in IndexedDB. Everything is wrapped so a private window, a blocked
 * store or a quota refusal degrades to "nothing persisted" rather than throwing: the tool still
 * works for the session, it just forgets on reload, and the caller is told so it can say so.
 *
 * One database, one object store, two keys: the added rows and the added map definitions. They
 * are written together after every change and read together at startup.
 */

import type { IngestedRow } from './ingest'
import type { MapConfig } from './types'

const DB_NAME = 'lila-added-data'
const STORE = 'kv'
const ROWS_KEY = 'rows'
const MAPS_KEY = 'maps'

/** A map added through the UI: its projection config, version tag, and uploaded minimap. */
export interface AddedMap {
  id: string
  config: MapConfig
  /** Minimap image as a data URL, so it survives a reload with no server. */
  minimap: string
  /** Version label for this minimap, scaffolding for when a map's geometry changes. */
  version: string
}

export interface PersistedData {
  rows: IngestedRow[]
  maps: AddedMap[]
}

const EMPTY: PersistedData = { rows: [], maps: [] }

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE) }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
  })
}

/** Load everything persisted. Returns empty (never throws) when storage is unavailable. */
export async function loadPersisted(): Promise<PersistedData> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE, 'readonly')
    const store = tx.objectStore(STORE)
    const rows = await promisify<IngestedRow[]>(store.get(ROWS_KEY))
    const maps = await promisify<AddedMap[]>(store.get(MAPS_KEY))
    db.close()
    return { rows: rows ?? [], maps: maps ?? [] }
  } catch {
    return { ...EMPTY }
  }
}

/** Overwrite the persisted set. Returns false when it could not be saved. */
export async function savePersisted(data: PersistedData): Promise<boolean> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE, 'readwrite')
    const store = tx.objectStore(STORE)
    store.put(data.rows, ROWS_KEY)
    store.put(data.maps, MAPS_KEY)
    await txDone(tx)
    db.close()
    return true
  } catch {
    return false
  }
}

/** Forget all added data. */
export async function clearPersisted(): Promise<boolean> {
  try {
    const db = await openDB()
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).clear()
    await txDone(tx)
    db.close()
    return true
  } catch {
    return false
  }
}

function promisify<T>(req: IDBRequest<T>): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result as T)
    req.onerror = () => reject(req.error)
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'))
  })
}
