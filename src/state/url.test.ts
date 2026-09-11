/**
 * url.test.ts — the shareable link must round-trip exactly.
 *
 * A link that restores almost the right view is worse than one that fails loudly: the person
 * who opens it has no way to tell it is wrong. So the central property is encode-then-decode
 * equals the original, tested against the real data bundle rather than a fixture.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { viewColumns } from '../data/loader'
import { Store } from '../data/store'
import type { Meta } from '../data/types'
import { encodeState, decodeState, defaultState, onlyTimeChanged, stateKey } from './url'
import type { ViewState } from './url'

let store: Store

beforeAll(() => {
  const ROOT = resolve(__dirname, '../..')
  const META = resolve(ROOT, 'public/meta.json')
  const BIN = resolve(ROOT, 'public/bundle.bin')
  if (!existsSync(META) || !existsSync(BIN)) {
    throw new Error('public/bundle.bin or meta.json missing - run `npm run build:data` first')
  }
  const meta = JSON.parse(readFileSync(META, 'utf8')) as Meta
  const buf = readFileSync(BIN)
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  store = new Store({ meta, cols: viewColumns(ab, meta.rows), n: meta.rows })
})

const roundTrip = (s: ViewState) => decodeState(encodeState(s, store), store)

describe('default state', () => {
  it('produces an EMPTY query string', () => {
    // A designer glancing at a pasted link should be able to tell whether it carries a
    // filter. A bare URL is the signal that it does not.
    expect(encodeState(defaultState(store), store).toString()).toBe('')
  })

  it('round-trips', () => {
    const d = defaultState(store)
    expect(roundTrip(d).state).toEqual(d)
    expect(roundTrip(d).dropped).toEqual([])
  })
})

describe('round trip', () => {
  it('restores a fully-specified view exactly', () => {
    const matchId = store.matchId(store.multiParticipantMatches()[0])
    const s: ViewState = {
      filter: {
        map: 'Lockdown',
        dateFrom: '2026-02-12',
        dateTo: '2026-02-12',
        matchIds: [matchId],
        actor: 'bot',
        events: ['Loot', 'BotKill'],
      },
      layers: ['dwell', 'kills', 'paths'],
      timeMode: 'window',
      t: 372,
      compareMode: 'diff',
      compareDim: 'day',
      compareValue: '2026-02-10',
    }
    const { state, dropped } = roundTrip(s)
    expect(dropped).toEqual([])
    expect(state.filter).toEqual(s.filter)
    expect(state.layers.sort()).toEqual([...s.layers].sort())
    expect(state.timeMode).toBe('window')
    expect(state.t).toBe(372)
    expect(state.compareMode).toBe('diff')
    expect(state.compareValue).toBe('2026-02-10')
  })

  it('restores a date RANGE, not just a single day', () => {
    const s = { ...defaultState(store), filter: { map: 'AmbroseValley', dateFrom: '2026-02-10', dateTo: '2026-02-13' } }
    expect(roundTrip(s).state.filter).toEqual(s.filter)
  })

  it('restores an empty layer set, which is not the same as the default set', () => {
    const s: ViewState = { ...defaultState(store), layers: [] }
    const { state } = roundTrip(s)
    expect(state.layers).toEqual([])
  })

  it('keeps the match id intact rather than shortening it', () => {
    // Encoding by dictionary index would be far shorter and would silently point at a
    // different match after the next bundle rebuild.
    const matchId = store.matchId(0)
    const s = { ...defaultState(store), filter: { map: store.matchMeta(0).map, matchIds: [matchId] } }
    const url = encodeState(s, store).toString()
    expect(url).toContain(encodeURIComponent(matchId).replace(/%2F/g, '/').slice(0, 12))
    expect(roundTrip(s).state.filter.matchIds).toEqual([matchId])
  })
})

describe('stale links degrade instead of breaking', () => {
  it('drops an unknown match id and keeps the rest of the view', () => {
    const p = new URLSearchParams({ m: 'Lockdown', a: 'human', x: 'not-a-real-match-id' })
    const { state, dropped } = decodeState(p, store)
    expect(state.filter.map).toBe('Lockdown')
    expect(state.filter.actor).toBe('human')
    expect(state.filter.matchIds).toBeUndefined()
    expect(dropped.join(' ')).toMatch(/match id/)
  })

  it('drops an unknown map and says so', () => {
    const { state, dropped } = decodeState(new URLSearchParams({ m: 'AtlantisBay' }), store)
    expect(state.filter.map).toBe(store.meta.dict.maps[0])
    expect(dropped.join(' ')).toMatch(/AtlantisBay/)
  })

  it('drops a date outside the data', () => {
    const { state, dropped } = decodeState(new URLSearchParams({ d: '2019-01-01' }), store)
    expect(state.filter.dateFrom).toBeUndefined()
    expect(dropped.join(' ')).toMatch(/2019-01-01/)
  })

  it('reports a retired event type', () => {
    const { dropped } = decodeState(new URLSearchParams({ e: 'Loot,Extracted' }), store)
    expect(dropped.join(' ')).toMatch(/Extracted/)
  })

  it('never throws on hostile input', () => {
    for (const q of ['t=banana', 'c=nonsense&cd=nonsense', 'l=,,,', 'd=..', 'a=alien', 'x=,,']) {
      expect(() => decodeState(new URLSearchParams(q), store)).not.toThrow()
    }
  })
})

describe('playback is never shared', () => {
  it('encodes no key that could start playback', () => {
    const s = { ...defaultState(store), t: 120 }
    const url = encodeState(s, store).toString()
    // Position travels; motion does not. A link that plays on open takes control away from
    // whoever opened it.
    expect(url).not.toMatch(/play/i)
    expect(url).not.toMatch(/speed/i)
    expect(url).toContain('t=120')
  })
})

describe('history rule', () => {
  const base = new URLSearchParams({ m: 'Lockdown', a: 'bot', t: '100' })

  it('treats a timeline-only change as a replacement', () => {
    const next = new URLSearchParams({ m: 'Lockdown', a: 'bot', t: '260' })
    expect(onlyTimeChanged(base, next)).toBe(true)
  })

  it('treats any other change as a new entry', () => {
    expect(onlyTimeChanged(base, new URLSearchParams({ m: 'GrandRift', a: 'bot', t: '100' }))).toBe(false)
    expect(onlyTimeChanged(base, new URLSearchParams({ m: 'Lockdown', a: 'bot', t: '260', l: 'paths' }))).toBe(false)
  })

  it('treats an unchanged state as neither', () => {
    expect(onlyTimeChanged(base, new URLSearchParams(base.toString()))).toBe(false)
  })

  it('detects the time key appearing or disappearing', () => {
    expect(onlyTimeChanged(new URLSearchParams({ m: 'Lockdown' }), new URLSearchParams({ m: 'Lockdown', t: '10' }))).toBe(true)
    expect(onlyTimeChanged(new URLSearchParams({ m: 'Lockdown', t: '10' }), new URLSearchParams({ m: 'Lockdown' }))).toBe(true)
  })
})

describe('stateKey', () => {
  it('gives identical states an identical key and different states different keys', () => {
    const a = defaultState(store)
    const b = { ...defaultState(store), filter: { map: 'Lockdown' } }
    expect(stateKey(a, store)).toBe(stateKey(defaultState(store), store))
    expect(stateKey(a, store)).not.toBe(stateKey(b, store))
  })
})
