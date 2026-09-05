// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// Web Push, per device. Permission + the PushManager subscription live in the
// browser; the server keeps one row per endpoint. What actually gets sent is
// governed by the per-user prefs that sync through /state.

const b64ToBytes = s => {
  const pad = '='.repeat((4 - (s.length % 4)) % 4)
  const raw = atob((s + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from(raw, c => c.charCodeAt(0))
}

// iOS Safari only exposes PushManager once the app is installed to the Home Screen
export const pushSupported = () =>
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

export const deviceTz = () => {
  try { return Intl.DateTimeFormat().resolvedOptions().timeZone || null } catch { return null }
}

export async function pushSubscription() {
  if (!pushSupported()) return null
  const reg = await navigator.serviceWorker.getRegistration()
  return reg ? reg.pushManager.getSubscription() : null
}

export async function subscribePush(vapidKey) {
  const reg = await navigator.serviceWorker.getRegistration()
  if (!reg || !vapidKey) throw new Error('not-ready')
  if (await Notification.requestPermission() !== 'granted') throw new Error('denied')
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidKey) })
}
