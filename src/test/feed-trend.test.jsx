// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// History's feed-trend card, after "if for several feeds they are two hours
// apart it could say to me your baby might be clusterfeeding. But then once it
// goes back to 4 hours apart the trend would alert me too … That way I don't
// have to constantly look at all the time stamps."
// The rules these pin:
//   • it reports the CHANGE, not the average — steady weeks render nothing
//   • medians, so one late feed is not a trend
//   • the two readings are mutually exclusive: never "tightened" and "back to"
//     on the same screen
//   • a cluster BURST (feeds inside 45m) is one beat and cannot fake a shift
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

const openHistory = async (entries, settings = { tracking: {}, dismissed: [] }) => {
  const user = userEvent.setup()
  seedSignedIn({ settings, entries })
  routes['GET /state'] = () => okJson(stateFixture({ settings }))
  routes['POST /settings'] = () => okJson({ ok: true })
  render(<App smartPrefill={true} timeStep="5" unit="oz" />)
  await user.click(await screen.findByText('History'))
  expect(await screen.findByText('Last 7 days')).toBeInTheDocument()
  return user
}

// The clock is pinned: every fixture is written as "h hours before now" and the
// assertions name hand-written durations, so the wall clock can't be involved.
const NOW = new Date(2026, 8, 12, 20, 0, 0)
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => vi.useRealTimers())

// a feed `hoursAgo` before NOW. Feeds are stamped at the moment they happened,
// so unlike sleep there is no start/end games to play here.
let seq = 0
const feed = hoursAgo => ({
  id: 'f' + (++seq), type: 'nurse', t: NOW.getTime() - Math.round(hoursAgo * 3600000),
  detail: 'Left · 20m', deleted: false, by: 1, babyId: null,
})
// feeds every `every` hours from `fromH` hours ago up to (but not including) `toH`
const run = (fromH, toH, every) => {
  const out = []
  for (let h = fromH; h > toH + 1e-9; h -= every) out.push(feed(h))
  return out
}

const tightCard = () => screen.queryByText(/^Feeds have tightened /)
const backCard = () => screen.queryByText(/^Back to about every /)

describe('the feed-trend card', () => {
  it('names the tightening when a 4h week becomes a 2h day', async () => {
    // days 7→1 back at 4h apart, then the last 24h at 2h apart
    await openHistory([...run(167, 24, 4), ...run(23.5, 0, 2)])

    const card = tightCard()
    expect(card).toBeInTheDocument()
    // hand-written: the recent gaps are all 120 minutes → "2h"; the older ones
    // are all 240 minutes → "4h"
    expect(card).toHaveTextContent('Feeds have tightened to about every 2h')
    const body = card.nextSibling
    expect(body.textContent).toContain('Over the last day Wren has fed about every 2h, against about every 4h earlier in the week')
    expect(body.textContent).toContain('often cluster feeding')
    // the two readings are mutually exclusive
    expect(backCard()).not.toBeInTheDocument()
  })

  it('says nothing at all on a steady 3h week', async () => {
    await openHistory(run(167, 0, 3))

    expect(tightCard()).not.toBeInTheDocument()
    expect(backCard()).not.toBeInTheDocument()
    // the average card is still there — "steady" is its job, not this card's
    expect(screen.getByText(/^Roughly every /)).toBeInTheDocument()
  })

  it('says the rhythm is back after a tighter spell, and does not also say it tightened', async () => {
    // settled 4h from 7 days back to 3 days back, a 2h spell across days 3→1,
    // then the last 24h back at 4h
    await openHistory([...run(167, 72, 4), ...run(71.5, 24, 2), ...run(23.5, 0, 4)])

    const card = backCard()
    expect(card).toBeInTheDocument()
    // hand-written: recent gaps 240m → "4h", the spell's gaps 120m → "2h"
    expect(card).toHaveTextContent('Back to about every 4h between feeds')
    const body = card.nextSibling
    expect(body.textContent).toContain('The tighter spell of about every 2h has passed')
    expect(body.textContent).toContain('Wren is back near the earlier rhythm of about every 4h')
    expect(tightCard()).not.toBeInTheDocument()
  })

  it('one short gap in a steady week is noise, not a trend', async () => {
    // a steady 3h week with one extra feed 48 minutes after the feed 8h ago —
    // just wide enough to survive the 45m cluster fold, so it really does land
    // in the gap list as a 48-minute beat. One of nine gaps must not move the
    // reading; the median it sits under is still 3h.
    await openHistory([...run(167, 0, 3), feed(7.2)])

    expect(tightCard()).not.toBeInTheDocument()
    expect(backCard()).not.toBeInTheDocument()
  })

  it('a cluster burst is one beat: three feeds inside 20 minutes do not read as tightening', async () => {
    // steady 4h all week, but today every feed came as a burst of three within
    // 20 minutes. Counted raw those are 10-minute gaps and the card would cry
    // cluster feeding; folded into sessions the rhythm never moved.
    const bursts = []
    for (const h of [20, 16, 12, 8, 4, 0.5]) bursts.push(feed(h), feed(h - 1 / 6), feed(h - 1 / 3))
    await openHistory([...run(167, 24, 4), ...bursts])

    expect(tightCard()).not.toBeInTheDocument()
    expect(backCard()).not.toBeInTheDocument()
  })

  it('holds its tongue until there are enough beats on both sides', async () => {
    // a tightening that is real but only three feeds deep — too thin to call
    await openHistory([...run(167, 24, 4), feed(6), feed(4), feed(2)])

    expect(tightCard()).not.toBeInTheDocument()
    expect(backCard()).not.toBeInTheDocument()
  })

  it('a stretch that got LONGER is not "back to normal"', async () => {
    // 2h all week, a 1h spell in the middle, then 4h today: recent is nowhere
    // near the baseline, so the honest answer is silence
    await openHistory([...run(167, 72, 2), ...run(71.5, 24, 1), ...run(23.5, 0, 4)])

    expect(backCard()).not.toBeInTheDocument()
    expect(tightCard()).not.toBeInTheDocument()
  })
})
