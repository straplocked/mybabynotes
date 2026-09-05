// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// The API access settings card: personal access tokens are deliberately not in
// /state — the card lazy-pulls GET /tokens on first expand, creation reveals
// the plaintext exactly once, and revoke is the same two-tap arm pattern as
// removing a household member. Same route-table fetch mock as app.test.jsx.
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

// GET /tokens in the server's shape (ISO timestamps, nullable)
const tokensFixture = (over = {}) => ({
  tokens: [{
    id: 3, name: 'Node-RED bridge', abilities: ['entries:read', 'timer:read'],
    createdAt: '2026-08-01T00:00:00Z', lastUsedAt: null, expiresAt: null,
  }],
  scopes: {
    'profile:read': 'Read your profile and household members',
    'entries:read': 'Read the log',
    'entries:write': 'Add and edit entries',
    mcp: 'Connect AI assistants via MCP',
  },
  ...over,
})

// A signed-in device whose cached screen is already Settings — the card is
// there for every role, so the default parent cache is fine.
const seedSettings = () => {
  localStorage.setItem(TOKEN_KEY, 'tok-cached')
  localStorage.setItem(STORE_KEY, JSON.stringify({
    screen: 'settings', babyName: 'Wren', age: '2–8 wks',
    me: { id: 1, name: 'Alex', householdId: 7 },
    members: [{ id: 1, name: 'Alex' }], children: [],
    entries: [], outbox: [], lastSync: 5,
    settings: { tracking: {}, dismissed: [] },
  }))
}

const renderApp = () => render(<App smartPrefill={true} timeStep="5" unit="oz" />)

describe('API access card', () => {
  beforeEach(() => {
    seedSettings()
    routes['GET /state'] = () => okJson(stateFixture())
  })

  it('renders collapsed in settings without touching /tokens', () => {
    renderApp()
    expect(screen.getByText('API access')).toBeInTheDocument()
    // lazy by design: the list only loads when the card is opened
    expect(fetch.mock.calls.some(c => String(c[0]).includes('/api/tokens'))).toBe(false)
  })

  it('expanding fetches and lists the tokens with scopes and expiry hints', async () => {
    const user = userEvent.setup()
    routes['GET /tokens'] = () => okJson(tokensFixture())
    renderApp()

    await user.click(screen.getByText('API access'))
    expect(await screen.findByText('Node-RED bridge')).toBeInTheDocument()
    expect(screen.getByText('entries:read · timer:read')).toBeInTheDocument()
    expect(screen.getByText('never used · never expires')).toBeInTheDocument()
  })

  it('creates a token and reveals the plaintext once', async () => {
    const user = userEvent.setup()
    routes['GET /tokens'] = () => okJson(tokensFixture())
    let created
    routes['POST /tokens'] = opts => { created = JSON.parse(opts.body); return okJson({ ok: true, id: 9, token: 'blt_secret123' }, 201) }
    renderApp()

    await user.click(screen.getByText('API access'))
    await user.click(await screen.findByText('New token'))
    // invalid until it has a name and at least one scope
    expect(screen.getByText('Create token')).toBeDisabled()
    await user.type(screen.getByPlaceholderText(/What’s it for/), 'Claude')
    await user.click(screen.getByText('Read the log')) // scope pill, labeled from the fetched scopes map
    await user.click(screen.getByText('Create token'))

    expect(await screen.findByText('blt_secret123')).toBeInTheDocument()
    expect(screen.getByText('You won’t see this again — copy it now.')).toBeInTheDocument()
    // 90 days is the default expiry chip
    expect(created).toEqual({ name: 'Claude', abilities: ['entries:read'], expires_in_days: 90 })
  })

  it('shows a validation rejection inline instead of a token', async () => {
    const user = userEvent.setup()
    routes['GET /tokens'] = () => okJson(tokensFixture())
    routes['POST /tokens'] = () => Promise.resolve({
      ok: false, status: 422, statusText: 'Unprocessable Content',
      json: () => Promise.resolve({ message: 'Nope.', errors: { name: ['That name is taken.'] } }),
    })
    renderApp()

    await user.click(screen.getByText('API access'))
    await user.click(await screen.findByText('New token'))
    await user.type(screen.getByPlaceholderText(/What’s it for/), 'app')
    await user.click(screen.getByText('Read the log'))
    await user.click(screen.getByText('Create token'))

    expect(await screen.findByText('That name is taken.')).toBeInTheDocument()
    expect(screen.queryByText('You won’t see this again — copy it now.')).not.toBeInTheDocument()
  })

  it('revoking takes two taps and only then calls the server', async () => {
    const user = userEvent.setup()
    routes['GET /tokens'] = () => okJson(tokensFixture())
    let revoked
    routes['POST /tokens/revoke'] = opts => {
      revoked = JSON.parse(opts.body)
      routes['GET /tokens'] = () => okJson(tokensFixture({ tokens: [] }))
      return okJson({ ok: true })
    }
    renderApp()

    await user.click(screen.getByText('API access'))
    await user.click(await screen.findByText('Revoke'))
    // armed, not yet revoked
    expect(revoked).toBeUndefined()
    expect(screen.getByText('Node-RED bridge')).toBeInTheDocument()
    await user.click(screen.getByText('Yes, revoke'))

    expect(revoked).toEqual({ id: 3 })
    await waitFor(() => expect(screen.queryByText('Node-RED bridge')).not.toBeInTheDocument())
  })
})
