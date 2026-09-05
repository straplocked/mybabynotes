// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// fx.js keeps module-level state (mql, sensorDark, listeners), so every test
// re-imports a fresh copy via resetModules instead of sharing one instance.
import { describe, it, expect, vi, beforeEach } from 'vitest'

const loadFx = async () => {
  vi.resetModules()
  return import('../fx.js')
}

// Minimal controllable matchMedia: `matches` per query, plus a way to flip
// the color-scheme query and fire its change listeners like the OS would.
const fakeMatchMedia = ({ dark = false, reduce = false } = {}) => {
  const listeners = []
  const state = { dark }
  window.matchMedia = query => {
    const isScheme = query.includes('prefers-color-scheme')
    return {
      media: query,
      get matches() { return isScheme ? state.dark : reduce },
      addEventListener: (_, fn) => { if (isScheme) listeners.push(fn) },
      removeEventListener: () => {},
    }
  }
  return { setDark(d) { state.dark = d; listeners.forEach(fn => fn()) } }
}

beforeEach(() => {
  fakeMatchMedia()
  delete window.AmbientLightSensor
})

describe('getFx / setFx', () => {
  it('returns the defaults when nothing is stored', async () => {
    const { getFx } = await loadFx()
    expect(getFx()).toEqual({ mode: 'auto', tilt: true })
  })

  it('falls back to defaults on corrupt storage', async () => {
    localStorage.setItem('babylog:fx', '{not json')
    const { getFx } = await loadFx()
    expect(getFx()).toEqual({ mode: 'auto', tilt: true })
  })

  it('merges a patch over stored values and persists it', async () => {
    const { setFx, getFx } = await loadFx()
    setFx({ mode: 'dark' })
    setFx({ tilt: false })
    expect(getFx()).toEqual({ mode: 'dark', tilt: false })
    expect(JSON.parse(localStorage.getItem('babylog:fx'))).toEqual({ mode: 'dark', tilt: false })
  })

  it('notifies the initFx onChange callback', async () => {
    const { initFx, setFx } = await loadFx()
    const onChange = vi.fn()
    initFx(onChange)
    setFx({ mode: 'dark' })
    expect(onChange).toHaveBeenCalled()
  })
})

describe('isDark', () => {
  it('honors an explicit light/dark mode over everything', async () => {
    const { setFx, isDark } = await loadFx()
    setFx({ mode: 'dark' })
    expect(isDark()).toBe(true)
    setFx({ mode: 'light' })
    expect(isDark()).toBe(false)
  })

  it('in auto, follows the OS color scheme once initFx has run', async () => {
    const media = fakeMatchMedia({ dark: true })
    const { initFx, isDark } = await loadFx()
    const onChange = vi.fn()
    initFx(onChange)
    expect(isDark()).toBe(true)
    media.setDark(false)
    expect(onChange).toHaveBeenCalled()
    expect(isDark()).toBe(false)
  })

  it('lets the ambient light sensor override the OS scheme, with hysteresis', async () => {
    fakeMatchMedia({ dark: false })
    // fake the Android Chrome sensor: fx.js reads illuminance off the instance
    // it constructs, so the fake hands that instance back for the test to drive
    let sensor = null
    window.AmbientLightSensor = class {
      constructor() { sensor = this; this.handlers = {} }
      addEventListener(kind, fn) { this.handlers[kind] = fn }
      start() {}
      emit(lux) { this.illuminance = lux; this.handlers.reading() }
    }
    const { initFx, isDark } = await loadFx()
    initFx(() => {})
    // dark room (≤6 lux) wins over a light OS scheme
    sensor.emit(3)
    expect(isDark()).toBe(true)
    // mid band (6–30 lux) holds the last reading — a passing shadow can't flip it
    sensor.emit(15)
    expect(isDark()).toBe(true)
    // bright room (≥30 lux) flips back
    sensor.emit(80)
    expect(isDark()).toBe(false)
  })
})
