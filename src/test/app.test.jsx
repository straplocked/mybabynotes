// Integration tests for the app shell: auth flows, boot-from-cache, the
// offline signal, and the outbox flush — the client half of the sync rules.
// The server is a route-table fetch mock speaking /state's real shape;
// realtime is stubbed out (tests poke sync() the way Echo would: not at all).
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
import { startEcho } from '../echo.js'

const STORE_KEY = 'babylog:v2'
const TOKEN_KEY = 'babylog:token'

// ── fetch route table: 'METHOD /path' → opts => value (or a rejection) ───────
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

// A /state answer in the server's shape (api/…/StateController) — the parts
// applyState reads. Tests override per case.
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

const serverEntry = (over = {}) => ({
  id: 'e-bottle-1', type: 'bottle', t: Date.now() - 3600_000, detail: '4',
  deleted: false, user_id: 1, baby_id: null, ...over,
})

// What a device that has used the app before keeps in localStorage.
const seedSignedIn = (over = {}) => {
  localStorage.setItem(TOKEN_KEY, 'tok-cached')
  localStorage.setItem(STORE_KEY, JSON.stringify({
    screen: 'home', babyName: 'Wren', age: '2–8 wks',
    me: { id: 1, name: 'Alex', householdId: 7 },
    members: [{ id: 1, name: 'Alex' }], children: [],
    entries: [], outbox: [], lastSync: 5,
    settings: { tracking: {}, dismissed: [] },
    ...over,
  }))
}

const renderApp = () => render(<App smartPrefill={true} timeStep="5" unit="oz" />)

describe('signed out', () => {
  it('lands on the splash screen', () => {
    renderApp()
    expect(screen.getByText('Create an account')).toBeInTheDocument()
    expect(screen.getByText('I already have one')).toBeInTheDocument()
  })

  it('a cached signed-in screen without a token falls back to splash', () => {
    seedSignedIn()
    localStorage.removeItem(TOKEN_KEY)
    renderApp()
    expect(screen.getByText('Create an account')).toBeInTheDocument()
  })
})

describe('login', () => {
  it('logs in, stores the token, pulls /state and lands on home', async () => {
    const user = userEvent.setup()
    let loginBody
    routes['POST /login'] = opts => { loginBody = JSON.parse(opts.body); return okJson({ token: 'tok-1' }) }
    routes['GET /state'] = () => okJson(stateFixture({ entries: [serverEntry()] }))
    renderApp()

    await user.click(screen.getByText('I already have one'))
    await user.type(screen.getByPlaceholderText('Email'), 'alex@example.com')
    await user.type(screen.getByPlaceholderText('Password'), 'hunter22')
    // the CTA's accessible name carries its arrow_forward icon ligature, so
    // click by text; the tab bar also reads "Log in" — the CTA is the last one
    await user.click(screen.getAllByText('Log in').at(-1))

    // home: the pulled entry is on the timeline
    expect(await screen.findByText('Bottle')).toBeInTheDocument()
    expect(loginBody).toEqual({ email: 'alex@example.com', password: 'hunter22' })
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-1')
    // realtime joins the household channel once /state names it
    await waitFor(() => expect(startEcho).toHaveBeenCalledWith('tok-1', 7, expect.anything()))
  })

  it('shows the server rejection instead of navigating', async () => {
    const user = userEvent.setup()
    routes['POST /login'] = () => Promise.resolve({
      ok: false, status: 422, statusText: 'Unprocessable Content',
      json: () => Promise.resolve({ message: 'Nope.', errors: { email: ['These credentials do not match our records.'] } }),
    })
    renderApp()

    await user.click(screen.getByText('I already have one'))
    await user.type(screen.getByPlaceholderText('Email'), 'alex@example.com')
    await user.type(screen.getByPlaceholderText('Password'), 'wrong')
    await user.click(screen.getAllByText('Log in').at(-1))

    expect(await screen.findByText('These credentials do not match our records.')).toBeInTheDocument()
    expect(localStorage.getItem(TOKEN_KEY)).toBeNull()
  })
})

describe('signup', () => {
  it('registers and walks into onboarding when the household has no baby yet', async () => {
    const user = userEvent.setup()
    routes['POST /register'] = () => okJson({ token: 'tok-new' })
    routes['GET /state'] = () => okJson(stateFixture({ baby: null }))
    renderApp()

    await user.click(screen.getByText('Create an account'))
    await user.type(screen.getByPlaceholderText('Your name'), 'Alex')
    await user.type(screen.getByPlaceholderText('Email'), 'alex@example.com')
    await user.type(screen.getByPlaceholderText('Password'), 'hunter22')
    await user.click(screen.getByText('Create account'))

    // onboarding asks for the baby's name
    expect(await screen.findByPlaceholderText('Wren')).toBeInTheDocument()
    expect(localStorage.getItem(TOKEN_KEY)).toBe('tok-new')
  })
})

describe('signed-in boot', () => {
  it('renders home from the device cache, then re-pulls since lastSync', async () => {
    seedSignedIn({ entries: [{ id: 'e1', type: 'nurse', t: Date.now() - 1800_000, detail: 'Left · 12m', deleted: false, by: 1, babyId: null }] })
    routes['GET /state'] = () => okJson(stateFixture())
    renderApp()

    // cached entry paints before any network answer
    expect(screen.getByText('Nursing')).toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/state?since=5', expect.anything()))
  })

  it('shows the quiet offline marker when /state is unreachable', async () => {
    seedSignedIn()
    routes['GET /state'] = () => Promise.reject(new TypeError('fetch failed'))
    renderApp()

    expect(await screen.findByText(/· offline/)).toBeInTheDocument()
  })

  it('a 401 pull drops the stale session cleanly back to splash', async () => {
    seedSignedIn()
    routes['GET /state'] = () => Promise.resolve({
      ok: false, status: 401, statusText: 'Unauthorized', json: () => Promise.resolve({ message: 'Unauthenticated.' }),
    })
    renderApp()

    await waitFor(() => expect(localStorage.getItem(TOKEN_KEY)).toBeNull())
    expect(await screen.findByText('Create an account')).toBeInTheDocument()
  })
})

describe('sleep tags and tummy time', () => {
  it('renders a tagged sleep and a tummy time entry from the cache', () => {
    seedSignedIn({
      entries: [
        { id: 'e-nap', type: 'sleep', t: Date.now() - 1800_000, detail: 'Nap · 45m', deleted: false, by: 1, babyId: null },
        { id: 'e-tummy', type: 'tummy', t: Date.now() - 900_000, detail: 12, deleted: false, by: 1, babyId: null },
      ],
    })
    routes['GET /state'] = () => okJson(stateFixture())
    renderApp()

    expect(screen.getByText('Tummy time')).toBeInTheDocument()
    expect(screen.getByText(/12m/)).toBeInTheDocument()
    // the tag reads like nursing's side: tag first, then the duration
    expect(screen.getByText(/Nap · 45m/)).toBeInTheDocument()
  })

  it('logging a past sleep with the Nap chip writes "Nap · 45m" on the wire', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    let pushed
    routes['GET /state'] = () => okJson(stateFixture())
    routes['POST /entries'] = opts => { pushed = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()

    await user.click(screen.getByText('add')) // the floating log button (icon ligature)
    // the sheet is pointer-events:none until its enter animation lands (double rAF)
    await waitFor(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))))
    await user.click(screen.getByText('Sleep'))
    await user.click(screen.getByText('Log a past sleep')) // timer-first → manual mode
    await user.click(screen.getByText('Nap'))
    await user.click(screen.getByText(/Save sleep/))

    await waitFor(() => expect(pushed).toBeTruthy())
    expect(pushed.entries[0].type).toBe('sleep')
    expect(pushed.entries[0].detail).toBe('Nap · 45m') // default 45m + the tag, nurse-style
  })

  it('an untagged sleep save keeps the legacy bare-minutes wire format', async () => {
    const user = userEvent.setup()
    seedSignedIn()
    let pushed
    routes['GET /state'] = () => okJson(stateFixture())
    routes['POST /entries'] = opts => { pushed = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()

    await user.click(screen.getByText('add'))
    await waitFor(() => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res))))
    await user.click(screen.getByText('Sleep'))
    await user.click(screen.getByText('Log a past sleep'))
    await user.click(screen.getByText(/Save sleep/))

    await waitFor(() => expect(pushed).toBeTruthy())
    expect(pushed.entries[0].detail).toBe('45') // detail is stringified for the wire
  })
})

describe('outbox sync', () => {
  it('pushes queued entries in the wire shape, then clears the outbox', async () => {
    const t = Date.now() - 600_000
    seedSignedIn({
      entries: [{ id: 'e-queued', type: 'bottle', t, detail: 4, deleted: false, by: 1, babyId: null }],
      outbox: ['e-queued'],
    })
    let pushed
    routes['POST /entries'] = opts => { pushed = JSON.parse(opts.body); return okJson({ ok: true }) }
    routes['GET /state'] = () => okJson(stateFixture())
    renderApp()

    await waitFor(() => expect(pushed).toBeTruthy())
    // detail goes over the wire as a string; babyId null stays absent so an
    // old-client-shaped write still means "primary child" server-side
    expect(pushed).toEqual({ entries: [{ id: 'e-queued', type: 'bottle', t, detail: '4', deleted: false }] })
    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem(STORE_KEY)).outbox).toEqual([])
    })
    // the entry itself survives the flush
    expect(screen.getByText('Bottle')).toBeInTheDocument()
  })

  it('keeps the outbox intact when the push fails, for the next sync', async () => {
    const t = Date.now() - 600_000
    seedSignedIn({
      entries: [{ id: 'e-queued', type: 'bottle', t, detail: 4, deleted: false, by: 1, babyId: null }],
      outbox: ['e-queued'],
    })
    routes['POST /entries'] = () => Promise.reject(new TypeError('fetch failed'))
    renderApp()

    expect(await screen.findByText(/· offline/)).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(STORE_KEY)).outbox).toEqual(['e-queued'])
  })
})
