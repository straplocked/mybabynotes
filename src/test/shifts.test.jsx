// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// Duty and shifts on the Now screen. The rule these pin: holding duty and
// having a shift open are different things — duty is seeded to the founding
// account at registration and handed straight back by /shifts/handback, and
// neither opens a shift. Whoever lands in that gap gets the "You're on duty"
// start card, not a blank screen where the checklist should be.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within, fireEvent } from '@testing-library/react'
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

// the sheet mounts off-screen and only takes pointers after its two-frame
// slide-up; every re-mount (e.g. switching into compose mode) repeats it
const settled = async el => {
  const overlay = el.closest('[style*="z-index: 50"]')
  await waitFor(() => expect(getComputedStyle(overlay).pointerEvents).toBe('auto'))
  return el
}
// the open sheet, for queries whose text also appears on the Now screen behind it
const sheet = () => within(document.querySelector('[style*="z-index: 50"]'))

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

describe('the ask carries the plan its author wrote', () => {
  const openAsk = async user => {
    await user.click((await screen.findAllByText('Start my shift')).at(-1)) // footer → duty sheet
    await user.click(await settled(await screen.findByText('Hand off to Sam')))
  }

  it('composing a handoff sends the plan, window, and note — not just prose', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture())
    let body
    routes['POST /shifts/request'] = opts => { body = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()

    await openAsk(user)
    await user.type(await settled(await screen.findByPlaceholderText(/she went down at 11/)), 'bottle in the fridge')
    await user.click(screen.getByText('Send to Sam'))

    await waitFor(() => expect(body).toBeTruthy())
    expect(body.note).toBe('bottle in the fridge')
    expect(body.plan.length).toBeGreaterThan(0)
    expect(body.until).toBe('Until she wakes')
    expect(body.target_id).toBeNull() // two adults — no one to disambiguate
  })

  it('the receiver sees the sender’s plan, not their own device’s guess', async () => {
    seedSignedIn()
    // Sam asks, proposing a nurse at a time this device would never predict
    routes['GET /state'] = () => okJson(stateFixture({
      onDutyUserId: 2,
      shift: {
        id: 21, state: 'requested', requester_id: 2, target_id: null, note: 'so tired',
        plan: [{ id: 'x1', type: 'nurse', at: Date.now() + 90 * 60_000 }],
        until: 'Until 6 AM', until_at: null, requested_at: Date.now() - 60_000,
      },
    }))
    renderApp()

    expect(await screen.findByText('Sam is handing off')).toBeInTheDocument()
    expect(screen.getByText(/^Nursing ~/)).toBeInTheDocument()
    expect(screen.queryByText(/^Feed ~/)).not.toBeInTheDocument()
  })

  it('accepting from the card submits the plan it showed, not a local draft', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    const proposed = [{ id: 'x1', type: 'nurse', at: Date.now() + 90 * 60_000 }]
    routes['GET /state'] = () => okJson(stateFixture({
      onDutyUserId: 2,
      shift: {
        id: 24, state: 'requested', requester_id: 2, target_id: null, note: 'so tired',
        plan: proposed, until: 'Until 6 AM', until_at: null, requested_at: Date.now() - 60_000,
      },
    }))
    let body
    routes['POST /shifts/accept'] = opts => { body = JSON.parse(opts.body); return okJson({ ok: true, shift: activeShift(1, { plan: proposed }) }) }
    renderApp()

    await user.click(await screen.findByText('I’ve got him'))

    await waitFor(() => expect(body).toBeTruthy())
    expect(body.plan.map(p => p.type)).toEqual(['nurse'])
    expect(body.until).toBe('Until 6 AM') // the window they proposed, not this device's default
  })

  it('an ask with no plan still falls back to the local draft', async () => {
    // an installed client that predates plan-carrying asks
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({
      onDutyUserId: 2,
      shift: { id: 22, state: 'requested', requester_id: 2, note: 'take him?', requested_at: Date.now() },
    }))
    renderApp()

    expect(await screen.findByText('Sam is handing off')).toBeInTheDocument()
    expect(screen.getAllByText(/^Feed ~/).length).toBeGreaterThan(0)
  })
})

describe('the plan is editable, not take-it-or-leave-it', () => {
  const openAsk = async user => {
    await user.click((await screen.findAllByText('Start my shift')).at(-1))
    await user.click(await settled(await screen.findByText('Hand off to Sam')))
  }

  it('a time you pick on a drafted row is the time that gets sent', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture())
    let body
    routes['POST /shifts/request'] = opts => { body = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()

    await openAsk(user)
    const [first] = await screen.findAllByDisplayValue(/^\d\d:\d\d$/)
    await settled(first)
    fireEvent.change(first, { target: { value: '02:15' } }) // what the native picker does
    await user.click(screen.getByText('Send to Sam'))

    await waitFor(() => expect(body).toBeTruthy())
    const at = new Date(body.plan[0].at)
    expect([at.getHours(), at.getMinutes()]).toEqual([2, 15])
  })

  it('adding to the plan lets you choose what, not just another feed', async () => {
    const user = userEvent.setup()
    seedSignedIn({ settings: { tracking: {}, dismissed: [] } })
    routes['GET /state'] = () => okJson(stateFixture())
    let body
    routes['POST /shifts/request'] = opts => { body = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()

    await openAsk(user)
    await user.click(await settled(await screen.findByText('Add to plan')))
    await user.click(sheet().getByText('Bath')) // "Bath" is also a since-card behind the sheet
    await user.click(screen.getByText('Send to Sam'))

    await waitFor(() => expect(body).toBeTruthy())
    expect(body.plan.map(p => p.type)).toContain('bath')
  })

  it('dropping an item from a running shift pushes the shorter plan', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    const plan = [
      { id: 'p1', type: 'bottle', at: Date.now() + 40 * 60_000 },
      { id: 'p2', type: 'meds', at: Date.now() + 4 * 3600_000 },
    ]
    routes['GET /state'] = () => okJson(stateFixture({ shift: activeShift(1, { plan }) }))
    let body
    routes['POST /shifts/plan'] = opts => { body = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()

    expect(await screen.findByText('Your shift')).toBeInTheDocument()
    await user.click(screen.getAllByLabelText('Remove')[0])

    await waitFor(() => expect(body).toBeTruthy())
    expect(body.plan.map(p => p.id)).toEqual(['p2'])
  })

  it('a logged item can no longer be moved or dropped', async () => {
    seedSignedIn({
      entries: [...feeds(), { id: 'done', type: 'bottle', t: Date.now() - 30 * 60_000, detail: 4, deleted: false, by: 1, babyId: null }],
    })
    routes['GET /state'] = () => okJson(stateFixture({
      shift: activeShift(1, {
        started_at: Date.now() - 90 * 60_000,
        plan: [
          { id: 'p1', type: 'bottle', at: Date.now() - 35 * 60_000 }, // matched by the logged feed
          { id: 'p2', type: 'meds', at: Date.now() + 3 * 3600_000 },
        ],
      }),
    }))
    renderApp()

    expect(await screen.findByText('Your shift')).toBeInTheDocument()
    // one row is done and frozen; only the pending one stays editable
    expect(screen.getAllByLabelText('Remove')).toHaveLength(1)
  })
})

describe('unfinished plan items outlive the shift', () => {
  it('a missed dose carries into the next draft; a missed feed does not', async () => {
    seedSignedIn()
    // Sam's shift ended with a meds item and a feed item, neither logged
    routes['GET /state'] = () => okJson(stateFixture({
      onDutyUserId: 1,
      settings: { tracking: { meds: true }, dismissed: [] },
      shift: {
        id: 23, state: 'completed', user_id: 2, requester_id: 1,
        plan: [
          { id: 'm1', type: 'meds', at: Date.now() - 3 * 3600_000 },
          { id: 'b1', type: 'bottle', at: Date.now() - 2 * 3600_000 },
        ],
        started_at: Date.now() - 5 * 3600_000, ended_at: Date.now() - 60_000,
        handback_note: null,
      },
    }))
    renderApp()

    // the start card's preview keeps the dose at its original (now late) time
    expect(await screen.findByText('You’re on duty')).toBeInTheDocument()
    expect(screen.getByText(/^Meds ~/)).toBeInTheDocument()
    // feeds are rhythmic, not owed — the two previewed feeds are fresh predictions
    const feeds = screen.getAllByText(/^Feed ~/)
    expect(feeds).toHaveLength(2)
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

    await user.click(await settled(screen.getByText('Done')))

    expect(await screen.findByText('You’re on duty')).toBeInTheDocument()
    expect(screen.getAllByText('Start my shift').length).toBeGreaterThan(0)
  })
})
