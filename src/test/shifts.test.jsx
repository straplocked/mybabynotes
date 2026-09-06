// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// Duty and shifts on the Now screen. The rule these pin: holding duty and
// having a shift open are different things — duty is seeded to the founding
// account at registration and handed straight back by /shifts/handback, and
// neither opens a shift. Whoever lands in that gap gets the "You're on duty"
// start card, not a blank screen where the checklist should be.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../echo.js', () => ({
  startEcho: vi.fn(), stopEcho: vi.fn(), socketId: vi.fn(), isEchoConnected: vi.fn(() => false),
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
    if (!routes[key]) return Promise.reject(new TypeError('fetch failed: no route for ' + key))
    return routes[key](opts, url)
  }))
})

const ME = { id: 1, name: 'Alex', householdId: 7 }
const MEMBERS = [{ id: 1, name: 'Alex' }, { id: 2, name: 'Sam' }]

const stateFixture = (over = {}) => ({
  user: ME, partner: { id: 2, name: 'Sam' }, members: MEMBERS,
  children: [], invites: [], invitePending: null,
  baby: { name: 'Wren', age: '2–8 wks', birthdate: null },
  entries: [], timer: null, onDutyUserId: 1, shift: null,
  serverTime: Date.now(), settings: { tracking: {}, dismissed: [] },
  ...over,
})

// a household that has been logging a while: two feeds three hours apart give
// draftPlan() a real rhythm to predict the next ones from
const feeds = () => [
  { id: 'f1', type: 'bottle', t: Date.now() - 6 * 3600_000, detail: 4, deleted: false, by: 2, babyId: null },
  { id: 'f2', type: 'bottle', t: Date.now() - 3 * 3600_000, detail: 4, deleted: false, by: 2, babyId: null },
]

const seedSignedIn = (over = {}) => {
  localStorage.setItem(TOKEN_KEY, 'tok-cached')
  localStorage.setItem(STORE_KEY, JSON.stringify({
    screen: 'home', babyName: 'Wren', age: '2–8 wks',
    me: ME, partner: { id: 2, name: 'Sam' }, members: MEMBERS, children: [],
    entries: feeds(), outbox: [], lastSync: 5, onDutyUserId: 1,
    settings: { tracking: {}, dismissed: [] },
    ...over,
  }))
}

const renderApp = () => render(<App smartPrefill={true} timeStep="5" unit="oz" />)

const activeShift = (userId, over = {}) => ({
  id: 11, state: 'active', user_id: userId, requester_id: null,
  plan: [{ id: 'p1', type: 'bottle', at: Date.now() + 40 * 60_000 }],
  until: 'Until she wakes', until_at: null, started_at: Date.now() - 90 * 60_000, ...over,
})

describe('on duty with no shift open', () => {
  it('offers the start card instead of leaving the checklist slot empty', async () => {
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture())
    renderApp()

    expect(await screen.findByText('You’re on duty')).toBeInTheDocument()
    expect(screen.getByText('Not started')).toBeInTheDocument()
    expect(screen.getByText('Start a shift so Sam can see the plan and how it’s going.')).toBeInTheDocument()
    // the drafted plan is previewed on the card, so "start" is not a leap of faith
    expect(screen.getAllByText(/^Feed ~/).length).toBeGreaterThan(0)
  })

  it('"Start my shift" opens a real shift with the drafted plan', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture())
    let body
    routes['POST /shifts/accept'] = opts => {
      body = JSON.parse(opts.body)
      return okJson({ ok: true, shift: activeShift(1, { plan: body.plan, until: body.until }) })
    }
    renderApp()

    // the card's CTA and the footer shortcut share the label — take the card's
    await user.click((await screen.findAllByText('Start my shift'))[0])

    await waitFor(() => expect(body).toBeTruthy())
    expect(body.plan.length).toBeGreaterThan(0)
    expect(body.plan.every(p => typeof p.at === 'number')).toBe(true)
    expect(body.until).toBe('Until she wakes') // canonical English on the wire
    // the card gives way to the live checklist
    expect(await screen.findByText('Your shift')).toBeInTheDocument()
    expect(screen.queryByText('You’re on duty')).not.toBeInTheDocument()
  })

  it('a pending ask of mine reads as waiting, not as "start"', async () => {
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({
      shift: { id: 12, state: 'requested', requester_id: 1, user_id: null, note: 'Can you take him?', requested_at: Date.now() - 4 * 60_000 },
    }))
    renderApp()

    // card pill and footer shortcut both name the wait
    expect(await screen.findAllByText('Waiting for Sam')).toHaveLength(2)
    expect(screen.getByText('Waiting for Sam to take over')).toBeInTheDocument()
    // accepting your own ask is a 422 server-side, so the CTA nudges instead
    expect(screen.getByText('Ask again')).toBeInTheDocument()
    expect(screen.queryByText('Start my shift')).not.toBeInTheDocument()
  })
})

describe('a shift that is actually open', () => {
  it('my active shift shows the checklist, not the start card', async () => {
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ shift: activeShift(1) }))
    renderApp()

    expect(await screen.findByText('Your shift')).toBeInTheDocument()
    expect(screen.getByText('Add to plan')).toBeInTheDocument()
    expect(screen.queryByText('You’re on duty')).not.toBeInTheDocument()
  })

  it('the partner’s active shift clears a plan left over from mine', async () => {
    // duty moved to Sam while this device was asleep; the cached plan must not
    // paint a second, stale checklist beside theirs
    seedSignedIn({ plan: [{ id: 'p9', type: 'bottle', at: Date.now() + 3600_000 }] })
    routes['GET /state'] = () => okJson(stateFixture({ onDutyUserId: 2, shift: activeShift(2) }))
    renderApp()

    expect(await screen.findByText('Sam’s shift')).toBeInTheDocument()
    expect(screen.queryByText('Your shift')).not.toBeInTheDocument()
    expect(screen.queryByText('You’re on duty')).not.toBeInTheDocument()
  })
})

describe('after a hand back', () => {
  it('the report lands first, and duty without a shift is a start card behind it', async () => {
    const user = userEvent.setup()
    // Sam handed back: their shift is completed and duty is mine again — the
    // state that used to leave me with no plan and no way to start one
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({
      onDutyUserId: 1,
      shift: {
        id: 13, state: 'completed', user_id: 2, requester_id: 1, plan: [],
        started_at: Date.now() - 5 * 3600_000, ended_at: Date.now() - 60_000,
        handback_note: 'took the 1am bottle slow',
      },
    }))
    renderApp()

    expect(await screen.findByText('Sam handed back')).toBeInTheDocument()
    expect(screen.getByText('“took the 1am bottle slow”')).toBeInTheDocument()

    // the sheet only takes pointers once its two-frame slide-up has landed
    const done = screen.getByText('Done')
    await waitFor(() => expect(getComputedStyle(done.closest('[style*="z-index: 50"]')).pointerEvents).toBe('auto'))
    await user.click(done)

    expect(await screen.findByText('You’re on duty')).toBeInTheDocument()
    expect(screen.getAllByText('Start my shift').length).toBeGreaterThan(0)
  })
})
