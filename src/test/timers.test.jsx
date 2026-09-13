// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// The multi-timer Now screen: every running timer is a card at the top and a
// row holding its place in the Today list, and its owner can stop it in one
// tap from either surface. The device-local timerSpot pref picks the surface:
// 'top', 'today', or 'both' (default). Timers started by someone else never
// offer a Stop anywhere.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
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
  it('renders a top card per running timer, every one stoppable from here', async () => {
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ timers: twoTimers() }))
    renderApp()

    expect(await screen.findByText('Nursing · You')).toBeInTheDocument()
    expect(screen.getByText('Sleep · Kat')).toBeInTheDocument()
    // both timers stop in one tap on BOTH surfaces (top card + Today row) —
    // whoever came on duty can end a session they didn't start
    expect(screen.getAllByText('Stop')).toHaveLength(4)
  })

  it("stopping Kat's timer still credits the sleep to Kat, not to me", async () => {
    const user = userEvent.setup()
    seedSignedIn()
    let stopBody, pushed
    routes['GET /state'] = () => okJson(stateFixture({ timers: twoTimers() }))
    routes['POST /timer/stop'] = opts => { stopBody = JSON.parse(opts.body); return okJson({ ok: true, stopped: null }) }
    routes['POST /entries'] = opts => { pushed = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()

    await screen.findByText('Sleep · Kat')
    // DOM order of the top cards follows activeTimers: nurse (mine), then Kat's sleep
    await user.click(screen.getAllByText('Stop')[1])

    expect(stopBody).toEqual({ id: 't-sleep' })
    expect(screen.queryByText('Sleep · Kat')).not.toBeInTheDocument()
    // the entry names the person who ran the session, not the one who pressed Stop
    await waitFor(() => expect(pushed).toBeTruthy())
    expect(pushed.entries[0].type).toBe('sleep')
    expect(pushed.entries[0].user_id).toBe(2)
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

  it('a timer someone else started offers Stop just like your own', async () => {
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ timers: [twoTimers()[1]] }))
    renderApp()

    // both Kat's top card and her Today row carry a Stop — the person coming
    // on duty ends the nap without waking the one who started it
    await screen.findByText('Sleep · Kat')
    expect(screen.getByText('Sleep')).toBeInTheDocument()
    expect(screen.getAllByText('Stop')).toHaveLength(2)
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

  // "Slept · 4h ago" while the baby is asleep right now reads as a stale log.
  // A running timer owns its since-card until it stops and becomes an entry.
  it('a running timer takes over its since-card instead of reporting a stale log', async () => {
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({ timers: twoTimers() }))
    renderApp()

    // the feeds card and the sleep card go live; the ones with no timer don't
    expect(await screen.findByText('Feeding now')).toBeInTheDocument()
    expect(screen.getByText('Sleeping now')).toBeInTheDocument()
    expect(screen.getByText('Diaper')).toBeInTheDocument()
    expect(screen.queryByText('Fed')).not.toBeInTheDocument()
    expect(screen.queryByText('Slept')).not.toBeInTheDocument()
    // counting up from the timer's start, not down from the last entry
    expect(screen.getAllByText('so far')).toHaveLength(2)
    expect(screen.getAllByText('ago')).toHaveLength(2) // diaper + bath, still "since last"
    // someone else's session says whose it is
    expect(screen.getByText(/^since .* · Kat$/)).toBeInTheDocument()
  })

  it('the card goes back to measuring from the log once the timer stops', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    routes['GET /state'] = () => okJson(stateFixture({
      timers: [{ id: 't-sleep', type: 'sleep', started_at: Date.now() - 65_000, user_id: 1, baby_id: null }],
    }))
    routes['POST /timer/stop'] = () => okJson({ ok: true, stopped: null })
    routes['POST /entries'] = () => okJson({ ok: true })
    renderApp()

    expect(await screen.findByText('Sleeping now')).toBeInTheDocument()
    await user.click(screen.getAllByText('Stop')[0])

    expect(await screen.findByText('Slept')).toBeInTheDocument()
    expect(screen.queryByText('Sleeping now')).not.toBeInTheDocument()
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

// A baby who stirs for five minutes had ONE nap with a gap in it. Resume
// re-opens the logged sleep — backdated to where it started — so stopping it
// rewrites that same entry instead of stacking a second nap on top of it.
describe('resuming a sleep', () => {
  // a 45-minute nap that ended three minutes ago
  const nap = (over = {}) => ({ id: 'nap-1', type: 'sleep', t: Date.now() - 3 * 60_000, detail: 45, by: 1, babyId: null, ...over })
  // the fixture household has no birthdate on file, so the wake-window ceiling
  // is the 120-minute fallback in every test below
  const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime() }
  const pin = ms => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(ms) } // clock only — user-event needs real timers
  afterEach(() => vi.useRealTimers())

  it('offers Resume on the newest sleep, and a feed logged on top of it does NOT take that away', async () => {
    pin(at(15, 0))
    seedSignedIn({ entries: [nap()] })
    routes['GET /state'] = () => okJson(stateFixture())
    const { unmount } = renderApp()
    expect(await screen.findByText('Resume')).toBeInTheDocument()
    unmount()

    // Resume used to ride the newest ENTRY, so this bottle closed the nap for
    // good. It rides the newest SLEEP now: something logged mid-nap doesn't end
    // the nap, only the clock does (see the five-hours-later test below).
    seedSignedIn({ entries: [nap(), { id: 'b1', type: 'bottle', t: at(14, 59), detail: '4', by: 1, babyId: null }] })
    renderApp()
    expect(await screen.findByText('Slept')).toBeInTheDocument()
    expect(screen.getByText('Resume')).toBeInTheDocument()
  })

  // K, mid-nap: "he was sleeping and I stopped the timer and then I nursed him
  // so I added nursing and then the resume button went away. But he's going
  // back to sleep so I wanna hit the resume button because it's part of the
  // same nap."
  it('a nursing logged after the nap still leaves Resume on the SLEEP row', async () => {
    pin(at(15, 0))
    const user = userEvent.setup()
    seedSignedIn({ entries: [
      nap({ t: at(14, 40), detail: 'Nap · 45m' }),                              // woke 20 minutes ago
      { id: 'n1', type: 'nurse', t: at(14, 55), detail: 'Left · 10m', by: 1, babyId: null }, // fed 5 minutes ago
    ] })
    let resumeBody
    routes['GET /state'] = () => okJson(stateFixture())
    routes['POST /timer/resume'] = opts => {
      resumeBody = JSON.parse(opts.body)
      return okJson({ ok: true, timer: { id: resumeBody.id, type: 'sleep', started_at: at(13, 55), user_id: 1, baby_id: null, resumes: 'nap-1' } })
    }
    renderApp()

    expect(await screen.findByText('Left · 10m')).toBeInTheDocument() // the nursing row is there…
    await user.click(screen.getByText('Resume'))                       // …and Resume survived it

    // the nap re-opens, not the nursing — the id on the wire is the sleep's
    expect(resumeBody.entry_id).toBe('nap-1')
  })

  it('a nap that ended five hours ago is a new wake cycle, not a session to resume', async () => {
    pin(at(15, 0))
    seedSignedIn({ entries: [nap({ t: at(10, 0), detail: 'Nap · 45m' })] })
    routes['GET /state'] = () => okJson(stateFixture())
    renderApp()

    // 300 minutes awake, ceiling 120 — whatever happens next is its own nap
    expect(await screen.findByText('Slept')).toBeInTheDocument()
    expect(screen.queryByText('Resume')).not.toBeInTheDocument()
  })

  it('with two naps in the wake window, only the newer one offers Resume', async () => {
    pin(at(15, 0))
    const user = userEvent.setup()
    seedSignedIn({ entries: [
      { id: 'nap-old', type: 'sleep', t: at(13, 30), detail: 'Nap · 40m', by: 1, babyId: null }, // listed first, older
      { id: 'nap-new', type: 'sleep', t: at(14, 40), detail: 'Nap · 20m', by: 1, babyId: null },
    ] })
    let resumeBody
    routes['GET /state'] = () => okJson(stateFixture())
    routes['POST /timer/resume'] = opts => {
      resumeBody = JSON.parse(opts.body)
      return okJson({ ok: true, timer: { id: resumeBody.id, type: 'sleep', started_at: at(14, 20), user_id: 1, baby_id: null, resumes: 'nap-new' } })
    }
    renderApp()

    expect(await screen.findByText('Nap · 20m')).toBeInTheDocument() // both naps are on screen
    expect(screen.getByText('Nap · 40m')).toBeInTheDocument()
    expect(screen.getAllByText('Resume')).toHaveLength(1) // one row, never both
    await user.click(screen.getByText('Resume'))
    expect(resumeBody.entry_id).toBe('nap-new')
  })

  it('a busy stretch that pushes the nap past the 12-row cut still shows its Resume', async () => {
    pin(at(15, 0))
    // thirteen rows land on top of a nap that only ended twenty minutes ago —
    // Today normally stops at twelve, which used to swallow the sleep row whole
    const busy = Array.from({ length: 13 }, (_, i) => ({ id: 'w' + i, type: 'wet', t: at(14, 42 + i), by: 1, babyId: null }))
    seedSignedIn({ entries: [nap({ t: at(14, 40), detail: 'Nap · 45m' }), ...busy] })
    routes['GET /state'] = () => okJson(stateFixture())
    renderApp()

    expect(await screen.findByText('Resume')).toBeInTheDocument()
  })

  it('never offers Resume on a feed, or beside a sleep timer already running', async () => {
    seedSignedIn({ entries: [{ id: 'b1', type: 'bottle', t: Date.now() - 60_000, detail: '4', by: 1, babyId: null }] })
    routes['GET /state'] = () => okJson(stateFixture())
    const { unmount } = renderApp()
    await screen.findByText('Bottle')
    expect(screen.queryByText('Resume')).not.toBeInTheDocument()
    unmount()

    seedSignedIn({ entries: [nap()] })
    routes['GET /state'] = () => okJson(stateFixture({
      timers: [{ id: 't-sleep', type: 'sleep', started_at: Date.now() - 60_000, user_id: 2, baby_id: null }],
    }))
    renderApp()
    // the baby is asleep right now — re-opening the last nap would double-count
    expect(await screen.findByText('Sleep · Kat')).toBeInTheDocument()
    expect(screen.queryByText('Resume')).not.toBeInTheDocument()
  })

  it('resume posts the entry id and the row becomes the running session', async () => {
    const user = userEvent.setup()
    seedSignedIn({ entries: [nap()] })
    let resumeBody
    routes['GET /state'] = () => okJson(stateFixture())
    routes['POST /timer/resume'] = opts => {
      resumeBody = JSON.parse(opts.body)
      return okJson({ ok: true, timer: { id: resumeBody.id, type: 'sleep', started_at: Date.now() - 48 * 60_000, user_id: 1, baby_id: null, resumes: 'nap-1' } })
    }
    renderApp()

    await user.click(await screen.findByText('Resume'))

    expect(resumeBody.entry_id).toBe('nap-1')
    expect(resumeBody.id).toBeTruthy() // client-generated, same shape as a start
    // the sleep is live again: one row for the session, not the old entry too
    expect(await screen.findByText('Sleeping now')).toBeInTheDocument()
    expect(screen.queryByText('Slept')).not.toBeInTheDocument()
    expect(screen.queryByText('Resume')).not.toBeInTheDocument()
  })

  it('stopping a resumed sleep rewrites that one entry with the whole span', async () => {
    const user = userEvent.setup()
    seedSignedIn({ entries: [nap({ detail: 'Nap · 45m' })] })
    let pushed
    routes['GET /state'] = () => okJson(stateFixture({
      timers: [{ id: 't-resumed', type: 'sleep', started_at: Date.now() - 48 * 60_000, user_id: 1, baby_id: null, resumes: 'nap-1' }],
    }))
    routes['POST /timer/stop'] = () => okJson({ ok: true, stopped: null })
    routes['POST /entries'] = opts => { pushed = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()

    await screen.findByText('Sleep · You')
    await user.click(screen.getAllByText('Stop')[0])

    expect(await screen.findByText(/Sleep logged/)).toBeInTheDocument()
    await waitFor(() => expect(pushed).toBeTruthy())
    // ONE row, the original id, now covering start → this wake-up. The "Nap"
    // tag survives; the stir in the middle is part of the sleep.
    expect(pushed.entries).toHaveLength(1)
    expect(pushed.entries[0].id).toBe('nap-1')
    expect(pushed.entries[0].detail).toBe('Nap · 48m')
    expect(pushed.entries[0].deleted).toBe(false)
  })

  it('a resume the server has lost drops the optimistic timer instead of stranding it', async () => {
    const user = userEvent.setup()
    seedSignedIn({ entries: [nap()] })
    routes['GET /state'] = () => okJson(stateFixture())
    routes['POST /timer/resume'] = () => Promise.resolve({
      ok: false, status: 404, json: () => Promise.resolve({ message: 'That sleep is no longer there to resume.' }),
    })
    renderApp()

    await user.click(await screen.findByText('Resume'))

    expect(await screen.findByText('That sleep is no longer there to resume.')).toBeInTheDocument()
    expect(screen.queryByText('Sleeping now')).not.toBeInTheDocument()
    expect(await screen.findByText('Slept')).toBeInTheDocument()
  })
})
