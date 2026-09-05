// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// S() is what lets App.jsx carry the design comp's inline CSS verbatim — if
// parsing or the palette rewrite drifts, every screen quietly loses theming.
import { describe, it, expect } from 'vitest'
import { S } from '../s.js'

describe('S() css-string parsing', () => {
  it('splits declarations and camelCases property names', () => {
    expect(S('display:flex;align-items:center;border-top-left-radius:8px')).toEqual({
      display: 'flex',
      alignItems: 'center',
      borderTopLeftRadius: '8px',
    })
  })

  it('trims whitespace and skips malformed or empty segments', () => {
    expect(S('  color : red ;; not-a-declaration ; ;font-size: 12px ')).toEqual({
      color: 'red',
      fontSize: '12px',
    })
  })

  it('splits on the first colon only, so values may contain colons', () => {
    expect(S('background:url(https://x/y.png)')).toEqual({
      background: 'url(https://x/y.png)',
    })
  })

  it('returns the cached object for a repeated string', () => {
    const a = S('padding:4px;margin:2px')
    expect(S('padding:4px;margin:2px')).toBe(a)
  })
})

describe('S() palette → theme-variable rewrite', () => {
  it('rewrites the comp neutrals to CSS variables', () => {
    expect(S('background:#FAF6EF;color:#26231D;border-color:#FFFDF8')).toEqual({
      background: 'var(--bg)',
      color: 'var(--ink)',
      borderColor: 'var(--surface)',
    })
  })

  it('rewrites the comp rgba() ink/bg prefixes to the -rgb variables', () => {
    expect(S('border:1px solid rgba(38,35,29,0.12);background:rgba(250, 246, 239, 0.6)')).toEqual({
      border: '1px solid rgba(var(--ink-rgb),0.12)',
      background: 'rgba(var(--bg-rgb), 0.6)',
    })
  })

  it('rewrites every occurrence within one value', () => {
    expect(S('box-shadow:0 0 0 1px rgba(38,35,29,0.1), 0 2px 4px rgba(38,35,29,0.05)').boxShadow)
      .toBe('0 0 0 1px rgba(var(--ink-rgb),0.1), 0 2px 4px rgba(var(--ink-rgb),0.05)')
  })

  it('leaves accent hexes alone — accents flow through applyTheme, not the table', () => {
    expect(S('background:#E8957A;color:#B5566A')).toEqual({
      background: '#E8957A',
      color: '#B5566A',
    })
  })
})
