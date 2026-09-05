// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// APP_BASE/UNDER_INGRESS read the document URL at import time, so each case
// rewrites the jsdom path (replaceState — same trick App uses) and re-imports.
import { describe, it, expect, vi, afterEach } from 'vitest'

const loadAt = async path => {
  window.history.replaceState(null, '', path)
  vi.resetModules()
  return import('../base.js')
}

afterEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('APP_BASE', () => {
  it('is / when served at the origin root', async () => {
    const { APP_BASE } = await loadAt('/')
    expect(APP_BASE).toBe('/')
  })

  it('drops the document filename: /index.html → /', async () => {
    const { APP_BASE } = await loadAt('/index.html')
    expect(APP_BASE).toBe('/')
  })

  it('keeps the HA ingress prefix, trailing slash included', async () => {
    const { APP_BASE } = await loadAt('/api/hassio_ingress/AbC123-tok_en/')
    expect(APP_BASE).toBe('/api/hassio_ingress/AbC123-tok_en/')
  })

  it('normalizes an ingress document URL back to its directory', async () => {
    const { APP_BASE } = await loadAt('/api/hassio_ingress/AbC123-tok_en/index.html')
    expect(APP_BASE).toBe('/api/hassio_ingress/AbC123-tok_en/')
  })
})

describe('UNDER_INGRESS', () => {
  it('is false at the origin root', async () => {
    const { UNDER_INGRESS } = await loadAt('/')
    expect(UNDER_INGRESS).toBe(false)
  })

  it('is true under the HA ingress prefix', async () => {
    const { UNDER_INGRESS } = await loadAt('/api/hassio_ingress/AbC123-tok_en/')
    expect(UNDER_INGRESS).toBe(true)
  })
})
