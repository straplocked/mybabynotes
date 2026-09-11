// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (C) 2026 Chris Carvache
// The CSV export's cell escaping: RFC-4180 quoting plus the OWASP CSV/formula
// injection guard. A member name or note is free text, so a household member
// called "=HYPERLINK(...)" must land in Excel/Sheets as text, never a formula.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../echo.js', () => ({
  startEcho: vi.fn(),
  stopEcho: vi.fn(),
  socketId: vi.fn(),
  isEchoConnected: vi.fn(() => false),
}))

import App, { csvEsc } from '../App.jsx'

describe('csvEsc', () => {
  it('prefixes formula-leading cells with an apostrophe (CSV injection)', () => {
    expect(csvEsc('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"')
    expect(csvEsc('+1')).toBe("'+1")
    expect(csvEsc('-')).toBe("'-")
    expect(csvEsc('@a')).toBe("'@a")
    expect(csvEsc('\tx')).toBe("'\tx")
    expect(csvEsc('\rx')).toBe("'\rx")
  })

  it('leaves plain text alone and still quotes commas, quotes and newlines', () => {
    expect(csvEsc('Sam')).toBe('Sam')
    expect(csvEsc('a,b')).toBe('"a,b"')
    expect(csvEsc('say "hi"')).toBe('"say ""hi"""')
    expect(csvEsc('two\nlines')).toBe('"two\nlines"')
    expect(csvEsc(null)).toBe('')
    expect(csvEsc(undefined)).toBe('')
  })

  it('an injected cell that also needs quoting gets both', () => {
    expect(csvEsc('=cmd|/C calc, now')).toBe('"\'=cmd|/C calc, now"')
  })
})

// ── the full-log export, end to end through the share sheet ─────────────────
const STORE_KEY = 'babylog:v2'
const TOKEN_KEY = 'babylog:token'
const okJson = data => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(data) })

describe('exportLog', () => {
  let shared
  beforeEach(() => {
    shared = vi.fn(() => Promise.resolve())
    vi.stubGlobal('fetch', vi.fn(url => url.includes('/state')
      ? okJson({
        user: { id: 1, name: 'Alex', householdId: 7 },
        members: [{ id: 1, name: 'Alex' }, { id: 2, name: '=cmd|/C calc' }],
        children: [], invites: [], invitePending: null,
        baby: { name: 'Wren', age: '2–8 wks', birthdate: null },
        entries: [], timer: null, onDutyUserId: 1, shift: null, serverTime: Date.now(),
        settings: { tracking: {}, dismissed: [] },
      })
      : Promise.reject(new TypeError('no route for ' + url))))
    navigator.canShare = () => true
    navigator.share = shared
    localStorage.setItem(TOKEN_KEY, 'tok-cached')
    localStorage.setItem(STORE_KEY, JSON.stringify({
      screen: 'home', babyName: 'Wren', age: '2–8 wks',
      me: { id: 1, name: 'Alex', householdId: 7 },
      members: [{ id: 1, name: 'Alex' }, { id: 2, name: '=cmd|/C calc' }], children: [],
      entries: [{ id: 'e-1', type: 'bottle', t: Date.now() - 3600_000, detail: '4 formula', deleted: false, by: 2, babyId: null }],
      outbox: [], lastSync: 5,
      settings: { tracking: {}, dismissed: [] },
    }))
  })

  it('neutralizes a formula-shaped member name in the Logged-by column', async () => {
    const user = userEvent.setup()
    render(<App smartPrefill={true} timeStep="5" unit="oz" />)

    await user.click(await screen.findByLabelText('Settings'))
    await user.click(await screen.findByText('Full log'))

    await waitFor(() => expect(shared).toHaveBeenCalledTimes(1))
    const file = shared.mock.calls[0][0].files[0]
    expect(file.name).toMatch(/^mybabynotes-wren-full-\d{4}-\d{2}-\d{2}\.csv$/)
    const lines = (await file.text()).split('\r\n')
    expect(lines[0]).toBe('Date,Time,Type,Amount (oz),Duration (min),Detail,Logged by')
    expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2},\d{2}:\d{2},Bottle,4,,formula,'=cmd\|\/C calc$/)
    expect(lines[1]).not.toContain(',=cmd')
  })
})
