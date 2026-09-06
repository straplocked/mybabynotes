// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// Duty and shifts. The rule these pin: holding duty and having a shift open
// are different things — duty is seeded to the founding account at registration
// and handed straight back by /shifts/handback, and neither opens a shift.
// Whoever lands in that gap gets the "Start your shift" framing of the shift
// sheet, not a dead end where the checklist should be.
//
// Now itself keeps exactly one shift surface: an incoming ask, because that one
// needs answering. Your shift, their shift, and on-duty-with-nothing-open all
// live in the sheet behind the header's one icon button — which is what
// `openShiftSheet` below reaches for. There is no footer shortcut: two openers
// labelled differently ("Hand off" over a sheet whose button said "Hand back")
// was the confusion that removed it.
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

describe('on duty with no shift open', () => {
  it('offers the start framing instead of leaving the checklist slot empty', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture())
    renderApp()

    const s = await openShiftSheet(user, 'Start my shift')
    expect(s.getByText('Start your shift')).toBeInTheDocument()
    expect(s.getByText('Plan what’s coming so Sam isn’t guessing.')).toBeInTheDocument()
    // the drafted plan is right there, so "start" is not a leap of faith
    expect(s.getAllByText('Feed').length).toBeGreaterThan(0)
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

    const s = await openShiftSheet(user, 'Start my shift')
    await user.click(s.getByText('Start my shift'))

    await waitFor(() => expect(body).toBeTruthy())
    expect(body.plan.length).toBeGreaterThan(0)
    expect(body.plan.every(p => typeof p.at === 'number')).toBe(true)
    expect(body.until).toBe('Until she wakes') // canonical English on the wire
    // accepting closes the sheet; the header button now names the running shift
    expect(await screen.findByLabelText('Your shift')).toBeInTheDocument()
    expect(screen.queryByLabelText('Start my shift')).not.toBeInTheDocument()
  })

  it('a pending ask of mine reads as waiting, not as "start"', async () => {
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
    expect(s.queryByText('Start my shift')).not.toBeInTheDocument()
  })
})

describe('a shift that is actually open', () => {
  it('my active shift shows the checklist, not the start framing', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ shift: activeShift(1) }))
    renderApp()

    const s = await openShiftSheet(user, 'Your shift')
    expect(s.getByText('Your shift')).toBeInTheDocument()
    expect(s.getByText('Add to plan')).toBeInTheDocument()
    expect(s.queryByText('Start your shift')).not.toBeInTheDocument()
  })

  it('the partner’s active shift clears a plan left over from mine', async () => {
    // duty moved to Sam while this device was asleep; the cached plan must not
    // paint a second, stale checklist beside theirs
    const user = userEvent.setup()
    seedSignedIn({ plan: [{ id: 'p9', type: 'bottle', at: Date.now() + 3600_000 }] })
    routes['GET /state'] = () => okJson(stateFixture({ onDutyUserId: 2, shift: activeShift(2) }))
    renderApp()

    const s = await openShiftSheet(user, 'Sam’s shift')
    expect(s.getByText('Sam’s shift')).toBeInTheDocument()
    expect(s.getByText('Take over from Sam')).toBeInTheDocument()
    expect(s.queryByText('Your shift')).not.toBeInTheDocument()
  })

  it('Now itself stays clear of shift cards — only the header carries the state', async () => {
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ shift: activeShift(1) }))
    renderApp()

    await screen.findByLabelText('Your shift')
    // the sheet is unmounted, so nothing shift-shaped is on the page yet
    expect(document.querySelector('[style*="z-index: 50"]')).toBeNull()
    expect(screen.queryByText('Add to plan')).not.toBeInTheDocument()
  })
})

// Two actions that both move duty, and used to sit side by side naming the
// same person. Hand back is immediate and only exists when someone handed the
// shift TO you — it's the cover being returned. Asking waits for a yes, and is
// the only way out of a shift you started yourself.
describe('handing back vs asking', () => {
  it('a shift Sam handed me offers both, with verbs that say which waits', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ shift: activeShift(1, { requester_id: 2 }) }))
    renderApp()

    const s = await openShiftSheet(user, 'Your shift')
    expect(s.getByText('Hand back to Sam now')).toBeInTheDocument()
    expect(s.getByText('Ask Sam to take over')).toBeInTheDocument()
    expect(s.getByText('Handing back moves duty straight away. Asking waits for them to accept.')).toBeInTheDocument()
  })

  it('a shift I started myself can only be asked away — there is nothing to hand back', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    // requester_id null: nobody handed me this, so "hand back to Sam" would be
    // a transfer Sam never agreed to, dressed up as a return
    routes['GET /state'] = () => okJson(stateFixture({ shift: activeShift(1, { requester_id: null }) }))
    renderApp()

    const s = await openShiftSheet(user, 'Your shift')
    expect(s.getByText('Ask Sam to take over')).toBeInTheDocument()
    expect(s.queryByText(/^Hand back to/)).not.toBeInTheDocument()
    // the handback note goes with it — the ask sheet carries its own
    expect(s.queryByText('Note for Sam')).not.toBeInTheDocument()
  })

  it('handing back completes the shift and returns duty to whoever asked', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ shift: activeShift(1, { requester_id: 2 }) }))
    let body
    routes['POST /shifts/handback'] = opts => { body = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()

    const s = await openShiftSheet(user, 'Your shift')
    await user.type(s.getByPlaceholderText(/took the 1am bottle slow/), 'she fed at 2')
    await user.click(s.getByText('Hand back to Sam now'))

    await waitFor(() => expect(body).toBeTruthy())
    expect(body.note).toBe('she fed at 2')
    // duty moved on the spot — no waiting for Sam to answer
    expect(await screen.findByLabelText('Take over from Sam')).toBeInTheDocument()
  })
})

describe('the ask carries the plan its author wrote', () => {
  const openAsk = async user => {
    await openShiftSheet(user, 'Start my shift')
    await user.click(await settled(await screen.findByText('Ask Sam to take over')))
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
    await openShiftSheet(user, 'Start my shift')
    await user.click(await settled(await screen.findByText('Ask Sam to take over')))
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

    const s = await openShiftSheet(user, 'Your shift')
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

    const s = await openShiftSheet(user, 'Your shift')
    // one row is done and frozen; only the pending one stays editable
    expect(s.getAllByLabelText('Remove')).toHaveLength(1)
  })
})

describe('unfinished plan items outlive the shift', () => {
  it('a missed dose carries into the next draft; a missed feed does not', async () => {
    const user = userEvent.setup()
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

    // the handback report auto-opens; dismiss it to reach the start framing
    await user.click(await settled(await screen.findByText('Done')))
    await sheetClosed()
    const s = await openShiftSheet(user, 'Start my shift')
    // the draft keeps the dose at its original (now late) time
    expect(s.getByText('Meds')).toBeInTheDocument()
    // feeds are rhythmic, not owed — the two previewed feeds are fresh predictions
    expect(s.getAllByText('Feed')).toHaveLength(2)
  })
})

describe('after a hand back', () => {
  it('the report lands first, and duty without a shift is a start framing behind it', async () => {
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
    await sheetClosed()

    const s = await openShiftSheet(user, 'Start my shift')
    expect(s.getByText('Start your shift')).toBeInTheDocument()
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
const stillOpen = () => sheet().getByText('Plan what’s coming so Sam isn’t guessing.')
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
    await openShiftSheet(user, 'Start my shift')
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
    const btn = sheet().getByRole('button', { name: /Start my shift/i })
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
