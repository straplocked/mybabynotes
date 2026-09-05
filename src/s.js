// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// Parses the design comp's inline CSS strings into React style objects,
// so markup can be carried over from design/Baby Log.dc.html verbatim.
const cache = new Map()

// The comp's fixed palette rewrites to the theme variables in styles.css at
// parse time, so verbatim comp strings follow the household theme and dark
// mode. Keep this table in step with :root/html.dark in styles.css.
// (Accent hexes and the oklch type colors are intentionally absent.)
const PALETTE = [
  [/#FAF6EF\b/g, 'var(--bg)'],
  [/#FFFDF8\b/g, 'var(--surface)'],
  [/#F1EBE0\b/g, 'var(--hov-surface)'],
  [/#26231D\b/g, 'var(--ink)'],
  [/#3D392F\b/g, 'var(--ink2)'],
  [/#4E4A3F\b/g, 'var(--ink3)'],
  [/#6E6659\b/g, 'var(--muted)'],
  [/#8C8474\b/g, 'var(--soft)'],
  [/#A79E8B\b/g, 'var(--faint2)'],
  [/#B5AC98\b/g, 'var(--faint)'],
  [/#CFC7B4\b/g, 'var(--dim)'],
  [/#FCFBF6\b/g, 'var(--on-accent)'],
  [/#5F6E42\b/g, 'var(--accent-text)'],
  [/#A85A45\b/g, 'var(--warn)'],
  [/rgba\(38,\s*35,\s*29,/g, 'rgba(var(--ink-rgb),'],
  [/rgba\(250,\s*246,\s*239,/g, 'rgba(var(--bg-rgb),'],
]

export function S(str) {
  let o = cache.get(str)
  if (o) return o
  o = {}
  let css = str
  for (const [re, sub] of PALETTE) css = css.replace(re, sub)
  for (const part of css.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    if (!k) continue
    o[k.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = part.slice(i + 1).trim()
  }
  if (cache.size < 4000) cache.set(str, o)
  return o
}
