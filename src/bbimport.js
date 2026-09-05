// ── Baby Buddy CSV import ────────────────────────────────────────────────────
// Pure parsing + mapping (no DOM, no React) so src/test/bbimport.test.js can
// exercise it against hand-written fixtures.
//
// Baby Buddy exports one CSV per model via django-import-export; every file
// starts with a header row (id, child_id, child_first_name, child_last_name,
// then the model's own fields). Files are recognized by HEADER NAMES, never by
// filename or column position, so renamed downloads like "export (1).csv"
// still import. Models with no counterpart here (notes, growth
// measurements…) are skipped and counted, never errors.

// ── CSV ──────────────────────────────────────────────────────────────────────
// Minimal RFC-4180 reader: quoted fields may hold commas, newlines and "" escapes.
export function parseCsv(text) {
  const rows = []
  let row = [], field = '', inQ = false
  const t = String(text).replace(/^﻿/, '')
  for (let i = 0; i < t.length; i++) {
    const c = t[i]
    if (inQ) {
      if (c === '"') {
        if (t[i + 1] === '"') { field += '"'; i++ } else inQ = false
      } else field += c
    } else if (c === '"') inQ = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && t[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.length > 1 || row[0] !== '') rows.push(row)
  if (!rows.length) return []
  const headers = rows[0].map(h => h.trim().toLowerCase())
  return rows.slice(1).map(cells => {
    const r = {}
    headers.forEach((h, i) => { if (h) r[h] = (cells[i] ?? '').trim() })
    return r
  })
}

// ── field parsers ────────────────────────────────────────────────────────────
// Baby Buddy datetimes export as "YYYY-MM-DD HH:MM:SS" in the server's local
// time; parse those as local so a 2 PM feed stays a 2 PM feed. Anything else
// (ISO with offset) falls through to Date.parse.
export function parseWhen(s) {
  if (s == null || s === '') return null
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(String(s).trim())
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)).getTime()
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : t
}

// Django timedelta strings: "0:18:00", "1:05:30.123456", "1 day, 2:03:04"
export function parseDurationMins(s) {
  if (s == null || s === '') return null
  const m = /^(?:(\d+)\s*days?,\s*)?(\d+):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/.exec(String(s).trim())
  if (!m) return null
  const ms = ((+(m[1] || 0) * 24 + +m[2]) * 60 + +m[3]) * 60000 + +(m[4] || 0) * 1000
  return Math.max(1, Math.round(ms / 60000))
}

const minsBetween = (a, b) => Math.max(1, Math.round((b - a) / 60000))
const bool = v => /^(true|t|1|yes)$/i.test(String(v || '').trim())

// ── amounts: this app stores oz, always ──────────────────────────────────────
// Baby Buddy amounts are unitless — ml households export 120, oz households
// export 4. Nobody feeds a 16 oz bottle, so anything above 15 is read as ml.
export const ML_PER_OZ = 29.5735
export const mlToOz = ml => Math.round(ml / ML_PER_OZ * 100) / 100
export function amountToOz(v) {
  const n = Number(v)
  if (v == null || v === '' || !Number.isFinite(n) || n <= 0) return null
  return n > 15 ? mlToOz(n) : Math.round(n * 100) / 100
}

// ── deterministic ids ────────────────────────────────────────────────────────
// The same source row must always become the same entry id, so re-importing a
// file (or a fresh export of the same data) upserts instead of duplicating —
// the server's POST /entries is updateOrCreate keyed on id. 128 bits from four
// seeded FNV-1a passes, dressed in UUID shape to match native entry ids.
const fnv1a = str => {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) }
  return (h >>> 0).toString(16).padStart(8, '0')
}
export function bbId(key) {
  const h = fnv1a('0' + key) + fnv1a('1' + key) + fnv1a('2' + key) + fnv1a('3' + key)
  return h.slice(0, 8) + '-' + h.slice(8, 12) + '-8' + h.slice(13, 16) + '-'
    + ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16) + h.slice(17, 20) + '-' + h.slice(20, 32)
}
// Row identity: Baby Buddy's own primary key when the export has one (stable
// across re-exports, survives edits), else the row's timestamps.
const rowKey = (model, r) => {
  const child = r.child_id || [r.child_first_name, r.child_last_name].filter(Boolean).join(' ') || r.child || ''
  const ident = r.id ? 'id:' + r.id : 'at:' + (r.start || r.time || '') + ':' + (r.end || '')
  return 'babybuddy:' + model + ':' + child + ':' + ident
}

// ── model detection + mapping ────────────────────────────────────────────────
// Order matters: changes also carry an "amount" column, feedings carry both
// "type" and "method" — test the distinctive columns first.
export function detectModel(headers) {
  const has = k => headers.includes(k)
  if (has('wet') && has('solid')) return 'changes'
  if (has('method') && has('type')) return 'feedings'
  if (has('nap')) return 'sleep'
  if (has('milestone')) return 'tummy-time'
  if (has('note')) return 'notes'
  for (const k of ['temperature', 'weight', 'height', 'head_circumference', 'bmi']) if (has(k)) return k
  if (has('amount') && (has('start') || has('time'))) return 'pumping'
  if (has('start') && has('end') && has('duration')) return 'sleep'
  return 'unknown'
}

const MAPPERS = {
  feedings(r) {
    const t = parseWhen(r.start || r.time)
    if (t == null) return null
    const method = (r.method || '').toLowerCase()
    if (method.includes('breast')) {
      // nursing: entry t is the start (like the live timer), side from method
      const side = method.includes('left') ? 'Left' : method.includes('right') ? 'Right' : 'Both'
      const end = parseWhen(r.end)
      const mins = parseDurationMins(r.duration) ?? (end != null ? minsBetween(t, end) : null)
      return { type: 'nurse', t, detail: mins ? side + ' · ' + mins + 'm' : side }
    }
    if (method.includes('bottle')) {
      const oz = amountToOz(r.amount)
      const type = (r.type || '').toLowerCase()
      const milk = type.includes('breast') ? 'breastmilk' : type.includes('formula') ? 'formula' : null
      return { type: 'bottle', t, detail: [oz, milk].filter(x => x != null).join(' ') || null }
    }
    return null // parent fed / self fed solids — nothing to map them to
  },
  pumping(r) {
    const t = parseWhen(r.start || r.time)
    if (t == null) return null
    const oz = amountToOz(r.amount)
    const end = parseWhen(r.end)
    const mins = parseDurationMins(r.duration) ?? (end != null ? minsBetween(t, end) : null)
    return { type: 'pump', t, detail: [oz, mins != null ? mins + 'm' : null].filter(x => x != null).join(' · ') || null }
  },
  changes(r) {
    const t = parseWhen(r.time || r.start)
    if (t == null) return null
    const wet = bool(r.wet), solid = bool(r.solid)
    const type = wet && solid ? 'both' : wet ? 'wet' : solid ? 'dirty' : null
    return type ? { type, t } : null // a logged dry change has no diaper to count
  },
  sleep(r) {
    // this app stamps sleep at wake-up with duration minutes in detail
    // (matching the sleep timer's entry) — no end time means no wake-up to
    // stamp. Baby Buddy's nap flag becomes the Nap/Night tag ("Nap · 45m");
    // exports without the column stay untagged bare minutes.
    const end = parseWhen(r.end)
    if (end == null) return null
    const start = parseWhen(r.start)
    const mins = parseDurationMins(r.duration) ?? (start != null ? minsBetween(start, end) : null)
    if (mins == null) return null
    const tag = 'nap' in r ? (bool(r.nap) ? 'Nap' : 'Night') : null
    return { type: 'sleep', t: end, detail: tag ? tag + ' · ' + mins + 'm' : mins }
  },
  'tummy-time'(r) {
    // like sleep: stamped when the session ended, bare minutes in detail
    const end = parseWhen(r.end)
    if (end == null) return null
    const start = parseWhen(r.start)
    const mins = parseDurationMins(r.duration) ?? (start != null ? minsBetween(start, end) : null)
    return mins != null ? { type: 'tummy', t: end, detail: mins } : null
  },
}

// files: [{ name, text }] → { entries, imported, skipped, models: {model: {imported, skipped}} }
export function mapBabyBuddy(files) {
  const entries = [], seen = new Set(), models = {}
  let skipped = 0
  for (const f of files) {
    let rows
    try { rows = parseCsv(f.text) } catch { rows = [] }
    if (!rows.length) continue
    const model = detectModel(Object.keys(rows[0]))
    const tally = models[model] = models[model] || { imported: 0, skipped: 0 }
    const map = MAPPERS[model]
    for (const r of rows) {
      const e = map ? map(r) : null
      const id = e ? bbId(rowKey(model, r)) : null
      if (!e || seen.has(id)) { tally.skipped++; skipped++; continue }
      seen.add(id)
      entries.push({ id, ...e, detail: e.detail ?? null })
      tally.imported++
    }
  }
  return { entries, imported: entries.length, skipped, models }
}

// ── outbox chunking ──────────────────────────────────────────────────────────
// POST /entries validates max 500 per batch; sync() flushes through this so a
// big import (or any future bulk enqueue) never 422s the whole loop.
export const chunk = (arr, size) => {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
