import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { UNDER_INGRESS } from './base.js'
import { initI18n } from './i18n.js'
import './styles.css'

// the device-language catalog loads before first paint so nothing flashes
// English; a failed load resolves to English and the app renders anyway
initI18n().then(() => {
  createRoot(document.getElementById('root')).render(
    <App smartPrefill={true} timeStep="5" unit="oz" />
  )
})

// no service worker under HA ingress: ingress session cookies poison SW
// caches, a PWA install inside the HA panel is meaningless, and the HA
// companion app covers notifications there
if (import.meta.env.PROD && 'serviceWorker' in navigator && !UNDER_INGRESS) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js'))
}
