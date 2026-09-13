// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// History's bar charts, after "I don't care about diapers per day but can I
// have it show what I do care about, like naps." The rules these pin:
//   • a household that never chose keeps exactly the two charts it always had
//   • settings.charts replaces that list, in catalog order
//   • sleep is the one chart that sums hours instead of counting rows — three
//     naps could be forty-five minutes or six hours
//   • a tracker switched off outranks the pick: no chart for something the
//     household doesn't track, however the list reads
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
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

const stateFixture = (over = {}) => ({
  user: ME,
  members: [ME],
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
    me: ME, members: [ME], children: [],
    entries: [], outbox: [], lastSync: 5,
    settings: { tracking: {}, dismissed: [] },
    ...over,
  }))
}

const renderApp = () => render(<App smartPrefill={true} timeStep="5" unit="oz" />)

// the assertions below name specific days, so the clock can't be the wall clock
const at = (h, m) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.getTime() }

const openHistory = async (settings, entries = []) => {
  const user = userEvent.setup()
  seedSignedIn({ settings, entries })
  routes['GET /state'] = () => okJson(stateFixture({ settings }))
  routes['POST /settings'] = () => okJson({ ok: true })
  renderApp()
  await user.click(await screen.findByText('History'))
  expect(await screen.findByText('Last 7 days')).toBeInTheDocument()
  return user
}

// the chart card that carries a given heading — the heading's grandparent
const chartCard = title => screen.getByText(title).parentElement.parentElement
const chartTitles = () => screen.getAllByText(/ per day$/).map(e => e.textContent)

describe('which charts History draws', () => {
  it('a household that never chose gets Feeds per day and Diapers per day, and nothing else', async () => {
    await openHistory({ tracking: {}, dismissed: [] })

    expect(chartTitles()).toEqual(['Feeds per day', 'Diapers per day'])
  })

  it('choosing feeds + sleep drops the diapers chart and draws a sleep one', async () => {
    await openHistory({ tracking: {}, dismissed: [], charts: ['feeds', 'sleep'] })

    // the absence is the point of the feature — she asked to stop seeing this one
    expect(screen.queryByText('Diapers per day')).not.toBeInTheDocument()
    expect(screen.getByText('Sleep per day')).toBeInTheDocument()
    expect(chartTitles()).toEqual(['Feeds per day', 'Sleep per day'])
  })

  it('a chart never outlives its tracker: diapers off hides the chart it is still picked for', async () => {
    await openHistory({ tracking: { diapers: false }, dismissed: [], charts: ['feeds', 'diapers'] })

    expect(screen.queryByText('Diapers per day')).not.toBeInTheDocument()
    expect(chartTitles()).toEqual(['Feeds per day'])
  })

  it('every pick gated off leaves no charts at all — and no stray heading', async () => {
    await openHistory({ tracking: { sleep: false }, dismissed: [], charts: ['sleep'] })

    expect(screen.queryAllByText(/ per day$/)).toEqual([])
    // the rest of History is still there, so this is an empty list, not a crash
    expect(screen.getByText('Last 7 days')).toBeInTheDocument()
  })
})

describe('the sleep chart counts hours, not naps', () => {
  // stamped at the wake-up, displayed at the start: t is when they woke, so
  // each of these began 30/30/60 minutes before the time below
  const threeNapsToday = () => [
    { id: 'n1', type: 'sleep', t: at(9, 0), detail: 'Nap · 30m', deleted: false, by: 1, babyId: null },
    { id: 'n2', type: 'sleep', t: at(11, 0), detail: 'Nap · 30m', deleted: false, by: 1, babyId: null },
    { id: 'n3', type: 'sleep', t: at(14, 0), detail: 'Nap · 60m', deleted: false, by: 1, babyId: null },
  ]

  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(at(15, 30)) })
  afterEach(() => vi.useRealTimers())

  it('three naps of 30m, 30m and 60m read as 2h on today’s bar — not as 3', async () => {
    await openHistory({ tracking: {}, dismissed: [], charts: ['sleep'] }, threeNapsToday())

    const bars = within(chartCard('Sleep per day')).getAllByRole('button')
    expect(bars).toHaveLength(7)
    const today = bars[6]
    expect(today).toHaveTextContent('Today')
    // hand-written: 30 + 30 + 60 minutes of sleep is two hours
    expect(today.firstChild.textContent).toBe('2h')
    expect(today.firstChild.textContent).not.toBe('3') // a row count would say this
    // and its legend measures hours, not events
    expect(within(chartCard('Sleep per day')).getByText('hours')).toBeInTheDocument()
  })

  it('the same three naps are still three rows on a counting chart', async () => {
    await openHistory({ tracking: {}, dismissed: [], charts: ['feeds', 'sleep'] }, [
      ...threeNapsToday(),
      { id: 'f1', type: 'bottle', t: at(8, 0), detail: 4, deleted: false, by: 1, babyId: null },
      { id: 'f2', type: 'bottle', t: at(12, 0), detail: 4, deleted: false, by: 1, babyId: null },
    ])

    const feeds = within(chartCard('Feeds per day')).getAllByRole('button')
    expect(feeds[6].firstChild.textContent).toBe('2')
    const sleep = within(chartCard('Sleep per day')).getAllByRole('button')
    expect(sleep[6].firstChild.textContent).toBe('2h')
  })

  it('a nap that ended after midnight belongs to the day it started', async () => {
    // woke at 00:20 today off a 40-minute sleep → it began at 23:40 yesterday
    await openHistory({ tracking: {}, dismissed: [], charts: ['sleep'] }, [
      { id: 'n-mid', type: 'sleep', t: at(0, 20), detail: 'Night · 40m', deleted: false, by: 1, babyId: null },
    ])

    const bars = within(chartCard('Sleep per day')).getAllByRole('button')
    expect(bars[5].firstChild.textContent).toBe('40m') // yesterday
    expect(bars[6].firstChild.textContent).toBe('0m')  // today
  })
})

describe('the Charts picker in Settings', () => {
  const openSettings = async (user) => {
    await user.click(await screen.findByLabelText('Settings'))
    expect(await screen.findByText('Appearance')).toBeInTheDocument()
  }

  it('a parent turning Sleep on saves the catalog-ordered list to the household', async () => {
    const user = userEvent.setup()
    let saved
    seedSignedIn({ settings: { tracking: {}, dismissed: [] } })
    routes['GET /state'] = () => okJson(stateFixture())
    routes['POST /settings'] = opts => { saved = JSON.parse(opts.body); return okJson({ ok: true }) }
    renderApp()
    await openSettings(user)

    const picker = screen.getByText('History charts').parentElement
    await user.click(within(within(picker).getByText('Sleep').parentElement).getByText('toggle_off'))

    // catalog order, not tap order: feeds, then sleep, then diapers
    await waitFor(() => expect(saved?.charts).toEqual(['feeds', 'sleep', 'diapers']))
  })

  it('a caregiver never sees the picker — the endpoint would 403 them', async () => {
    const user = userEvent.setup()
    const carer = { id: 1, name: 'Alex', householdId: 7, role: 'caregiver' }
    seedSignedIn({ me: carer, settings: { tracking: {}, dismissed: [] } })
    routes['GET /state'] = () => okJson(stateFixture({ user: carer, members: [carer] }))
    renderApp()
    await openSettings(user)

    expect(screen.queryByText('History charts')).not.toBeInTheDocument()
    expect(screen.queryByText('Now screen cards')).not.toBeInTheDocument()
  })
})
