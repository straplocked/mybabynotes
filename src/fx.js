// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// Device-local visual effects: dark mode + tilt parallax.
// These are per-phone preferences (localStorage), unlike the household theme
// (accent/background), which syncs to both parents through settings.

const KEY = 'babylog:fx'
const DEFAULTS = { mode: 'auto', tilt: true } // mode: 'auto' | 'light' | 'dark'

export function getFx() {
  try { return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(KEY)) || {}) } }
  catch { return { ...DEFAULTS } }
}

export function setFx(patch) {
  const v = { ...getFx(), ...patch }
  try { localStorage.setItem(KEY, JSON.stringify(v)) } catch { /* stays for this load only */ }
  syncTilt()
  if (onModeChange) onModeChange()
  return v
}

// ── dark mode ────────────────────────────────────────────────────────────────
// 'auto' follows the OS scheme; where the ambient light sensor is available
// (Android Chrome with the sensor permission), the actual room brightness wins,
// so the app goes dark for a 3am feed even if the OS flips on a clock schedule.
let onModeChange = null
let mql = null
let sensorDark = null // null until the sensor produces a reading

export function isDark() {
  const mode = getFx().mode
  if (mode === 'dark') return true
  if (mode === 'light') return false
  if (sensorDark !== null) return sensorDark
  return !!(mql && mql.matches)
}

export function initFx(onChange) {
  onModeChange = onChange
  try {
    mql = window.matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', () => onModeChange())
  } catch { /* no matchMedia — light it is */ }
  startAmbient()
  syncTilt()
}

function startAmbient() {
  if (typeof window.AmbientLightSensor !== 'function') return
  try {
    const s = new window.AmbientLightSensor({ frequency: 0.5 })
    s.addEventListener('reading', () => {
      // wide hysteresis band so a passing hand shadow doesn't flip the theme
      const next = s.illuminance <= 6 ? true : s.illuminance >= 30 ? false : sensorDark
      if (next !== sensorDark) { sensorDark = next; if (onModeChange) onModeChange() }
    })
    s.addEventListener('error', () => { sensorDark = null })
    s.start()
  } catch { sensorDark = null /* permission policy or flag off — OS scheme still applies */ }
}

// ── tilt parallax ────────────────────────────────────────────────────────────
// Writes unitless --par-x/--par-y (−1…1) onto <html>; .fx-layer in styles.css
// turns them into per-depth translations. Phone tilt drives it where device
// orientation exists; the pointer is the desktop fallback.
export const reduceMotion = () => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}
let tiltBound = false
let raf = 0
let tx = 0, ty = 0 // target from sensor/pointer
let cx = 0, cy = 0 // current, eased toward target
let baseG = null, baseB = null // slow-follow neutral: "level" is however you hold the phone

function onOrient(e) {
  if (e.gamma == null || e.beta == null) return
  if (baseG === null) { baseG = e.gamma; baseB = e.beta }
  baseG += (e.gamma - baseG) * 0.015
  baseB += (e.beta - baseB) * 0.015
  tx = Math.max(-1, Math.min(1, (e.gamma - baseG) / 24))
  ty = Math.max(-1, Math.min(1, (e.beta - baseB) / 24))
  kick()
}
function onPointer(e) {
  tx = ((e.clientX / window.innerWidth) * 2 - 1) * 0.6
  ty = ((e.clientY / window.innerHeight) * 2 - 1) * 0.6
  kick()
}
function frame() {
  raf = 0
  cx += (tx - cx) * 0.08
  cy += (ty - cy) * 0.08
  const r = document.documentElement.style
  r.setProperty('--par-x', cx.toFixed(4))
  r.setProperty('--par-y', cy.toFixed(4))
  // keep animating only while still easing; events kick it awake again
  if (Math.abs(tx - cx) + Math.abs(ty - cy) > 0.002) raf = requestAnimationFrame(frame)
}
function kick() { if (!raf) raf = requestAnimationFrame(frame) }

function syncTilt() {
  const want = getFx().tilt && !reduceMotion()
  if (want === tiltBound) return
  tiltBound = want
  if (want) {
    window.addEventListener('deviceorientation', onOrient)
    window.addEventListener('pointermove', onPointer)
    // iOS grants from a previous session resolve silently; a first-time prompt
    // rejects outside a user gesture and we simply stay still until the
    // settings toggle (a tap) asks again.
    askTiltPermission().catch(() => {})
  } else {
    window.removeEventListener('deviceorientation', onOrient)
    window.removeEventListener('pointermove', onPointer)
    baseG = baseB = null
    tx = ty = 0
    kick() // ease back to center
  }
}

export function askTiltPermission() {
  const D = window.DeviceOrientationEvent
  if (!D || typeof D.requestPermission !== 'function') return Promise.resolve(true)
  return D.requestPermission().then(r => r === 'granted', () => false)
}
