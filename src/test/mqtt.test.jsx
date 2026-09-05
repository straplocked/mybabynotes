// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// The Home Assistant settings card: MQTT broker config is deliberately not in
// /state — the card lazy-pulls GET /integrations/mqtt on first expand, an
// untouched password field means "keep the stored one" on save, and the whole
// card is parent-only (the server 403s caregivers, so it never renders for
// them). Same route-table fetch mock as tokens.test.jsx.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../echo.js', () => ({
  startEcho: vi.fn(),
  stopEcho: vi.fn(),
  socketId: vi.fn(),
  isEchoConnected: vi.fn(() => false),
}))

import App from '../App.jsx'

const STORE_KEY = 'babylog:v2'
const TOKEN_KEY = 'babylog:token'

// ── fetch route table: 'METHOD /path' → opts => value (or a rejection) ───────
let routes
const okJson = (data, status = 200) => Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(data) })
beforeEach(() => {
  routes = {}
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    const key = (opts.method || 'GET') + ' ' + url.replace(/^\/api/, '').split('?')[0]
    if (!routes[key]) return Promise.reject(new TypeError('fetch failed: no route for ' + key + ' — ' + url))
    return routes[key](opts, url)
  }))
})

const stateFixture = (over = {}) => ({
  user: { id: 1, name: 'Alex', householdId: 7 },
  members: [{ id: 1, name: 'Alex' }],
  children: [],
  invites: [],
  invitePending: null,
  baby: { name: 'Wren', age: '2–8 wks', birthdate: null },
  entries: [],
  timer: null,
  onDutyUserId: 1,
  shift: null,
  serverTime: Date.now(),
  settings: { tracking: {}, dismissed: [] },
  ...over,
})

// GET /integrations/mqtt in the server's shape (config + heartbeat status)
const mqttFixture = (over = {}) => ({
  config: {
    enabled: true, host: 'mqtt.local', port: 1883, username: 'babylog',
    tls: false, tls_verify: true, discovery_prefix: 'homeassistant',
    base_topic: 'babylog', acting_user_id: null, hasPassword: true,
    ...(over.config || {}),
  },
  status: { heartbeatAt: null, ...(over.status || {}) },
})

// A signed-in device whose cached screen is already Settings.
const seedSettings = (me = { id: 1, name: 'Alex', householdId: 7 }) => {
  localStorage.setItem(TOKEN_KEY, 'tok-cached')
  localStorage.setItem(STORE_KEY, JSON.stringify({
    screen: 'settings', babyName: 'Wren', age: '2–8 wks',
    me,
    members: [{ id: 1, name: 'Alex' }], children: [],
    entries: [], outbox: [], lastSync: 5,
    settings: { tracking: {}, dismissed: [] },
  }))
}

const renderApp = () => render(<App smartPrefill={true} timeStep="5" unit="oz" />)

describe('Home Assistant card', () => {
  beforeEach(() => {
    seedSettings()
    routes['GET /state'] = () => okJson(stateFixture())
  })

  it('is hidden from caregivers entirely', async () => {
    seedSettings({ id: 1, name: 'Alex', householdId: 7, role: 'caregiver' })
    routes['GET /state'] = () => okJson(stateFixture({ user: { id: 1, name: 'Alex', householdId: 7, role: 'caregiver' } }))
    renderApp()
    // settings is on screen (the card would sit near this one) but the parent-only card isn't
    expect(await screen.findByText('API access')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText('Home Assistant')).not.toBeInTheDocument())
  })

  it('renders collapsed without touching /integrations/mqtt', () => {
    renderApp()
    expect(screen.getByText('Home Assistant')).toBeInTheDocument()
    // lazy by design: the broker config only loads when the card is opened
    expect(fetch.mock.calls.some(c => String(c[0]).includes('/api/integrations/mqtt'))).toBe(false)
  })

  it('expanding fetches the config and fills the form', async () => {
    const user = userEvent.setup()
    routes['GET /integrations/mqtt'] = () => okJson(mqttFixture())
    renderApp()

    await user.click(screen.getByText('Home Assistant'))
    expect(await screen.findByPlaceholderText('Host')).toHaveValue('mqtt.local')
    expect(screen.getByPlaceholderText('Port')).toHaveValue(1883)
    expect(screen.getByPlaceholderText('Username')).toHaveValue('babylog')
    // a stored password shows as a placeholder, never as a value
    expect(screen.getByPlaceholderText('•••• saved')).toHaveValue('')
  })

  it('saving an untouched password omits it so the stored one is kept', async () => {
    const user = userEvent.setup()
    routes['GET /integrations/mqtt'] = () => okJson(mqttFixture())
    let saved
    routes['POST /integrations/mqtt'] = opts => {
      saved = JSON.parse(opts.body)
      return okJson({ ok: true, config: mqttFixture({ config: { host: 'broker.lan' } }).config })
    }
    renderApp()

    await user.click(screen.getByText('Home Assistant'))
    const host = await screen.findByPlaceholderText('Host')
    await user.clear(host)
    await user.type(host, 'broker.lan')
    await user.click(screen.getByText('Save'))

    await waitFor(() => expect(saved).toBeTruthy())
    expect(saved).toEqual({ enabled: true, host: 'broker.lan', port: 1883, username: 'babylog', tls: false, tls_verify: true })
    expect(saved).not.toHaveProperty('password')
    // the form re-renders from the returned config
    expect(await screen.findByPlaceholderText('Host')).toHaveValue('broker.lan')
  })

  it('a failed connection test shows the broker message inline', async () => {
    const user = userEvent.setup()
    routes['GET /integrations/mqtt'] = () => okJson(mqttFixture())
    routes['POST /integrations/mqtt/test'] = () => okJson({ ok: false, message: 'Connection refused by mqtt.local:1883' })
    renderApp()

    await user.click(screen.getByText('Home Assistant'))
    await user.click(await screen.findByText('Test connection'))

    expect(await screen.findByText('Connection refused by mqtt.local:1883')).toBeInTheDocument()
    expect(screen.queryByText('Connected ✓')).not.toBeInTheDocument()
  })
})
