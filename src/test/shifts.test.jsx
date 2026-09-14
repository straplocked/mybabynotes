// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// Covers. The rule these pin: nobody is on duty unless somebody is actually
// covering. Shared is the resting state — a fresh household boots into it, and
// every ending returns to it — so the app stops asserting a rota that two
// grown-ups at home don't have. Duty only exists while a cover is open.
//
// (The wire still says `shift`: /shifts/*, `onDutyUserId`, the MQTT on_duty
// sensor. Installed PWAs hit the new server before their JS updates, so only
// the copy moved.)
//
// Now itself keeps exactly one cover surface: an incoming ask, because that one
// needs answering. Your cover, someone else's, and nobody's all live in the
// sheet behind the header's one icon button — which is what `openShiftSheet`
// below reaches for. There is no footer shortcut: two openers labelled
// differently ("Hand off" over a sheet whose button said "Hand back") was the
// confusion that removed it, and the same rule is why a running cover now has
// one ending plus a neutral "Hand it to someone else" link, never two rival
// verbs naming the same person.
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
  entries: [], timer: null, onDutyUserId: null, shift: null,
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
    entries: feeds(), outbox: [], lastSync: 5, onDutyUserId: null,
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

// the sheet keeps rendering while it slides out — the report is only marked
// seen once that lands, so tests that reopen must wait for the unmount
const sheetClosed = () => waitFor(() => expect(document.querySelector('[style*="z-index: 50"]')).toBeNull())

// the header's icon button — its accessible name is the state it opens on
const openShiftSheet = async (user, label) => {
  await user.click(await screen.findByLabelText(label))
  await settled(document.querySelector('[style*="z-index: 50"]').firstChild)
  return sheet()
}

const activeShift = (userId, over = {}) => ({
  id: 11, state: 'active', user_id: userId, requester_id: null,
  plan: [{ id: 'p1', type: 'bottle', at: Date.now() + 40 * 60_000 }],
  until: 'Until she wakes', until_at: null, started_at: Date.now() - 90 * 60_000, ...over,
})

describe('nobody covering', () => {
  it('is a real state with its own framing, not an empty checklist slot', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture())
    renderApp()

    const s = await openShiftSheet(user, 'Nobody’s covering')
    expect(s.getByText('Nobody’s covering')).toBeInTheDocument()
    expect(s.getByText('You’re all on Wren together. Start a cover when one of you takes a stretch.')).toBeInTheDocument()
    // the drafted plan is right there, so "start" is not a leap of faith
    expect(s.getAllByText('Feed').length).toBeGreaterThan(0)
  })

  it('starting my own cover opens a real one with the drafted plan', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture())
    let body
    routes['POST /shifts/accept'] = opts => {
      body = JSON.parse(opts.body)
      return okJson({ ok: true, shift: activeShift(1, { plan: body.plan, until: body.until }) })
    }
    renderApp()

    const s = await openShiftSheet(user, 'Nobody’s covering')
    await user.click(s.getByText('I’ve got Wren — start my cover'))

    await waitFor(() => expect(body).toBeTruthy())
    expect(body.plan.length).toBeGreaterThan(0)
    expect(body.plan.every(p => typeof p.at === 'number')).toBe(true)
    expect(body.until).toBe('Until she wakes') // canonical English on the wire
    // that closes the sheet; the header button now names the running cover
    expect(await screen.findByLabelText('You’re covering')).toBeInTheDocument()
    expect(screen.queryByLabelText('Nobody’s covering')).not.toBeInTheDocument()
  })

  it('a pending ask of mine reads as waiting, not as "nobody"', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({
      shift: { id: 12, state: 'requested', requester_id: 1, user_id: null, note: 'Can you take him?', requested_at: Date.now() - 4 * 60_000 },
    }))
    renderApp()

    const s = await openShiftSheet(user, 'Waiting for Sam')
    expect(s.getByText('Waiting for Sam to take over')).toBeInTheDocument()
    // accepting your own ask is a 422 server-side, so the CTA nudges instead
    expect(s.getByText('Ask again')).toBeInTheDocument()
    expect(s.queryByText(/start my cover/)).not.toBeInTheDocument()
  })
})

describe('a cover that is actually running', () => {
  it('my running cover shows the checklist, not the start framing', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ onDutyUserId: 1, shift: activeShift(1) }))
    renderApp()

    const s = await openShiftSheet(user, 'You’re covering')
    expect(s.getByText('You’re covering')).toBeInTheDocument()
    expect(s.getByText('Add to plan')).toBeInTheDocument()
    expect(s.queryByText('Nobody’s covering')).not.toBeInTheDocument()
  })

  it('someone else’s running cover clears a plan left over from mine', async () => {
    // the cover moved to Sam while this device was asleep; the cached plan must
    // not paint a second, stale checklist beside theirs
    const user = userEvent.setup()
    seedSignedIn({ plan: [{ id: 'p9', type: 'bottle', at: Date.now() + 3600_000 }] })
    routes['GET /state'] = () => okJson(stateFixture({ onDutyUserId: 2, shift: activeShift(2) }))
    renderApp()

    const s = await openShiftSheet(user, 'Sam is covering')
    expect(s.getByText('Sam is covering')).toBeInTheDocument()
    expect(s.getByText('Take over from Sam')).toBeInTheDocument()
    expect(s.queryByText('You’re covering')).not.toBeInTheDocument()
  })

  it('Now itself stays clear of cover cards — only the header carries the state', async () => {
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ onDutyUserId: 1, shift: activeShift(1) }))
    renderApp()

    await screen.findByLabelText('You’re covering')
    // the sheet is unmounted, so nothing cover-shaped is on the page yet
    expect(document.querySelector('[style*="z-index: 50"]')).toBeNull()
    expect(screen.queryByText('Add to plan')).not.toBeInTheDocument()
  })
})

// The 💔 guard. Two buttons naming the same person, with nothing saying which
// one waited, was the worst confusion this app ever shipped. A cover now has
// ONE ending — it stops, and nobody is covering — plus a link into the compose
// sheet for passing it on, where the CTA says whether it starts or waits.
describe('ending a cover vs passing it on', () => {
  it('offers one ending and one hand-off link, never two rival verbs', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ onDutyUserId: 1, shift: activeShift(1, { requester_id: 2 }) }))
    renderApp()

    const s = await openShiftSheet(user, 'You’re covering')
    expect(s.getByText('End my cover')).toBeInTheDocument()
    expect(s.getByText('Hand it to someone else')).toBeInTheDocument()
    expect(s.getByText('Ending it now means nobody’s covering — you’re all back on.')).toBeInTheDocument()
    // the old pair is gone: no button competes for the same recipient
    expect(s.queryByText(/^Hand back to/)).not.toBeInTheDocument()
    expect(s.queryByText(/^Ask Sam to take over$/)).not.toBeInTheDocument()
    expect(s.queryAllByRole('button', { name: /Sam/ })).toHaveLength(0)
  })

  it('a cover I started myself can still be ended — it is not a dead end', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    // requester_id null: nobody handed me this. It used to have no exit at all.
    routes['GET /state'] = () => okJson(stateFixture({ onDutyUserId: 1, shift: activeShift(1, { requester_id: null }) }))
    renderApp()

    const s = await openShiftSheet(user, 'You’re covering')
    expect(s.getByText('End my cover')).toBeInTheDocument()
    // no note field — the note rides a hand-back, and nobody handed me this
    expect(s.queryByText('Note for Sam')).not.toBeInTheDocument()
  })

  it('ending completes the cover and leaves nobody covering', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ onDutyUserId: 1, shift: activeShift(1, { requester_id: 2 }) }))
    let body
    routes['POST /shifts/end'] = opts => { body = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()

    const s = await openShiftSheet(user, 'You’re covering')
    await user.type(s.getByPlaceholderText(/took the 1am bottle slow/), 'she fed at 2')
    await user.click(s.getByText('End my cover'))

    await waitFor(() => expect(body).toBeTruthy())
    expect(body.note).toBe('she fed at 2')
    // back to shared — not handed to a partner who never agreed to it
    expect(await screen.findByLabelText('Nobody’s covering')).toBeInTheDocument()
  })
})

// The grandparent case, and the reason this whole thing was rebuilt: by the
// time you reach for the phone, grandma is already holding the baby.
describe('assigning a cover', () => {
  const GRAN = [{ id: 1, name: 'Alex' }, { id: 2, name: 'Sam' }, { id: 3, name: 'Gran', role: 'caregiver' }]
  const withGran = (over = {}) => stateFixture({ members: GRAN, ...over })

  const openCompose = async user => {
    const s = await openShiftSheet(user, 'Nobody’s covering')
    await user.click(s.getByText('Hand it to someone else'))
    await settled(document.querySelector('[style*="z-index: 50"]').firstChild)
    return sheet()
  }

  it('lists every other grown-up by name, so grandma can be picked', async () => {
    const user = userEvent.setup()
    seedSignedIn({ members: GRAN })
    routes['GET /state'] = () => okJson(withGran())
    renderApp()

    const s = await openCompose(user)
    expect(s.getByText('Who’s covering?')).toBeInTheDocument()
    expect(s.getByRole('button', { name: 'Gran' })).toBeInTheDocument()
    expect(s.getByRole('button', { name: 'Sam' })).toBeInTheDocument()
  })

  it('defaults a carer to "here now" and a co-parent to "ask first"', async () => {
    const user = userEvent.setup()
    seedSignedIn({ members: GRAN })
    routes['GET /state'] = () => okJson(withGran())
    renderApp()

    const s = await openCompose(user)
    await user.click(s.getByRole('button', { name: 'Gran' }))
    expect(s.getByText('Start Gran’s cover now')).toBeInTheDocument()
    expect(s.getByText('Starts now. Gran gets the plan and a ping.')).toBeInTheDocument()

    await user.click(s.getByRole('button', { name: 'Sam' }))
    expect(s.getByText('Send to Sam')).toBeInTheDocument()
    expect(s.getByText('Nothing changes until they say yes.')).toBeInTheDocument()
  })

  it('assigning starts the cover immediately — there is nothing to accept', async () => {
    const user = userEvent.setup()
    seedSignedIn({ members: GRAN })
    routes['GET /state'] = () => okJson(withGran())
    let body
    routes['POST /shifts/assign'] = opts => { body = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()

    const s = await openCompose(user)
    await user.click(s.getByRole('button', { name: 'Gran' }))
    await user.type(s.getByPlaceholderText(/bottle’s in the fridge/), 'bottle in the fridge')
    await user.click(s.getByText('Start Gran’s cover now'))

    await waitFor(() => expect(body).toBeTruthy())
    expect(body.user_id).toBe(3)
    expect(body.note).toBe('bottle in the fridge')
    expect(body.plan.length).toBeGreaterThan(0)
    expect(body.until).toBe('Until she wakes') // canonical English on the wire
    // and the header says who has the baby, without a round trip
    expect(await screen.findByLabelText('Gran is covering')).toBeInTheDocument()
  })

  it('a caregiver is never offered the assign option — only a parent may', async () => {
    const user = userEvent.setup()
    const carerMe = { id: 3, name: 'Gran', householdId: 7, role: 'caregiver' }
    seedSignedIn({ me: carerMe, members: GRAN })
    routes['GET /state'] = () => okJson(withGran({ user: carerMe }))
    renderApp()

    const s = await openCompose(user)
    await user.click(s.getByRole('button', { name: 'Sam' }))
    expect(s.queryByText('They’re here now')).not.toBeInTheDocument()
    expect(s.getByText('Send to Sam')).toBeInTheDocument()
  })
})

describe('a cover that ends on its own', () => {
  it('surfaces the report once when the clock closed my own cover', async () => {
    seedSignedIn()
    // the until passed and the server swept it up: duty is nobody's again and
    // the row is completed with ended_by 'until'
    routes['GET /state'] = () => okJson(stateFixture({
      onDutyUserId: null,
      shift: activeShift(1, { state: 'completed', ended_at: Date.now(), ended_by: 'until' }),
    }))
    renderApp()

    // I didn't do this, so it's news — the report opens without being asked for
    expect(await screen.findByText('Your cover ended')).toBeInTheDocument()
  })

  it('stays quiet about a cover I ended myself', async () => {
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({
      onDutyUserId: null,
      shift: activeShift(1, { state: 'completed', ended_at: Date.now(), ended_by: 'holder' }),
    }))
    renderApp()

    await screen.findByLabelText('Nobody’s covering')
    // popping a report at yourself for something you just did is pure noise
    expect(document.querySelector('[style*="z-index: 50"]')).toBeNull()
  })
})

describe('the ask carries the plan its author wrote', () => {
  const openAsk = async user => {
    await openShiftSheet(user, 'Nobody’s covering')
    await user.click(await settled(await screen.findByText('Hand it to someone else')))
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

    // an incoming ask is the one shift card Now still owns — it needs answering
    expect(await screen.findByText('Sam is asking you to cover')).toBeInTheDocument()
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

    expect(await screen.findByText('Sam is asking you to cover')).toBeInTheDocument()
    expect(screen.getAllByText(/^Feed ~/).length).toBeGreaterThan(0)
  })
})

describe('the plan is editable, not take-it-or-leave-it', () => {
  const openAsk = async user => {
    await openShiftSheet(user, 'Nobody’s covering')
    await user.click(await settled(await screen.findByText('Hand it to someone else')))
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
    // the picked time is what rides the wire — but NOT necessarily as plan[0]:
    // a plan is forward-looking, so a wall-clock time resolves to its nearest
    // occurrence and 02:15 means tomorrow morning once it's past midday. Then
    // it sorts after the drafted rows. Asserting on index 0 made this test pass
    // or fail depending on the hour it ran (green at 12:47 UTC, red at 15:38).
    const times = body.plan.map(p => { const d = new Date(p.at); return [d.getHours(), d.getMinutes()] })
    expect(times).toContainEqual([2, 15])
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

    const s = await openShiftSheet(user, 'You’re covering')
    await user.click(s.getAllByLabelText('Remove')[0])

    await waitFor(() => expect(body).toBeTruthy())
    expect(body.plan.map(p => p.id)).toEqual(['p2'])
  })

  it('a logged item can no longer be moved or dropped', async () => {
    const user = userEvent.setup()
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

    const s = await openShiftSheet(user, 'You’re covering')
    // one row is done and frozen; only the pending one stays editable
    expect(s.getAllByLabelText('Remove')).toHaveLength(1)
  })
})

describe('unfinished plan items outlive the shift', () => {
  it('a missed dose carries into the next draft; a missed feed does not', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    // Sam's cover ended with a meds item and a feed item, neither logged
    routes['GET /state'] = () => okJson(stateFixture({
      onDutyUserId: null,
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

    // the handback report auto-opens; dismiss it to reach the start framing
    await user.click(await settled(await screen.findByText('Done')))
    await sheetClosed()
    const s = await openShiftSheet(user, 'Nobody’s covering')
    // the draft keeps the dose at its original (now late) time
    expect(s.getByText('Meds')).toBeInTheDocument()
    // feeds are rhythmic, not owed — the two previewed feeds are fresh predictions
    expect(s.getAllByText('Feed')).toHaveLength(2)
  })
})

describe('after a cover ends', () => {
  it('the report lands first, and the shared state is behind it', async () => {
    const user = userEvent.setup()
    // Sam's cover is completed and nobody is covering — the app no longer
    // crowns whoever happens to be left
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({
      onDutyUserId: null,
      shift: {
        id: 13, state: 'completed', user_id: 2, requester_id: 1, plan: [],
        started_at: Date.now() - 5 * 3600_000, ended_at: Date.now() - 60_000,
        handback_note: 'took the 1am bottle slow',
      },
    }))
    renderApp()

    expect(await screen.findByText('Sam’s cover is over')).toBeInTheDocument()
    expect(screen.getByText('“took the 1am bottle slow”')).toBeInTheDocument()

    await user.click(await settled(screen.getByText('Done')))
    await sheetClosed()

    const s = await openShiftSheet(user, 'Nobody’s covering')
    expect(s.getByText('You’re all on Wren together. Start a cover when one of you takes a stretch.')).toBeInTheDocument()
  })
})

// ── the grab ────────────────────────────────────────────────────────────────
// The shift sheet is a drawer like the entry sheet, and it now grabs like one:
// both run App.sheetGestures, so these pin the shared contract as much as the
// shift sheet itself. The thresholds under test (110px, or 30px with a flick)
// live in one place for both drawers.
const shiftPanel = () => document.querySelector('[style*="z-index: 50"]').lastChild
const handle = () => shiftPanel().firstElementChild
const body = () => shiftPanel().children[1]
const stillOpen = () => sheet().getByText('You’re all on Wren together. Start a cover when one of you takes a stretch.')
// One pointer stroke. jsdom's clock never advances between synthetic events, so
// any move reads as an infinite-velocity flick — `flick: false` ends on a
// zero-delta move that settles velocity back to 0, which is what lets the
// distance thresholds be tested apart from the velocity one.
const drag = (el, dy, { flick = false } = {}) => {
  fireEvent.pointerDown(el, { clientY: 400, pointerId: 1 })
  fireEvent.pointerMove(el, { clientY: 400 + dy, pointerId: 1 })
  if (!flick) fireEvent.pointerMove(el, { clientY: 400 + dy, pointerId: 1 })
  fireEvent.pointerUp(el, { clientY: 400 + dy, pointerId: 1 })
}

describe('dragging the hand-off drawer', () => {
  const openIt = async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture())
    renderApp()
    await openShiftSheet(user, 'Nobody’s covering')
    return user
  }

  it('a pull down on the handle dismisses it', async () => {
    await openIt()
    drag(handle(), 160)
    await sheetClosed()
  })

  it('a short pull springs back instead of dismissing', async () => {
    await openIt()
    drag(handle(), 20)
    // still open, and parked at 0 rather than holding the dragged offset
    expect(shiftPanel().style.transform).toBe('translateY(0px)')
    expect(stillOpen()).toBeInTheDocument()
  })

  it('a flick dismisses on velocity, short of the distance threshold', async () => {
    await openIt()
    drag(handle(), 50, { flick: true }) // 50px in one frame — under 110, but fast
    await sheetClosed()
  })

  it('follows the finger while dragging, with the slide-back transition off', async () => {
    await openIt()
    fireEvent.pointerDown(handle(), { clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(handle(), { clientY: 460, pointerId: 1 })
    expect(shiftPanel().style.transform).toBe('translateY(60px)')
    expect(shiftPanel().style.transition).toBe('none')
    fireEvent.pointerUp(handle(), { clientY: 460, pointerId: 1 })
  })

  it('rubber-bands upward rather than expanding — this drawer has one height', async () => {
    await openIt()
    fireEvent.pointerDown(handle(), { clientY: 400, pointerId: 1 })
    fireEvent.pointerMove(handle(), { clientY: 300, pointerId: 1 }) // -100
    // halved and capped, unlike the entry sheet which would snap to tall here
    expect(shiftPanel().style.transform).toBe('translateY(-46px)')
    fireEvent.pointerUp(handle(), { clientY: 300, pointerId: 1 })
    expect(shiftPanel().style.transform).toBe('translateY(0px)')
    expect(stillOpen()).toBeInTheDocument()
  })

  it('a touch pull-down on the content dismisses too, once it is scrolled to the top', async () => {
    await openIt()
    fireEvent.pointerDown(body(), { clientY: 400, pointerId: 1, pointerType: 'touch' })
    // the first move past the 10px slop only *arms* the drag — it re-bases
    // there so the sheet doesn't jump, so the offset builds from 415, not 400
    fireEvent.pointerMove(body(), { clientY: 415, pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerMove(body(), { clientY: 545, pointerId: 1, pointerType: 'touch' }) // 130
    fireEvent.pointerMove(body(), { clientY: 545, pointerId: 1, pointerType: 'touch' }) // settle
    fireEvent.pointerUp(body(), { clientY: 545, pointerId: 1, pointerType: 'touch' })
    await sheetClosed()
  })

  it('a touch that starts on a control never becomes a drag', async () => {
    await openIt()
    // dispatched on the button, so it bubbles to the body handler with the
    // button as e.target — the case that would otherwise swallow the tap
    const btn = sheet().getByRole('button', { name: /start my cover/i })
    fireEvent.pointerDown(btn, { clientY: 400, pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerMove(btn, { clientY: 560, pointerId: 1, pointerType: 'touch' })
    fireEvent.pointerUp(btn, { clientY: 560, pointerId: 1, pointerType: 'touch' })
    expect(shiftPanel().style.transform).toBe('translateY(0px)')
    expect(stillOpen()).toBeInTheDocument()
  })

  it('a mouse press on the content scrolls, it does not drag the drawer', async () => {
    await openIt()
    fireEvent.pointerDown(body(), { clientY: 400, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerMove(body(), { clientY: 560, pointerId: 1, pointerType: 'mouse' })
    fireEvent.pointerUp(body(), { clientY: 560, pointerId: 1, pointerType: 'mouse' })
    expect(shiftPanel().style.transform).toBe('translateY(0px)')
  })
})
