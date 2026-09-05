// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// The multi-timer Now screen: every running timer is a card at the top and a
// row holding its place in the Today list, and its owner can stop it in one
// tap from either surface. The device-local timerSpot pref picks the surface:
// 'top', 'today', or 'both' (default). Timers started by someone else never
// offer a Stop anywhere.
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

let routes
const okJson = data => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })
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
  members: [{ id: 1, name: 'Alex' }, { id: 2, name: 'Kat' }],
  children: [],
  invites: [],
  invitePending: null,
  baby: { name: 'Wren', age: '2–8 wks', birthdate: null },
  entries: [],
  timer: null,
  timers: [],
  onDutyUserId: 1,
  shift: null,
  serverTime: Date.now(),
  settings: { tracking: {}, dismissed: [] },
  ...over,
})

const seedSignedIn = (over = {}) => {
  localStorage.setItem(TOKEN_KEY, 'tok-cached')
  localStorage.setItem(STORE_KEY, JSON.stringify({
    screen: 'home', babyName: 'Wren', age: '2–8 wks',
    me: { id: 1, name: 'Alex', householdId: 7 },
    members: [{ id: 1, name: 'Alex' }, { id: 2, name: 'Kat' }], children: [],
    entries: [], outbox: [], lastSync: 5,
    settings: { tracking: {}, dismissed: [] },
    ...over,
  }))
}

const renderApp = () => render(<App smartPrefill={true} timeStep="5" unit="oz" />)

// two concurrent timers as /state sends them: mine (nurse) + Kat's (sleep)
const twoTimers = () => [
  { id: 't-nurse', type: 'nurse', started_at: Date.now() - 125_000, user_id: 1, baby_id: null },
  { id: 't-sleep', type: 'sleep', started_at: Date.now() - 65_000, user_id: 2, baby_id: null },
]

describe('multi-timer rows', () => {
  it('renders a top card per running timer, with one-tap Stop only on mine', async () => {
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ timers: twoTimers() }))
    renderApp()

    expect(await screen.findByText('Nursing · You')).toBeInTheDocument()
    expect(screen.getByText('Sleep · Kat')).toBeInTheDocument()
    // my timer stops in one tap on BOTH surfaces (top card + Today row);
    // Kat's never has a Stop anywhere
    expect(screen.getAllByText('Stop')).toHaveLength(2)
  })

  it('one tap on my top card stops that timer by id and logs the entry', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    let stopBody, pushed
    routes['GET /state'] = () => okJson(stateFixture({ timers: twoTimers() }))
    routes['POST /timer/stop'] = opts => { stopBody = JSON.parse(opts.body); return okJson({ ok: true, stopped: null }) }
    routes['POST /entries'] = opts => { pushed = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()

    await screen.findByText('Nursing · You')
    await user.click(screen.getAllByText('Stop')[0]) // DOM order: the top card first

    expect(stopBody).toEqual({ id: 't-nurse' })
    // only my card went away — Kat's sleep timer keeps running
    expect(screen.queryByText('Nursing · You')).not.toBeInTheDocument()
    expect(screen.getByText('Sleep · Kat')).toBeInTheDocument()
    expect(await screen.findByText(/Nursing logged/)).toBeInTheDocument()
    // the timed session flushes through the normal outbox
    await waitFor(() => expect(pushed).toBeTruthy())
    expect(pushed.entries[0].type).toBe('nurse')
    expect(pushed.entries[0].detail).toMatch(/· 2m$/)
  })

  it('the Today-list row stops in one tap too', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    let stopBody
    routes['GET /state'] = () => okJson(stateFixture({ timers: twoTimers() }))
    routes['POST /timer/stop'] = opts => { stopBody = JSON.parse(opts.body); return okJson({ ok: true, stopped: null }) }
    routes['POST /entries'] = () => okJson({ ok: true })
    renderApp()

    await screen.findByText('Nursing · You')
    await user.click(screen.getAllByText('Stop').at(-1)) // DOM order: the Today row last

    expect(stopBody).toEqual({ id: 't-nurse' })
    expect(await screen.findByText(/Nursing logged/)).toBeInTheDocument()
  })

  it('stopping a tummy time timer logs a tummy entry with bare minutes', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    let pushed
    routes['GET /state'] = () => okJson(stateFixture({
      timers: [{ id: 't-tummy', type: 'tummy', started_at: Date.now() - 12 * 60_000, user_id: 1, baby_id: null }],
    }))
    routes['POST /timer/stop'] = () => okJson({ ok: true, stopped: null })
    routes['POST /entries'] = opts => { pushed = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()

    await screen.findByText('Tummy time · You')
    await user.click(screen.getAllByText('Stop')[0])

    expect(await screen.findByText(/Tummy time logged/)).toBeInTheDocument()
    await waitFor(() => expect(pushed).toBeTruthy())
    expect(pushed.entries[0].type).toBe('tummy')
    expect(pushed.entries[0].detail).toBe('12') // minutes, sleep-style, stringified for the wire
  })

  it('a timer someone else started never offers Stop', async () => {
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ timers: [twoTimers()[1]] }))
    renderApp()

    // neither Kat's top card nor her Today row has a Stop
    await screen.findByText('Sleep · Kat')
    expect(screen.getByText('Sleep')).toBeInTheDocument()
    expect(screen.queryByText('Stop')).not.toBeInTheDocument()
  })

  it("timerSpot 'top' keeps the cards and hides the Today rows", async () => {
    seedSignedIn({ timerSpot: 'top' })
    routes['GET /state'] = () => okJson(stateFixture({ timers: twoTimers() }))
    renderApp()

    expect(await screen.findByText('Nursing · You')).toBeInTheDocument()
    // no feed rows: the bare labels don't appear anywhere (entries are empty)
    expect(screen.queryByText('Nursing')).not.toBeInTheDocument()
    expect(screen.queryByText('Sleep')).not.toBeInTheDocument()
  })

  it("timerSpot 'today' keeps the Today rows and hides the top cards", async () => {
    seedSignedIn({ timerSpot: 'today' })
    routes['GET /state'] = () => okJson(stateFixture({ timers: twoTimers() }))
    renderApp()

    expect(await screen.findByText('Nursing')).toBeInTheDocument()
    expect(screen.getByText('Sleep')).toBeInTheDocument()
    expect(screen.queryByText('Nursing · You')).not.toBeInTheDocument()
    expect(screen.queryByText('Sleep · Kat')).not.toBeInTheDocument()
  })

  it('the short-lived timersInFeed=false pref migrates to top-only', async () => {
    seedSignedIn({ timersInFeed: false })
    routes['GET /state'] = () => okJson(stateFixture({ timers: twoTimers() }))
    renderApp()

    expect(await screen.findByText('Nursing · You')).toBeInTheDocument()
    expect(screen.queryByText('Nursing')).not.toBeInTheDocument()
  })

  it('a pre-multi-timer server (singular `timer` key only) still renders its row', async () => {
    seedSignedIn()
    const legacy = stateFixture({ timer: { id: 't-old', type: 'pump', started_at: Date.now() - 30_000, user_id: 1, baby_id: null } })
    delete legacy.timers
    routes['GET /state'] = () => okJson(legacy)
    renderApp()

    expect(await screen.findByText('Pumping · You')).toBeInTheDocument()
  })

  it('starting from the sheet posts a client-generated id and shows the row', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    let startBody
    routes['GET /state'] = () => okJson(stateFixture())
    routes['POST /timer/start'] = opts => {
      startBody = JSON.parse(opts.body)
      return okJson({ ok: true, timer: { id: startBody.id, type: startBody.type, started_at: Date.now(), user_id: 1, baby_id: null } })
    }
    renderApp()

    await user.click(screen.getByText('add')) // the floating log button (icon ligature)
    // the sheet is pointer-events:none until its enter animation lands (double rAF)
    await waitFor(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))))
    await user.click(screen.getByText('Nursing'))
    await user.click(screen.getByText('Start nursing'))

    expect(startBody.type).toBe('nurse')
    expect(startBody.id).toBeTruthy() // client-generated, entry-style
    expect(await screen.findByText('Nursing · You')).toBeInTheDocument()
  })
})
