// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
/* mybabynotes service worker — local-first app shell.
   Navigations: network-first, cache fallback (3am logging never waits on signal).
   Assets + fonts: cache-first with background fill. */
// bumping these purges old caches on activate — v1 served unhashed files
// (manifest included) cache-first forever, so installs kept minting stale;
// v4: the base-path-relative build changed asset URL shapes
const SHELL = 'babylog-shell-v4'
const RUNTIME = 'babylog-rt-v4'

// '/'-rooted paths below are deliberate: this worker only ever registers at
// the origin root (main.jsx skips registration under HA ingress, where the
// per-session cookie would poison these caches anyway)

self.addEventListener('install', () => self.skipWaiting())

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => ![SHELL, RUNTIME].includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  )
})

// Web Push from the api container — payload is {title, body, tag}
self.addEventListener('push', e => {
  let d = {}
  try { d = e.data ? e.data.json() : {} } catch { /* non-JSON push — show the shell */ }
  e.waitUntil(self.registration.showNotification(d.title || 'mybabynotes', {
    body: d.body || '',
    tag: d.tag || 'babylog', // same-kind pushes replace, they don't stack
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
  }))
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(list => list.length ? list[0].focus() : self.clients.openWindow('/'))
  )
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)

  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then(r => {
          const copy = r.clone()
          caches.open(SHELL).then(c => c.put('/', copy))
          return r
        })
        .catch(() => caches.match('/'))
    )
    return
  }

  // never cache the API or the websocket auth — always live
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/app')) return

  // the manifest drives WebAPK minting and the worker drives updates —
  // both must always come from the network, never a cache
  if (url.pathname === '/manifest.webmanifest' || url.pathname === '/sw.js') return

  const cacheable = url.origin === location.origin
    || url.hostname === 'fonts.googleapis.com'
    || url.hostname === 'fonts.gstatic.com'
  if (!cacheable) return

  // content-hashed files can be trusted forever; everything else (art, icons,
  // font css) serves stale and revalidates in the background
  const hashed = url.pathname.startsWith('/assets/') || url.hostname === 'fonts.gstatic.com'
  e.respondWith(
    caches.match(e.request).then(hit => {
      if (hit && hashed) return hit
      const refresh = fetch(e.request).then(r => {
        if (r.ok) {
          const copy = r.clone()
          caches.open(RUNTIME).then(c => c.put(e.request, copy))
        }
        return r
      })
      if (hit) { refresh.catch(() => { /* offline — the hit stands */ }); return hit }
      return refresh
    })
  )
})
