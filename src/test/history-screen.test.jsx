// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// The SEAM test for the 2026-09-12 batch. Three separate changes each hung a
// new surface on History — the household's chosen bar charts, the feed-trend
// card and the recurring-nap card — and each was tested on its own fixture,
// in isolation, with the other two silent. Nothing pinned what she actually
// sees: all of them on screen at once.
//
// This drives ONE household whose log makes every card speak, and pins
//   • the reading order top-to-bottom (charts, then feeds average, then the
//     feed trend, then the wake window, then the recurring nap, then All days)
//   • that the average card and the trend card do NOT say the same thing —
//     "roughly every 3h 30m" over the week, next to "tightened to about every
//     2h against about every 4h", is the whole reason the trend card exists
//   • that the charts on screen are the household's pick, not the old pair
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../echo.js', () => ({
  startEcho: vi.fn(), stopEcho: vi.fn(), socketId: vi.fn(), isEchoConnected: vi.fn(() => false),
}))

import App from '../App.jsx'

const STORE_KEY = 'babylog:v2'
const TOKEN_KEY = 'babylog:token'

// a fixed local wall-clock moment — every expectation below is a clock time
const NOW = new Date(2026, 8, 12, 15, 0, 0, 0) // Sat 12 Sep 2026, 3:00 PM
const H = 3600000
const M = 60000
// d days back from NOW, at hh:mm local
const at = (d, hh, mm) => {
  const x = new Date(NOW)
  x.setDate(x.getDate() - d)
  x.setHours(hh, mm, 0, 0)
  return x.getTime()
}

let routes
const okJson = data => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })

const ME = { id: 1, name: 'Alex', householdId: 7 }
const SETTINGS = { tracking: {}, dismissed: [], charts: ['feeds', 'sleep'] }

let seq = 0
const feed = t => ({ id: 'f' + (++seq), type: 'nurse', t, detail: 'Left · 10m', deleted: false, by: 1, babyId: null })
const nap = (t, mins) => ({ id: 's' + (++seq), type: 'sleep', t, detail: 'Nap · ' + mins + 'm', deleted: false, by: 1, babyId: null })

// A week of feeds that TIGHTENED: 4h apart from 7 days back until yesterday
// afternoon, 2h apart ever since. Hand-worked expectations —
//   feed-trend windows: recent (last 24h) median 2h, baseline (72h–7d) 4h.
//   the average card sees the 7-day window from midnight 6 days back: 33 of
//   the 4h feeds and all 12 of the 2h ones = 44 gaps, 33×240m + 11×120m
//   = 9240m over 44 gaps = 210m, i.e. 3h 30m — the mean that hides the change.
const feeds = () => [
  ...Array.from({ length: 12 }, (_, k) => feed(NOW.getTime() - (k + 1) * 2 * H)),
  ...Array.from({ length: 36 }, (_, k) => feed(NOW.getTime() - 24 * H - (k + 1) * 4 * H)),
]

// Four days of a lunchtime nap that drifts a little, plus two evening naps.
// Starts 11:58 / 12:05 / 12:12 / 12:20 all sit inside ±45m of each other, so
// they are one cluster of FOUR days; the two evening naps are only two days
// and can never clear the floor. Sleeps are stamped at the WAKE-UP, so each
// t below is its start plus its length.
const naps = () => [
  nap(at(3, 11, 58) + 120 * M, 120),
  nap(at(2, 12, 5) + 120 * M, 120),
  nap(at(1, 12, 12) + 120 * M, 120),
  nap(at(0, 12, 20) + 120 * M, 120),
  // each begins exactly 3h after that day's lunchtime nap ended → wake window 3h
  nap(at(2, 17, 5) + 60 * M, 60),
  nap(at(1, 17, 12) + 60 * M, 60),
]

beforeEach(() => {
  seq = 0
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(NOW)
  routes = {}
  vi.stubGlobal('fetch', vi.fn((url, opts = {}) => {
    const key = (opts.method || 'GET') + ' ' + url.replace(/^\/api/, '').split('?')[0]
    if (!routes[key]) return Promise.reject(new TypeError('fetch failed: no route for ' + key))
    return routes[key](opts, url)
  }))
})
afterEach(() => vi.useRealTimers())

const openHistory = async () => {
  const entries = [...feeds(), ...naps()]
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  localStorage.setItem(TOKEN_KEY, 'tok-cached')
  localStorage.setItem(STORE_KEY, JSON.stringify({
    screen: 'home', babyName: 'Wren', age: '2–8 wks',
    me: ME, members: [ME], children: [], entries, outbox: [], lastSync: 5, settings: SETTINGS,
  }))
  routes['GET /state'] = () => okJson({
    user: ME, members: [ME], children: [], invites: [], invitePending: null,
    baby: { name: 'Wren', age: '2–8 wks', birthdate: null },
    entries, timer: null, timers: [], onDutyUserId: 1, shift: null,
    serverTime: NOW.getTime(), settings: SETTINGS,
  })
  render(<App smartPrefill={true} timeStep="5" unit="oz" />)
  await user.click(await screen.findByText('History'))
  expect(await screen.findByText('Last 7 days')).toBeInTheDocument()
}

// where a phrase sits in the rendered screen, top to bottom
const posOf = phrase => {
  const i = document.body.textContent.indexOf(phrase)
  expect(i, 'not on screen: ' + phrase).toBeGreaterThan(-1)
  return i
}

describe('the whole History screen, with every card speaking at once', () => {
  it('reads in one order: the picked charts, then feeds, the feed change, the wake window, the nap', async () => {
    await openHistory()

    // the household picked feeds + sleep, so the old hardcoded diapers chart
    // is gone even though diapers are still tracked
    expect(screen.queryByText('Diapers per day')).not.toBeInTheDocument()
    expect(screen.getAllByText(/ per day$/).map(e => e.textContent)).toEqual(['Feeds per day', 'Sleep per day'])

    const order = [
      'Feeds per day',                          // charts first — they are the screen's subject
      'Sleep per day',
      'Roughly every 3h 30m between feeds',     // the settled average
      'Feeds have tightened to about every 2h', // …then how it is changing
      'Awake about 3h between naps',            // then the sleep pair, in the same shape
      'Naps around 12:05 PM most days',
      'All days',                               // and the day list closes the screen
    ]
    const seen = order.map(posOf)
    expect(seen, order.join(' → ')).toEqual([...seen].sort((a, b) => a - b))
  })

  it('the average card and the trend card say different things about the same feeds', async () => {
    await openHistory()

    // 3h 30m is the week's mean and 2h is the last day's median: the mean is
    // exactly what buries a 4h→2h shift, which is why both cards are here
    expect(screen.getByText('Roughly every 3h 30m between feeds')).toBeInTheDocument()
    expect(screen.getByText('Feeds have tightened to about every 2h')).toBeInTheDocument()
    expect(screen.getByText(/Over the last day Wren has fed about every 2h, against about every 4h earlier in the week/))
      .toBeInTheDocument()
    // and no "Back to …" reading beside the tightening — they are exclusive
    expect(screen.queryByText(/^Back to about every /)).not.toBeInTheDocument()
  })

  it('the nap card reads nap STARTS, and names the four-day lunchtime cluster', async () => {
    await openHistory()

    // the four naps WOKE at 13:58/14:05/14:12/14:20 — a card reading e.t would
    // say "around 2:05 PM". It has to say when they went down.
    expect(screen.getByText('Naps around 12:05 PM most days')).toBeInTheDocument()
    expect(screen.queryByText('Naps around 2:05 PM most days')).not.toBeInTheDocument()
    expect(screen.getByText('On 4 of the last 7 days Wren went down between 11:58 AM and 12:20 PM, for about 2h.'))
      .toBeInTheDocument()
  })

  it('switching sleep off takes the sleep chart, the wake window and the nap card with it', async () => {
    const entries = [...feeds(), ...naps()]
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const off = { tracking: { sleep: false }, dismissed: [], charts: ['feeds', 'sleep'] }
    localStorage.setItem(TOKEN_KEY, 'tok-cached')
    localStorage.setItem(STORE_KEY, JSON.stringify({
      screen: 'home', babyName: 'Wren', age: '2–8 wks',
      me: ME, members: [ME], children: [], entries, outbox: [], lastSync: 5, settings: off,
    }))
    routes['GET /state'] = () => okJson({
      user: ME, members: [ME], children: [], invites: [], invitePending: null,
      baby: { name: 'Wren', age: '2–8 wks', birthdate: null },
      entries, timer: null, timers: [], onDutyUserId: 1, shift: null,
      serverTime: NOW.getTime(), settings: off,
    })
    render(<App smartPrefill={true} timeStep="5" unit="oz" />)
    await user.click(await screen.findByText('History'))
    expect(await screen.findByText('Last 7 days')).toBeInTheDocument()

    // three surfaces, three separate gates — a household that turned sleep off
    // must not meet it again on any of them
    expect(screen.queryByText('Sleep per day')).not.toBeInTheDocument()
    expect(screen.queryByText(/^Awake about /)).not.toBeInTheDocument()
    expect(screen.queryByText(/^Naps around /)).not.toBeInTheDocument()
    // the feed cards are untouched — feeds have no tracker to switch off
    expect(screen.getByText('Feeds per day')).toBeInTheDocument()
    expect(screen.getByText('Feeds have tightened to about every 2h')).toBeInTheDocument()
  })
})
