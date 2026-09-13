// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// History's recurring-nap card, after "I'm noticing he sleeps around 12p every
// day … if the app could recognize patterns and analyze trends to tell me."
// The rules these pin:
//   • three separate days inside ±45m of a common time, or no card at all
//   • the time reported is when the nap BEGAN — a sleep is stamped at its
//     wake-up, so naps that all END together are not a pattern
//   • the duration clause only appears when the cluster's lengths agree
//   • overnight sleep never wins the card; it's the most regular sleep there is
//   • sleep tracking off hides it like every other sleep surface
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
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

const openHistory = async (settings, entries = []) => {
  const user = userEvent.setup()
  seedSignedIn({ settings, entries })
  routes['GET /state'] = () => okJson(stateFixture({ settings }))
  routes['POST /settings'] = () => okJson({ ok: true })
  render(<App smartPrefill={true} timeStep="5" unit="oz" />)
  await user.click(await screen.findByText('History'))
  expect(await screen.findByText('Last 7 days')).toBeInTheDocument()
  return user
}

// The clock is pinned: every fixture below is written as "d days ago at h:m"
// and the assertions name real times, so the wall clock can't be involved.
// 2026-09-12 sits well clear of any DST edge in the runner's zone.
const NOW = new Date(2026, 8, 12, 20, 0, 0)
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => vi.useRealTimers())

// a sleep that BEGAN `daysAgo` at h:m and ran `mins` minutes. The wire stamps
// it at the wake-up, so t is the start plus the duration — the whole point of
// this file is that the card must undo that.
let seq = 0
const nap = (daysAgo, h, m, mins, when = 'Nap') => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - daysAgo)
  d.setHours(h, m, 0, 0)
  return {
    id: 'nap' + (++seq), type: 'sleep', t: d.getTime() + mins * 60000,
    detail: (when ? when + ' · ' : '') + mins + 'm', deleted: false, by: 1, babyId: null,
  }
}

const napCard = () => screen.queryByText(/^Naps around /)

describe('the recurring-nap card', () => {
  it('names the lunchtime nap and its typical length', async () => {
    // five days running, down near 12:05 for about two hours, plus a scatter
    // of other naps that agree with nothing
    await openHistory({ tracking: {}, dismissed: [] }, [
      nap(4, 12, 5, 120), nap(3, 12, 12, 115), nap(2, 11, 58, 120),
      nap(1, 12, 20, 125), nap(0, 12, 2, 120),
      nap(4, 8, 30, 40), nap(3, 16, 15, 35), nap(2, 9, 45, 50),
      nap(1, 15, 10, 45), nap(0, 17, 40, 30),
    ])

    const card = napCard()
    expect(card).toBeInTheDocument()
    // hand-written: the five starts sorted by time of day are 11:58, 12:02,
    // 12:05, 12:12, 12:20 — the middle one is 12:05
    expect(card).toHaveTextContent('Naps around 12:05 PM most days')
    const body = card.nextSibling
    expect(body.textContent).toContain('On 5 of the last 7 days')
    expect(body.textContent).toContain('Wren went down between 11:58 AM and 12:20 PM')
    // durations 115/120/120/120/125 → median 120 minutes → "2h"
    expect(body.textContent).toContain('for about 2h')
  })

  it('says nothing when the naps agree on nothing', async () => {
    await openHistory({ tracking: {}, dismissed: [] }, [
      nap(5, 7, 15, 40), nap(4, 10, 40, 55), nap(3, 13, 5, 35),
      nap(2, 16, 30, 70), nap(1, 9, 20, 45), nap(0, 18, 0, 30),
    ])

    expect(napCard()).not.toBeInTheDocument()
  })

  it('reads the start of the nap, not its end: same wake-up every day is no pattern', async () => {
    // four days that all END at 2 PM but begin at 13:30, 12:30, 11:30, 10:30.
    // Reading e.t would find a perfect four-day cluster and print a card.
    await openHistory({ tracking: {}, dismissed: [] }, [
      nap(3, 13, 30, 30), nap(2, 12, 30, 90), nap(1, 11, 30, 150), nap(0, 10, 30, 210),
    ])

    expect(napCard()).not.toBeInTheDocument()
  })

  it('two days is a coincidence — the three-day floor is a real floor', async () => {
    await openHistory({ tracking: {}, dismissed: [] }, [
      nap(1, 12, 5, 120), nap(0, 12, 10, 120),
    ])

    expect(napCard()).not.toBeInTheDocument()
  })

  it('a household with sleep switched off never sees it, however clear the pattern', async () => {
    await openHistory({ tracking: { sleep: false }, dismissed: [] }, [
      nap(4, 12, 5, 120), nap(3, 12, 12, 115), nap(2, 11, 58, 120),
      nap(1, 12, 20, 125), nap(0, 12, 2, 120),
    ])

    expect(napCard()).not.toBeInTheDocument()
  })

  it('drops the length clause when the cluster’s naps are 25m one day and 3h the next', async () => {
    await openHistory({ tracking: {}, dismissed: [] }, [
      nap(3, 12, 0, 25), nap(2, 12, 15, 120), nap(1, 11, 50, 180), nap(0, 12, 5, 45),
    ])

    const card = napCard()
    expect(card).toBeInTheDocument()
    const body = card.nextSibling
    expect(body.textContent).not.toContain('for about')
    expect(body.textContent).toContain('How long it lasts still varies')
  })

  it('overnight sleep never wins the card — the 8 PM bedtime is not the pattern', async () => {
    // bedtime at 8 PM every night for five nights (the most regular sleep there
    // is), and a real 3 PM nap on three of them. The card must name 3 PM.
    await openHistory({ tracking: {}, dismissed: [] }, [
      nap(5, 20, 0, 600, 'Night'), nap(4, 20, 5, 590, 'Night'), nap(3, 19, 55, 610, 'Night'),
      nap(2, 20, 10, 600, 'Night'), nap(1, 20, 0, 605, 'Night'),
      nap(3, 15, 0, 60), nap(2, 15, 10, 65), nap(1, 14, 55, 60),
    ])

    expect(napCard()).toHaveTextContent('Naps around 3:00 PM most days')
  })

  it('a long daytime sleep with no Night tag is still not a nap', async () => {
    // logged untagged, but five and a half hours from 8 AM is not the lunchtime
    // rhythm she asked about — length alone disqualifies it
    await openHistory({ tracking: {}, dismissed: [] }, [
      nap(2, 8, 0, 330, ''), nap(1, 8, 5, 330, ''), nap(0, 7, 55, 330, ''),
    ])

    expect(napCard()).not.toBeInTheDocument()
  })

  it('one day cannot vote twice: three naps in one afternoon are not three days', async () => {
    await openHistory({ tracking: {}, dismissed: [] }, [
      nap(1, 12, 0, 40), nap(1, 12, 30, 40), nap(1, 12, 44, 40),
    ])

    expect(napCard()).not.toBeInTheDocument()
  })
})
