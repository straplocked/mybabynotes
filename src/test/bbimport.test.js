// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// Baby Buddy importer guard, ported from scripts/check-bbimport.mjs.
// Fixtures and expected values are HAND-WRITTEN (120 ml → 4.06 oz was worked
// out on paper: 120 / 29.5735 = 4.0577 → 4.06), never derived from the
// module's own constants — so breaking the ml→oz conversion fails loudly here.
import { describe, it, expect } from 'vitest'
import {
  mapBabyBuddy, parseCsv, chunk, parseWhen, parseDurationMins, amountToOz, detectModel,
} from '../bbimport.js'

// ── fixtures: one file per Baby Buddy model, headers as its admin exports ────
const feedings = `id,child_id,child_first_name,child_last_name,start,end,duration,type,method,amount,notes,tags
10,1,Robin,Doe,2025-01-15 10:30:00,2025-01-15 10:48:00,0:18:00,breast milk,left breast,,,
11,1,Robin,Doe,2025-01-15 14:00:00,2025-01-15 14:10:00,0:10:00,formula,bottle,120.0,"fussy, but ate ""fine""",
12,1,Robin,Doe,2025-01-16 09:00:00,2025-01-16 09:05:00,0:05:00,breast milk,bottle,4,,
13,1,Robin,Doe,2025-01-16 12:00:00,2025-01-16 12:15:00,0:15:00,solid food,parent fed,30,,
`
const pumping = `id,child_id,child_first_name,child_last_name,start,end,duration,amount,notes,tags
3,1,Robin,Doe,2025-01-15 08:00:00,2025-01-15 08:20:00,0:20:00,90,,
`
const changes = `id,child_id,child_first_name,child_last_name,time,wet,solid,color,amount,notes,tags
5,1,Robin,Doe,2025-01-15 11:00:00,True,False,,,,
6,1,Robin,Doe,2025-01-15 13:00:00,False,True,brown,,,
7,1,Robin,Doe,2025-01-15 15:00:00,True,True,,,,
8,1,Robin,Doe,2025-01-15 16:00:00,False,False,,,,
`
const sleep = `id,child_id,child_first_name,child_last_name,start,end,duration,nap,notes,tags
2,1,Robin,Doe,2025-01-15 12:00:00,2025-01-15 13:35:00,1:35:00,True,,
9,1,Robin,Doe,2025-01-15 20:00:00,,,True,,
14,1,Robin,Doe,2025-01-15 19:00:00,2025-01-16 05:00:00,10:00:00,False,,
`
const tummy = `id,child_id,child_first_name,child_last_name,start,end,duration,milestone,tags
4,1,Robin,Doe,2025-01-15 09:30:00,2025-01-15 09:42:00,0:12:00,first roll,
15,1,Robin,Doe,2025-01-15 17:00:00,,,,
`
const notes = `id,child_id,child_first_name,child_last_name,time,note,tags
1,1,Robin,Doe,2025-01-15 12:00:00,"Hello, ""world""
second line",
`
const files = [
  { name: 'feedings.csv', text: feedings },
  { name: 'pumping.csv', text: pumping },
  { name: 'changes.csv', text: changes },
  { name: 'sleep.csv', text: sleep },
  { name: 'tummy-time.csv', text: tummy },
  { name: 'notes.csv', text: notes },
]

const at = (d, h, m) => new Date(2025, 0, d, h, m).getTime() // hand-picked local stamps matching the fixtures

describe('parseCsv', () => {
  it('handles quoted commas, "" escapes and embedded newlines as one row', () => {
    const rows = parseCsv(notes)
    expect(rows).toHaveLength(1)
    expect(rows[0].note).toBe('Hello, "world"\nsecond line')
  })

  it('strips a UTF-8 BOM and skips blank lines', () => {
    const rows = parseCsv('﻿id,name\n\n1,Robin\n')
    expect(rows).toEqual([{ id: '1', name: 'Robin' }])
  })
})

describe('field parsers', () => {
  it('parseWhen reads Baby Buddy local datetimes as local time', () => {
    expect(parseWhen('2025-01-15 10:30:00')).toBe(at(15, 10, 30))
    expect(parseWhen('2025-01-15T10:30:00.123')).toBe(at(15, 10, 30))
    expect(parseWhen('')).toBeNull()
    expect(parseWhen('not a date')).toBeNull()
  })

  it('parseDurationMins reads Django timedeltas, days included', () => {
    expect(parseDurationMins('0:18:00')).toBe(18)
    expect(parseDurationMins('1:05:30.123456')).toBe(66) // 65.5 rounds up by hand
    expect(parseDurationMins('1 day, 2:03:04')).toBe(1563) // 24h + 2h3m4s = 1563.07 → 1563
    expect(parseDurationMins('0:00:10')).toBe(1) // floor of one minute
    expect(parseDurationMins('')).toBeNull()
    expect(parseDurationMins('90')).toBeNull()
  })

  it('amountToOz reads >15 as ml and ≤15 as oz already', () => {
    expect(amountToOz('120.0')).toBe(4.06) // 120 / 29.5735 = 4.0577 → 4.06 by hand
    expect(amountToOz('4')).toBe(4)
    expect(amountToOz('15')).toBe(15) // boundary stays oz
    expect(amountToOz('0')).toBeNull()
    expect(amountToOz('')).toBeNull()
    expect(amountToOz('abc')).toBeNull()
  })

  it('detectModel keys on distinctive headers, not filenames', () => {
    expect(detectModel(['id', 'time', 'wet', 'solid', 'amount'])).toBe('changes') // amount alone must not read as pumping
    expect(detectModel(['id', 'start', 'type', 'method', 'amount'])).toBe('feedings')
    expect(detectModel(['id', 'start', 'end', 'duration', 'nap'])).toBe('sleep')
    expect(detectModel(['id', 'start', 'end', 'duration', 'milestone'])).toBe('tummy-time')
    expect(detectModel(['id', 'start', 'end', 'duration', 'amount'])).toBe('pumping')
    expect(detectModel(['id', 'time', 'note'])).toBe('notes')
    expect(detectModel(['id', 'weight'])).toBe('weight')
    expect(detectModel(['id', 'whatever'])).toBe('unknown')
  })
})

describe('mapBabyBuddy', () => {
  const res = mapBabyBuddy(files)

  it('maps entries in file order with hand-written values', () => {
    expect(res.entries.map(({ type, t, detail }) => ({ type, t, detail }))).toEqual([
      { type: 'nurse', t: at(15, 10, 30), detail: 'Left · 18m' },
      { type: 'bottle', t: at(15, 14, 0), detail: '4.06 formula' }, // 120 ml → 4.06 oz, worked out by hand
      { type: 'bottle', t: at(16, 9, 0), detail: '4 breastmilk' }, // 4 ≤ 15 reads as oz already
      { type: 'pump', t: at(15, 8, 0), detail: '3.04 · 20m' }, // 90 ml → 3.04 oz by hand
      { type: 'wet', t: at(15, 11, 0), detail: null },
      { type: 'dirty', t: at(15, 13, 0), detail: null },
      { type: 'both', t: at(15, 15, 0), detail: null },
      { type: 'sleep', t: at(15, 13, 35), detail: 'Nap · 95m' }, // stamped at wake-up, nap flag → tag — 1h35m by hand
      { type: 'sleep', t: at(16, 5, 0), detail: 'Night · 600m' }, // nap=False reads as night sleep
      { type: 'tummy', t: at(15, 9, 42), detail: 12 }, // stamped when the session ended, bare minutes
    ])
  })

  it('sleep without a nap column stays untagged bare minutes', () => {
    const legacy = 'id,child_id,child_first_name,child_last_name,start,end,duration\n2,1,Robin,Doe,2025-01-15 12:00:00,2025-01-15 12:40:00,0:40:00\n'
    expect(mapBabyBuddy([{ name: 'sleep.csv', text: legacy }]).entries[0]).toMatchObject({ type: 'sleep', detail: 40 })
  })

  it('counts imported and skipped, per model', () => {
    expect(res.imported).toBe(10)
    // skipped: parent-fed solids, dry change, endless sleep + tummy time, the note row
    expect(res.skipped).toBe(5)
    expect(res.models).toEqual({
      feedings: { imported: 3, skipped: 1 },
      pumping: { imported: 1, skipped: 0 },
      changes: { imported: 3, skipped: 1 },
      sleep: { imported: 2, skipped: 1 },
      'tummy-time': { imported: 1, skipped: 1 },
      notes: { imported: 0, skipped: 1 },
    })
  })

  it('makes uuid-shaped, unique, deterministic ids', () => {
    const ids = res.entries.map(e => e.id)
    expect(ids.every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id))).toBe(true)
    expect(new Set(ids).size).toBe(10)
    // re-importing the same files must upsert, not duplicate
    expect(mapBabyBuddy(files).entries.map(e => e.id)).toEqual(ids)
    // filename plays no part — renamed downloads still dedupe
    expect(mapBabyBuddy([{ name: 'export (1).csv', text: feedings }]).entries.map(e => e.id)).toEqual(ids.slice(0, 3))
  })

  it('collapses the same rows picked twice in one import', () => {
    expect(mapBabyBuddy([...files, ...files]).imported).toBe(10)
  })
})

describe('chunk (sync() flushes the outbox through chunk(payload, 500))', () => {
  it('slices 1101 → 500/500/101 with order preserved end to end', () => {
    const nums = Array.from({ length: 1101 }, (_, i) => i + 1)
    const parts = chunk(nums, 500)
    expect(parts.map(p => p.length)).toEqual([500, 500, 101])
    expect([parts[0][0], parts[1][0], parts[2][100]]).toEqual([1, 501, 1101])
  })

  it('keeps a small batch as one call and empty as no calls', () => {
    expect(chunk([1, 2, 3], 500)).toEqual([[1, 2, 3]])
    expect(chunk([], 500)).toEqual([])
  })
})
